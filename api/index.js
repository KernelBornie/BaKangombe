require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { faker } = require('@faker-js/faker');
const axios = require('axios');
const dns = require('dns').promises;
const { sql } = require('@vercel/postgres');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------- Vercel Postgres (graceful fallback) ----------
let dbReady = false;
let feedbackStore = [];

(async () => {
  try {
    await sql`CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255),
      message TEXT,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS feedback_responses (
      id SERIAL PRIMARY KEY,
      feedback_id INTEGER REFERENCES feedback(id) ON DELETE CASCADE,
      reply_message TEXT NOT NULL,
      replied_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    dbReady = true;
    console.log('Vercel Postgres ready');
  } catch (err) {
    console.error('Vercel Postgres error:', err.message);
  }
})();

// ---------- Brevo email ----------
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = 'bornfacek135@gmail.com';
const SENDER_NAME = 'BaKangombe';

async function sendEmail(toEmail, subject, htmlContent) {
  if (!BREVO_API_KEY) return false;
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: toEmail, name: toEmail.split('@')[0] }],
      subject,
      htmlContent
    }, {
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
    });
    return true;
  } catch (err) {
    console.error('Email error:', err.response?.data || err.message);
    return false;
  }
}

// ---------- DNS Cache ----------
const dnsCache = new Map();
const DNS_CACHE_TTL = 5 * 60 * 1000;

async function cachedDnsResolve(domain, type, resolverFn) {
  const key = `${domain}:${type}`;
  const now = Date.now();
  if (dnsCache.has(key)) {
    const { value, expires } = dnsCache.get(key);
    if (now < expires) return value;
  }
  const result = await resolverFn();
  dnsCache.set(key, { value: result, expires: now + DNS_CACHE_TTL });
  return result;
}

// ---------- IMPROVED MX LOOKUP with timeout and fallback ----------
async function getMxRecords(domain, timeout = 5000) {
  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), timeout))
    ]);
    return mx && mx.length > 0;
  } catch (err) {
    console.error(`MX lookup failed for ${domain}:`, err.message);
    const knownDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'protonmail.com'];
    if (knownDomains.includes(domain.toLowerCase())) {
      return true;
    }
    return false;
  }
}

async function checkSpf(domain) {
  return cachedDnsResolve(domain, 'spf', async () => {
    try {
      const records = await dns.resolveTxt(domain);
      return records.some(record => record.join('').includes('v=spf1'));
    } catch { return false; }
  });
}

async function checkDkim(domain) {
  return cachedDnsResolve(domain, 'dkim', async () => {
    try {
      const records = await dns.resolveTxt(`default._domainkey.${domain}`);
      return records.some(record => record.join('').includes('v=DKIM1'));
    } catch { return false; }
  });
}

async function checkDmarc(domain) {
  return cachedDnsResolve(domain, 'dmarc', async () => {
    try {
      const records = await dns.resolveTxt(`_dmarc.${domain}`);
      return records.some(record => record.join('').includes('v=DMARC1'));
    } catch { return false; }
  });
}

// ---------- Rate limit with headers ----------
const rateLimitMap = new Map();
const FREE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100;
const PREMIUM_LIMIT_MAX = 10000;

function rateLimitWithHeaders(req, res, next, limit, windowMs = 60000) {
  const key = req.ip || req.headers['x-forwarded-for'];
  const now = Date.now();
  const windowStart = now - windowMs;
  if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
  let timestamps = rateLimitMap.get(key).filter(t => t > windowStart);
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  const remaining = Math.max(0, limit - timestamps.length);
  const reset = windowStart + windowMs;
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(reset / 1000));
  if (timestamps.length > limit) {
    return res.status(429).json({ error: `Rate limit exceeded. ${limit} requests per minute.` });
  }
  next();
}

function checkPremiumKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  req.isPremium = !!(apiKey && apiKey === process.env.PREMIUM_API_KEY);
  next();
}
app.use('/api/', checkPremiumKey);

app.use('/api/validate', (req, res, next) => rateLimitWithHeaders(req, res, next, FREE_LIMIT_MAX));
app.use('/api/feedback', (req, res, next) => rateLimitWithHeaders(req, res, next, FREE_LIMIT_MAX));
app.use('/api/validate/batch', (req, res, next) => {
  if (req.isPremium) return rateLimitWithHeaders(req, res, next, PREMIUM_LIMIT_MAX);
  next();
});
app.use('/api/domain/score', (req, res, next) => {
  if (req.isPremium) return rateLimitWithHeaders(req, res, next, PREMIUM_LIMIT_MAX);
  next();
});
app.use('/api/disposable', (req, res, next) => {
  if (req.isPremium) return rateLimitWithHeaders(req, res, next, PREMIUM_LIMIT_MAX);
  next();
});

const getCount = (req, defaultCount = 5) => {
  let count = parseInt(req.params.count) || parseInt(req.query.count) || defaultCount;
  return Math.min(Math.max(count, 1), 100);
};

// ---------- MOCK ENDPOINTS ----------
app.get('/api/users/:count?', (req, res) => {
  const count = getCount(req, 5);
  const users = Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    email: faker.internet.email(),
    avatar: faker.image.avatar(),
    phone: faker.phone.number(),
    address: {
      street: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state(),
      zipCode: faker.location.zipCode(),
      country: faker.location.country(),
    },
    jobTitle: faker.person.jobTitle(),
    company: faker.company.name(),
    createdAt: faker.date.past(),
  }));
  res.json({ count, data: users, premium: req.isPremium });
});
app.get('/api/products/:count?', (req, res) => {
  const count = getCount(req, 10);
  const products = Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    name: faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    price: parseFloat(faker.commerce.price()),
    category: faker.commerce.department(),
    brand: faker.company.name(),
    inStock: faker.datatype.boolean(),
    imageUrl: faker.image.url({ width: 640, height: 480 }),
    rating: faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
    reviews: faker.number.int({ min: 0, max: 5000 }),
  }));
  res.json({ count, data: products, premium: req.isPremium });
});
app.get('/api/company', (req, res) => {
  const company = {
    id: faker.string.uuid(),
    name: faker.company.name(),
    catchPhrase: faker.company.catchPhrase(),
    industry: faker.company.buzzNoun(),
    employees: faker.number.int({ min: 10, max: 10000 }),
    founded: faker.date.past({ years: 50 }).getFullYear(),
    headquarters: {
      street: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state(),
      country: faker.location.country(),
    },
    ceo: faker.person.fullName(),
    revenue: `$${faker.number.int({ min: 1, max: 100 })}B`,
    contactEmail: faker.internet.email(),
    contactPhone: faker.phone.number(),
  };
  res.json({ ...company, premium: req.isPremium });
});
app.get('/api/transactions/:count?', (req, res) => {
  const count = getCount(req, 20);
  const transactions = Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    amount: faker.number.float({ min: 5, max: 5000, fractionDigits: 2 }),
    currency: faker.finance.currencyCode(),
    status: faker.helpers.arrayElement(['pending', 'completed', 'failed', 'refunded']),
    paymentMethod: faker.helpers.arrayElement(['credit_card', 'paypal', 'bank_transfer', 'crypto']),
    customerName: faker.person.fullName(),
    customerEmail: faker.internet.email(),
    transactionDate: faker.date.recent({ days: 30 }),
    description: faker.commerce.productName(),
  }));
  res.json({ count, data: transactions, premium: req.isPremium });
});

// ---------- EMAIL VALIDATION ----------
const disposableDomains = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwawaymail.com', 'yopmail.com', 'mailnator.com', 'spamgourmet.com'
]);

async function validateEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return { valid: false, reason: 'missing domain' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return { valid: false, reason: 'invalid syntax' };
  const hasMx = await getMxRecords(domain);
  if (!hasMx) return { valid: false, reason: 'domain does not exist' };
  const isDisposable = disposableDomains.has(domain.toLowerCase());
  const isFreeProvider = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'].includes(domain.toLowerCase());
  let score = 100;
  if (isDisposable) score -= 60;
  if (isFreeProvider) score -= 10;
  if (score < 0) score = 0;
  return { valid: true, has_mx: true, is_disposable: isDisposable, is_free_provider: isFreeProvider, score };
}

app.post('/api/validate', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  const result = await validateEmail(email);
  res.json({ email, ...result });
});

// ---------- BATCH VALIDATION ----------
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/validate/batch', upload.single('file'), async (req, res) => {
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!req.file) return res.status(400).json({ error: 'CSV file required' });
  const results = [];
  const stream = Readable.from(req.file.buffer.toString());
  stream.pipe(csv())
    .on('data', (row) => {
      const email = row.email || Object.values(row)[0];
      if (email && email.includes('@')) {
        results.push(validateEmail(email).then(result => ({ email, ...result })));
      }
    })
    .on('end', async () => {
      const validated = await Promise.all(results);
      res.json({ count: validated.length, results: validated });
    });
});

// ---------- DOMAIN SCORE ----------
app.post('/api/domain/score', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  const spf = await checkSpf(domain);
  const dkim = await checkDkim(domain);
  const dmarc = await checkDmarc(domain);
  let score = 0;
  if (spf) score += 35;
  if (dkim) score += 35;
  if (dmarc) score += 30;
  let recommendation = 'Poor security';
  if (score >= 80) recommendation = 'Excellent';
  else if (score >= 60) recommendation = 'Good';
  else if (score >= 30) recommendation = 'Needs improvement';
  res.json({ domain, spf, dkim, dmarc, score, recommendation });
});

// ---------- DISPOSABLE CHECK ----------
app.post('/api/disposable', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  const domain = email.split('@')[1].toLowerCase();
  const isDisposable = disposableDomains.has(domain);
  res.json({ email, isDisposable });
});

// ---------- WAITLIST ----------
async function sendWelcomeEmail(email) {
  if (!BREVO_API_KEY) return false;
  const html = `<html><body><h2>Thank you for joining the BaKangombe waitlist!</h2><p>– Bornface Kangombe Kernel</p></body></html>`;
  return await sendEmail(email, 'Welcome to BaKangombe Waitlist', html);
}
app.post('/api/waitlist', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  const sent = await sendWelcomeEmail(email);
  res.json({ message: sent ? 'Added to waitlist and welcome email sent!' : 'Added to waitlist (but email could not be sent).' });
});

// ---------- LEMON SQUEEZY CHECKOUT ----------
app.post('/api/create-ls-checkout', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  const LS_API_KEY = process.env.LEMONSQUEEZY_API_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...';
  const LS_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID || '387550';
  const LS_VARIANT_ID = process.env.LEMONSQUEEZY_VARIANT_ID || '1705111';
  try {
    const response = await axios.post('https://api.lemonsqueezy.com/v1/checkouts', {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: { email, custom: { user_email: email } },
          product_options: { redirect_url: 'https://ba-kangombe.vercel.app/success', receipt_button_text: 'Go to Dashboard', receipt_link_url: 'https://ba-kangombe.vercel.app/dashboard' },
          checkout_options: { embed: false, media: false, logo: false, desc: false, discount: true, dark: false }
        },
        relationships: { store: { data: { type: 'stores', id: LS_STORE_ID } }, variant: { data: { type: 'variants', id: LS_VARIANT_ID } } }
      }
    }, { headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: `Bearer ${LS_API_KEY}` } });
    res.json({ url: response.data.data.attributes.url });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// ========== BUSINESS MULTI‑TENANCY (DEFINED EARLY) ==========
async function requireBusiness(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  try {
    const result = await sql`SELECT id, name, email, modules FROM businesses WHERE api_key = ${apiKey}`;
    if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid API key' });
    req.business = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function requireModule(moduleKey) {
  return (req, res, next) => {
    if (!req.business.modules.includes(moduleKey)) {
      return res.status(403).json({ error: `Module '${moduleKey}' not enabled for this business. Please subscribe to a plan that includes it.` });
    }
    next();
  };
}

const SERVICE_CATALOG = {
  business_management: { name: "Business Management Suite", modules: ["sme", "invoice", "inventory"] },
  mobile_money: { name: "Mobile Money Platform", modules: ["momo"] },
  ecommerce: { name: "E-Commerce Store", modules: ["ecommerce", "inventory", "invoice"] },
  ai_chatbot: { name: "AI Support Chatbot", modules: ["ai"] },
  clinic: { name: "Clinic Management", modules: ["clinic", "invoice"] },
  agritech: { name: "Agritech Platform", modules: ["agritech"] },
  freelance: { name: "Freelance Marketplace", modules: ["freelance"] },
  discovery: { name: "Business Directory", modules: ["discovery"] },
  website_builder: { name: "Website Builder", modules: ["website"] }
};

const SYSTEM_BUNDLES = {
  startup: ["business_management", "mobile_money"],
  clinic_business: ["clinic", "mobile_money", "ai_chatbot", "invoice"],
  ecommerce_business: ["ecommerce", "inventory", "invoice", "mobile_money"],
  agritech_business: ["agritech", "mobile_money", "invoice"]
};

app.post('/api/business/register', async (req, res) => {
  const { name, email, modules = [] } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  const apiKey = crypto.randomBytes(32).toString('hex');
  try {
    await sql`INSERT INTO businesses (name, email, api_key, modules) VALUES (${name}, ${email}, ${apiKey}, ${modules})`;
    res.json({ apiKey, message: 'Business registered. Save this API key securely.' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/business/me', requireBusiness, (req, res) => { res.json({ business: req.business }); });

app.post('/api/subscription/activate', requireBusiness, async (req, res) => {
  const { plan } = req.body;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);
  await sql`
    INSERT INTO subscriptions (business_id, plan, status, expires_at)
    VALUES (${req.business.id}, ${plan}, 'active', ${expiresAt})
  `;
  res.json({ success: true, plan, expiresAt });
});

app.post('/api/system/create', requireBusiness, async (req, res) => {
  const { service } = req.body;
  const selected = SERVICE_CATALOG[service];
  if (!selected) return res.status(400).json({ error: 'Unknown service' });
  const dashboardUrl = `/dashboard/${req.business.id}/${service}`;
  await sql`
    INSERT INTO business_services (business_id, service_key, service_name, modules)
    VALUES (${req.business.id}, ${service}, ${selected.name}, ${selected.modules})
  `;
  await sql`
    INSERT INTO generated_systems (business_id, system_name, system_type, dashboard_url)
    VALUES (${req.business.id}, ${selected.name}, ${service}, ${dashboardUrl})
  `;
  let newModules = [...req.business.modules];
  for (const mod of selected.modules) {
    if (!newModules.includes(mod)) newModules.push(mod);
  }
  await sql`
    UPDATE businesses SET modules = ${newModules} WHERE id = ${req.business.id}
  `;
  req.business.modules = newModules;
  res.json({
    success: true,
    system: selected.name,
    modules: selected.modules,
    dashboardUrl
  });
});

app.get('/api/system/list', requireBusiness, async (req, res) => {
  const systems = await sql`SELECT * FROM generated_systems WHERE business_id = ${req.business.id} ORDER BY created_at DESC`;
  res.json({ systems: systems.rows });
});

app.post('/api/system/bundle', requireBusiness, (req, res) => {
  const { bundle } = req.body;
  const services = SYSTEM_BUNDLES[bundle];
  if (!services) return res.status(400).json({ error: 'Invalid bundle' });
  res.json({ success: true, bundle, services });
});

// ---------- ENRICHMENT (now requireBusiness is defined) ----------
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
app.post('/api/enrich', requireBusiness, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!HUNTER_API_KEY) {
    return res.status(500).json({ error: 'Enrichment service not configured. Contact support.' });
  }
  try {
    const sub = await sql`
      SELECT * FROM subscriptions
      WHERE business_id = ${req.business.id}
        AND status = 'active'
        AND expires_at > NOW()
      LIMIT 1
    `;
    if (sub.rowCount === 0) {
      return res.status(402).json({ error: 'Active subscription required for enrichment. Please subscribe.' });
    }
  } catch (err) {
    if (!err.message.includes('relation "subscriptions" does not exist')) {
      console.error('Subscription check error:', err.message);
      return res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
  }
  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${HUNTER_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data.data;
    res.json({
      email,
      verified: data.status === 'valid',
      accept_all: data.accept_all || false,
      disposable: data.disposable || false,
      webmail: data.webmail || false,
      mx_records: data.mx_records || false,
      score: data.score || 0,
      name: (data.first_name && data.last_name) ? `${data.first_name} ${data.last_name}` : null,
      company: data.company || null
    });
  } catch (err) {
    console.error('Hunter API error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Enrichment failed. Check Hunter API key or try again later.',
      details: err.response?.data?.message || err.message
    });
  }
});

// ---------- WEBSITE BUILDER (now requireBusiness is defined) ----------
app.post('/api/website/generate', requireBusiness, async (req, res) => {
  const { template = 'landing', title = 'My Site', content = 'Welcome!' } = req.body;
  if (!req.business.modules.includes('website')) {
    return res.status(403).json({ error: 'Website builder not enabled. Please subscribe to a plan that includes it.' });
  }
  let html;
  if (template === 'landing') {
    html = `<!DOCTYPE html><html><head><title>${title}</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#0a0c10;color:#eef2ff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center}.card{background:rgba(255,255,255,0.05);border-radius:1rem;padding:2rem;max-width:500px}button{background:#4f46e5;border:none;padding:0.5rem 1rem;border-radius:2rem;color:white;cursor:pointer}</style></head><body><div class="card"><h1>${title}</h1><p>${content}</p><button onclick="alert('Hello!')">Click me</button></div></body></html>`;
  } else if (template === 'blog') {
    html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{background:#0a0c10;color:#eef2ff;font-family:system-ui;padding:2rem}article{max-width:800px;margin:auto}</style></head><body><article><h1>${title}</h1><p>${content}</p></article></body></html>`;
  } else {
    return res.status(400).json({ error: 'Invalid template' });
  }
  res.json({ html, template, title });
});

// ---------- FEEDBACK ----------
app.post('/api/feedback', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Missing fields' });
  let feedbackId = null;
  if (dbReady) {
    try {
      const result = await sql`
        INSERT INTO feedback (name, email, message, user_agent)
        VALUES (${name}, ${email}, ${message}, ${req.headers['user-agent']})
        RETURNING id
      `;
      feedbackId = result.rows[0].id;
    } catch (err) { console.error(err); }
  }
  if (!feedbackId) {
    feedbackStore.push({ id: feedbackStore.length + 1, name, email, message, createdAt: new Date().toISOString() });
    feedbackId = feedbackStore.length;
  }
  const confirmHtml = `<html><body><h2>Thank you for your feedback, ${name}!</h2><p>We received your message.</p><p>${message.replace(/\n/g, '<br/>')}</p><p>– BaKangombe Team</p></body></html>`;
  await sendEmail(email, 'We received your feedback', confirmHtml);
  res.json({ success: true, message: 'Thank you! A confirmation email has been sent.' });
});

// ---------- GENERATE PREMIUM KEY (legacy) ----------
app.post('/api/generate-key', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const newKey = `pk_${Math.random().toString(36).substr(2, 16)}`;
  res.json({ apiKey: newKey, message: 'Premium key generated. Save it securely.' });
});

// ========== ADMIN JWT ==========
const JWT_SECRET = process.env.JWT_SECRET || 'ba-kangombe-admin-secret-key-change-in-prod';
const ALLOWED_ADMIN_EMAILS = [
  'bornface.kangombe@cs.unza.zm',
  'bornfacek135@gmail.com'
];
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.adminEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
app.post('/api/admin/login', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!ALLOWED_ADMIN_EMAILS.includes(email)) return res.status(403).json({ error: 'Not authorized' });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ success: true, token, email, expiresIn: '1 hour' });
});
app.get('/api/admin/feedback', verifyAdminToken, async (req, res) => {
  if (dbReady) {
    try {
      const result = await sql`SELECT * FROM feedback ORDER BY created_at DESC`;
      return res.json({ feedback: result.rows, source: 'postgres', admin: req.adminEmail });
    } catch (err) { console.error(err); }
  }
  res.json({ feedback: feedbackStore, source: 'memory', admin: req.adminEmail });
});
app.post('/api/admin/respond', verifyAdminToken, async (req, res) => {
  const { feedbackId, replyMessage, userEmail, userName } = req.body;
  if (!feedbackId || !replyMessage || !userEmail) return res.status(400).json({ error: 'Missing fields' });
  if (dbReady) {
    try {
      await sql`
        INSERT INTO feedback_responses (feedback_id, reply_message, replied_by)
        VALUES (${feedbackId}, ${replyMessage}, ${req.adminEmail})
      `;
    } catch (err) { console.error(err); }
  }
  const html = `<html><body><h2>Response from BaKangombe Support</h2><p>Hello ${userName || 'Valued User'},</p><p>${replyMessage}</p><p>– BaKangombe Team</p></body></html>`;
  const sent = await sendEmail(userEmail, 'Response to your feedback', html);
  res.json({ success: true, emailSent: sent, admin: req.adminEmail });
});
app.delete('/api/admin/feedback/:id', verifyAdminToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  if (dbReady) {
    try {
      await sql`DELETE FROM feedback_responses WHERE feedback_id = ${id}`;
      const result = await sql`DELETE FROM feedback WHERE id = ${id} RETURNING id`;
      if (result.rowCount === 0) return res.status(404).json({ error: 'Feedback not found' });
      return res.json({ success: true, deletedId: id, admin: req.adminEmail });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Delete failed' });
    }
  }
  const index = feedbackStore.findIndex(f => f.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  feedbackStore.splice(index, 1);
  res.json({ success: true, deletedId: id, admin: req.adminEmail });
});
app.get('/api/admin/feedback/:id/responses', verifyAdminToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  if (dbReady) {
    try {
      const result = await sql`SELECT * FROM feedback_responses WHERE feedback_id = ${id} ORDER BY created_at DESC`;
      return res.json({ responses: result.rows });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to fetch responses' });
    }
  }
  res.json({ responses: [] });
});
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, '../public/admin.html')); });

// ---------- PROFESSIONAL DOCUMENTATION PAGE (full HTML) ----------
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BaKangombe API – Complete Documentation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0c10; color: #eef2ff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
    .container { max-width: 1100px; margin: 0 auto; padding: 2rem; }
    .navbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 1rem; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 2rem; }
    .logo { font-size: 1.5rem; font-weight: 700; background: linear-gradient(135deg, #d9a7c7, #fff0d4, #a0c4ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .nav-links { display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .nav-links a { color: #cbd5e6; text-decoration: none; font-weight: 500; transition: color 0.2s; }
    .nav-links a:hover { color: #a0c4ff; }
    h1 { font-size: 2.2rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.6rem; margin: 2rem 0 1rem; color: #a0c4ff; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem; }
    h3 { font-size: 1.2rem; margin: 1.2rem 0 0.5rem; color: #eef2ff; }
    .badge { display: inline-block; background: #4f46e5; padding: 0.2rem 0.7rem; border-radius: 2rem; font-size: 0.7rem; font-weight: 600; margin-left: 0.75rem; vertical-align: middle; }
    .badge.free { background: #10b981; }
    .badge.premium { background: #f59e0b; }
    .endpoint { background: rgba(255,255,255,0.03); border-radius: 0.75rem; padding: 1.2rem; margin: 1rem 0; border: 1px solid rgba(255,255,255,0.08); }
    .method { display: inline-block; background: #4f46e5; padding: 0.2rem 0.7rem; border-radius: 1.5rem; font-size: 0.75rem; font-weight: 700; margin-right: 0.8rem; font-family: monospace; }
    .path { font-family: monospace; font-size: 1rem; word-break: break-all; }
    pre { background: #0f1117; padding: 0.8rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.85rem; margin: 0.8rem 0; border: 1px solid rgba(255,255,255,0.05); }
    code { font-family: monospace; background: #1e293b; padding: 0.2rem 0.4rem; border-radius: 0.3rem; font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.08); }
    th { font-weight: 600; color: #a0c4ff; }
    .copy-btn { background: #1e293b; border: none; padding: 0.2rem 0.7rem; border-radius: 1.5rem; color: #a0c4ff; cursor: pointer; font-size: 0.7rem; font-weight: 500; transition: 0.2s; margin-left: 0.5rem; }
    .copy-btn:hover { background: #4f46e5; color: white; }
    .toast { position: fixed; bottom: 20px; right: 20px; background: #10b981; color: white; padding: 0.5rem 1rem; border-radius: 2rem; font-size: 0.8rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 1000; }
    .footer { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.05); text-align: center; color: #6c7a91; font-size: 0.85rem; }
    @media (max-width: 768px) { .container { padding: 1rem; } .navbar { flex-direction: column; } }
  </style>
</head>
<body>
<div class="container">
  <div class="navbar">
    <div class="logo">BaKangombe</div>
    <div class="nav-links">
      <a href="/#features">Features</a>
      <a href="/#pricing">Pricing</a>
      <a href="/docs">Docs</a>
      <a href="/admin">Admin</a>
      <a href="/new-features">New Features</a>
      <a href="https://github.com/KernelBornie/BaKangombe" target="_blank">GitHub</a>
    </div>
  </div>

  <h1>BaKangombe API Documentation</h1>
  <p>Real‑time email validation, disposable detection, MX lookup, domain reputation scoring, batch CSV, and 16 business modules. All endpoints (except <code>/api/validate</code> and <code>/api/feedback</code>) require a valid <code>X-API-Key</code> header.</p>

  <h2>🔐 Authentication</h2>
  <p>Include your business API key in every request:</p>
  <pre><code>X-API-Key: your_business_api_key</code></pre>
  <p>To obtain a key, register via <code>POST /api/business/register</code> or use the <a href="/new-features">interactive tester</a>.</p>

  <h2>⚡ Rate Limits</h2>
  <table>
    <thead><tr><th>Plan</th><th>Requests per minute</th><th>Monthly cap</th></tr></thead>
    <tbody><tr><td>Free</td><td>100</td><td>Unlimited</td></tr><tr><td>Premium</td><td>10,000</td><td>300,000</td></tr></tbody>
  </table>

  <h2>📧 Email Validation & Enrichment</h2>
  <div class="endpoint">
    <h3><span class="method">POST</span> <span class="path">/api/validate</span> <span class="badge free">Free</span></h3>
    <p>Validates a single email (syntax, MX, disposable, free provider). No API key required.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate -H "Content-Type: application/json" -d '{"email":"user@example.com"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate -H \"Content-Type: application/json\" -d \'{\"email\":\"user@example.com\"}\'')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> <span class="path">/api/enrich</span> <span class="badge premium">Premium</span></h3>
    <p>Enriches an email with company/person data (requires active subscription).</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/enrich -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"email":"bill@microsoft.com"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/enrich -H \"X-API-Key: YOUR_KEY\" -H \"Content-Type: application/json\" -d \'{\"email\":\"bill@microsoft.com\"}\'')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> <span class="path">/api/disposable</span> <span class="badge premium">Premium</span></h3>
    <p>Checks if an email domain is disposable.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/disposable -H "X-API-Key: YOUR_KEY" -d '{"email":"temp@mailinator.com"}'</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> <span class="path">/api/domain/score</span> <span class="badge premium">Premium</span></h3>
    <p>Returns SPF/DKIM/DMARC status and security score (0-100).</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/domain/score -H "X-API-Key: YOUR_KEY" -d '{"domain":"github.com"}'</code></pre>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> <span class="path">/api/validate/batch</span> <span class="badge premium">Premium</span></h3>
    <p>Upload a CSV file (first column emails) and get validation results.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H "X-API-Key: YOUR_KEY" -F "file=@emails.csv"</code></pre>
  </div>

  <h2>🏢 Business Management</h2>
  <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/business/register</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/business/register -H "Content-Type: application/json" -d '{"name":"My Business","email":"contact@example.com"}'</code></pre></div>
  <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/subscription/activate</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/subscription/activate -H "X-API-Key: YOUR_KEY" -d '{"plan":"Pro"}'</code></pre></div>
  <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/system/create</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/system/create -H "X-API-Key: YOUR_KEY" -d '{"service":"clinic"}'</code></pre><p>Available services: <code>business_management</code>, <code>mobile_money</code>, <code>ecommerce</code>, <code>ai_chatbot</code>, <code>clinic</code>, <code>agritech</code>, <code>freelance</code>, <code>discovery</code>, <code>website_builder</code>.</p></div>
  <div class="endpoint"><h3><span class="method">GET</span> <span class="path">/api/business/me</span></h3><pre><code>curl -X GET https://ba-kangombe.vercel.app/api/business/me -H "X-API-Key: YOUR_KEY"</code></pre></div>

  <h2>📦 All 16 Business Modules</h2>
  <p>Each module below requires the corresponding module key (enabled via <code>/api/system/create</code>).</p>

  <h3>1. Mobile Money</h3>
  <ul><li><code>POST /api/momo/transfer</code> – send money</li><li><code>POST /api/momo/request</code> – request money</li><li><code>GET /api/momo/transactions</code> – list transactions</li></ul>

  <h3>2. Invoice & ZRA Billing</h3>
  <ul><li><code>POST /api/invoice/create</code></li><li><code>PUT /api/invoice/:id/pay</code></li><li><code>GET /api/invoice/export/csv</code></li></ul>

  <h3>3. WhatsApp Mini E‑commerce</h3>
  <ul><li><code>POST /api/whatsapp/product</code></li><li><code>GET /api/whatsapp/products</code></li><li><code>POST /api/whatsapp/order</code></li><li><code>GET /api/whatsapp/order/:id/checkout</code></li></ul>

  <h3>4. Logistics & Delivery</h3>
  <ul><li><code>POST /api/logistics/route</code></li><li><code>POST /api/logistics/driver/assign</code></li><li><code>GET /api/logistics/driver/:id/track</code></li></ul>

  <h3>5. Agritech Marketplace</h3>
  <ul><li><code>POST /api/agritech/farmer</code></li><li><code>GET /api/agritech/farmers</code></li><li><code>POST /api/agritech/buyer/match</code></li><li><code>GET /api/agritech/price/intelligence</code></li></ul>

  <h3>6. AI Customer Support</h3>
  <ul><li><code>POST /api/ai/chat</code></li><li><code>POST /api/ai/train</code></li></ul>

  <h3>7. Micro‑Lending</h3>
  <ul><li><code>POST /api/lending/score</code></li><li><code>POST /api/lending/eligibility</code></li></ul>

  <h3>8. SME Dashboard</h3>
  <ul><li><code>POST /api/sme/sale</code></li><li><code>POST /api/sme/expense</code></li><li><code>GET /api/sme/profit</code></li></ul>

  <h3>9. Inventory & POS</h3>
  <ul><li><code>POST /api/inventory/product</code></li><li><code>PUT /api/inventory/stock</code></li><li><code>GET /api/inventory/alerts</code></li><li><code>GET /api/inventory/products</code></li><li><code>POST /api/pos/sale</code></li></ul>

  <h3>10. Social Ads</h3>
  <ul><li><code>POST /api/social/ad/create</code></li><li><code>POST /api/social/ad/budget</code></li><li><code>GET /api/social/leads</code></li><li><code>GET /api/social/ads</code></li></ul>

  <h3>11. Freelance Marketplace</h3>
  <ul><li><code>POST /api/freelance/service</code></li><li><code>GET /api/freelance/services</code></li><li><code>POST /api/freelance/order</code></li><li><code>POST /api/freelance/escrow</code></li><li><code>GET /api/freelance/orders</code></li></ul>

  <h3>12. Clinic Management</h3>
  <ul><li><code>POST /api/clinic/patient</code></li><li><code>GET /api/clinic/patients</code></li><li><code>POST /api/clinic/appointment</code></li><li><code>GET /api/clinic/appointments</code></li><li><code>GET /api/clinic/patient/:id/bill</code></li></ul>

  <h3>13. Identity Verification (KYC)</h3>
  <ul><li><code>POST /api/kyc/id</code></li><li><code>POST /api/kyc/phone</code></li></ul>

  <h3>14. E‑commerce BaaS</h3>
  <ul><li><code>POST /api/ecommerce/product</code></li><li><code>GET /api/ecommerce/products</code></li><li><code>POST /api/ecommerce/order</code></li><li><code>GET /api/ecommerce/orders</code></li><li><code>POST /api/ecommerce/payment</code></li></ul>

  <h3>15. AI Tutoring</h3>
  <ul><li><code>POST /api/tutor/chat</code></li><li><code>GET /api/tutor/curriculum</code></li></ul>

  <h3>16. Local Business Discovery</h3>
  <ul><li><code>POST /api/discovery/business</code></li><li><code>GET /api/discovery/businesses</code></li><li><code>POST /api/discovery/review</code></li><li><code>GET /api/discovery/business/:id/whatsapp</code></li></ul>

  <h2>📝 Feedback & Waitlist</h2>
  <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/feedback</span> <span class="badge free">Free</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/feedback -H "Content-Type: application/json" -d '{"name":"John","email":"john@example.com","message":"Great API!"}'</code></pre></div>
  <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/waitlist</span> <span class="badge free">Free</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/waitlist -d '{"email":"user@example.com"}'</code></pre></div>

  <h2>❌ Error Codes</h2>
  <table>
    <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td>400</td><td>Bad request – missing or invalid JSON</td></tr>
      <tr><td>401</td><td>Unauthorized – API key missing/invalid</td></tr>
      <tr><td>402</td><td>Payment required – subscription needed</td></tr>
      <tr><td>403</td><td>Forbidden – module not enabled</td></tr>
      <tr><td>404</td><td>Not found</td></tr>
      <tr><td>429</td><td>Rate limit exceeded</td></tr>
      <tr><td>500</td><td>Internal server error</td></tr>
    </tbody>
  </table>

  <h2>🔧 Interactive Testing</h2>
  <p>Visit <a href="/new-features">/new-features</a> for a full UI where you can register, activate modules, and test every endpoint live.</p>

  <div class="footer">
    <p>Built by <strong>Bornface Kangombe Kernel</strong> – developer, creator, founder.</p>
    <p><a href="/docs">Documentation</a> · <a href="https://github.com/KernelBornie/BaKangombe">GitHub</a> · <a href="/new-features">Live Demo</a></p>
  </div>
</div>
<div id="toast" class="toast">✓ Copied to clipboard</div>
<script>
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    const toast = document.getElementById('toast');
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }
</script>
</body>
</html>`);
});

// ---------- ONE‑TIME SETUP (run once) ----------
app.get('/api/setup/create-tables', async (req, res) => {
  try {
    await sql`CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      api_key VARCHAR(64) UNIQUE,
      modules TEXT[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS momo_transactions ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), amount NUMERIC, phone VARCHAR(20), provider VARCHAR(10), status VARCHAR(20), type VARCHAR(10), created_at TIMESTAMP DEFAULT NOW() )`;
    await sql`CREATE TABLE IF NOT EXISTS invoices ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), customer VARCHAR(255), amount NUMERIC, items TEXT[], status VARCHAR(20), created_at TIMESTAMP DEFAULT NOW(), paid_at TIMESTAMP )`;
    await sql`CREATE TABLE IF NOT EXISTS whatsapp_products ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), name VARCHAR(255), price NUMERIC, description TEXT )`;
    await sql`CREATE TABLE IF NOT EXISTS whatsapp_orders ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), product_id INTEGER, customer_phone VARCHAR(20), status VARCHAR(20), created_at TIMESTAMP )`;
    await sql`CREATE TABLE IF NOT EXISTS logistics_routes ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), stops JSONB, assigned_driver INTEGER )`;
    await sql`CREATE TABLE IF NOT EXISTS agritech_farmers ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), name VARCHAR(255), crop VARCHAR(100), price NUMERIC, location VARCHAR(255) )`;
    await sql`CREATE TABLE IF NOT EXISTS faqs ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), question TEXT, answer TEXT )`;
    await sql`CREATE TABLE IF NOT EXISTS lending_scores ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), income NUMERIC, debt NUMERIC, history VARCHAR(20), score INTEGER )`;
    await sql`CREATE TABLE IF NOT EXISTS sme_sales ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), amount NUMERIC, customer_id INTEGER, date TIMESTAMP )`;
    await sql`CREATE TABLE IF NOT EXISTS sme_expenses ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), amount NUMERIC, category VARCHAR(100), date TIMESTAMP )`;
    await sql`CREATE TABLE IF NOT EXISTS inventory_products ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), name VARCHAR(255), price NUMERIC, stock INTEGER )`;
    await sql`CREATE TABLE IF NOT EXISTS social_ads ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), name VARCHAR(255), budget NUMERIC, target VARCHAR(255), status VARCHAR(20), leads INTEGER )`;
    await sql`CREATE TABLE IF NOT EXISTS freelance_services ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), title VARCHAR(255), price NUMERIC, seller VARCHAR(255) )`;
    await sql`CREATE TABLE IF NOT EXISTS freelance_orders ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), service_id INTEGER, buyer VARCHAR(255), status VARCHAR(20), created_at TIMESTAMP )`;
    await sql`CREATE TABLE IF NOT EXISTS clinic_patients ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), name VARCHAR(255), phone VARCHAR(20), address TEXT )`;
    await sql`CREATE TABLE IF NOT EXISTS clinic_appointments ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), patient_id INTEGER, date DATE, reason TEXT )`;
    await sql`CREATE TABLE IF NOT EXISTS ecommerce_products ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), name VARCHAR(255), price NUMERIC )`;
    await sql`CREATE TABLE IF NOT EXISTS ecommerce_orders ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), product_id INTEGER, quantity INTEGER, customer VARCHAR(255), status VARCHAR(20) )`;
    await sql`CREATE TABLE IF NOT EXISTS tutor_curriculum ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), grade INTEGER, subject VARCHAR(100), topic VARCHAR(255), content TEXT )`;
    await sql`CREATE TABLE IF NOT EXISTS businesses_list ( id SERIAL PRIMARY KEY, business_id INTEGER REFERENCES businesses(id), name VARCHAR(255), category VARCHAR(100), location VARCHAR(255), whatsapp VARCHAR(20) )`;
    await sql`CREATE TABLE IF NOT EXISTS discovery_reviews (
      id SERIAL PRIMARY KEY,
      business_list_id INTEGER REFERENCES businesses_list(id) ON DELETE CASCADE,
      reviewer_business_id INTEGER REFERENCES businesses(id),
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      plan VARCHAR(100),
      status VARCHAR(30),
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS business_services (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      service_key VARCHAR(100),
      service_name VARCHAR(255),
      modules TEXT[],
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS generated_systems (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      system_name VARCHAR(255),
      system_type VARCHAR(100),
      dashboard_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    res.json({ message: "All tables created/updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== REMAINING MULTI‑TENANT FEATURES (requireModule, placed after tables are ready) ==========
// 1. Mobile Money
app.post('/api/momo/transfer', requireBusiness, requireModule('momo'), async (req, res) => {
  const { amount, phone, provider } = req.body;
  if (!amount || !phone) return res.status(400).json({ error: 'Amount and phone required' });
  const result = await sql`INSERT INTO momo_transactions (business_id, amount, phone, provider, status, type) VALUES (${req.business.id}, ${amount}, ${phone}, ${provider}, 'pending', 'send') RETURNING id`;
  const id = result.rows[0].id;
  setTimeout(async () => { await sql`UPDATE momo_transactions SET status = 'completed' WHERE id = ${id}`; }, 2000);
  res.json({ success: true, transactionId: id, status: 'processing' });
});
app.post('/api/momo/request', requireBusiness, requireModule('momo'), async (req, res) => {
  const { amount, phone, provider } = req.body;
  const result = await sql`INSERT INTO momo_transactions (business_id, amount, phone, provider, status, type) VALUES (${req.business.id}, ${amount}, ${phone}, ${provider}, 'pending', 'request') RETURNING id`;
  res.json({ success: true, transactionId: result.rows[0].id });
});
app.get('/api/momo/transactions', requireBusiness, requireModule('momo'), async (req, res) => {
  const txs = await sql`SELECT * FROM momo_transactions WHERE business_id = ${req.business.id} ORDER BY created_at DESC`;
  res.json({ transactions: txs.rows });
});

// 2. Invoice
app.post('/api/invoice/create', requireBusiness, requireModule('invoice'), async (req, res) => {
  const { customer, amount, items } = req.body;
  const result = await sql`INSERT INTO invoices (business_id, customer, amount, items, status) VALUES (${req.business.id}, ${customer}, ${amount}, ${items}, 'unpaid') RETURNING id, created_at`;
  res.json({ id: result.rows[0].id, customer, amount, items, status: 'unpaid', createdAt: result.rows[0].created_at, paidAt: null });
});
app.get('/api/invoice/:id', requireBusiness, requireModule('invoice'), async (req, res) => {
  const inv = await sql`SELECT * FROM invoices WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (inv.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json(inv.rows[0]);
});
app.put('/api/invoice/:id/pay', requireBusiness, requireModule('invoice'), async (req, res) => {
  await sql`UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
app.get('/api/invoice/export/csv', requireBusiness, requireModule('invoice'), async (req, res) => {
  const invs = await sql`SELECT * FROM invoices WHERE business_id = ${req.business.id}`;
  let csv = 'id,customer,amount,status,createdAt,paidAt\n';
  invs.rows.forEach(i => { csv += `${i.id},${i.customer},${i.amount},${i.status},${i.created_at},${i.paid_at || ''}\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

// 3. WhatsApp
app.post('/api/whatsapp/product', requireBusiness, requireModule('whatsapp'), async (req, res) => {
  const { name, price, description } = req.body;
  const result = await sql`INSERT INTO whatsapp_products (business_id, name, price, description) VALUES (${req.business.id}, ${name}, ${price}, ${description}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, price, description });
});
app.get('/api/whatsapp/products', requireBusiness, requireModule('whatsapp'), async (req, res) => {
  const products = await sql`SELECT * FROM whatsapp_products WHERE business_id = ${req.business.id}`;
  res.json({ products: products.rows });
});
app.post('/api/whatsapp/order', requireBusiness, requireModule('whatsapp'), async (req, res) => {
  const { productId, customerPhone } = req.body;
  const result = await sql`INSERT INTO whatsapp_orders (business_id, product_id, customer_phone, status) VALUES (${req.business.id}, ${productId}, ${customerPhone}, 'pending') RETURNING id, created_at`;
  res.json({ id: result.rows[0].id, productId, customerPhone, status: 'pending', createdAt: result.rows[0].created_at });
});
app.get('/api/whatsapp/order/:id/checkout', requireBusiness, requireModule('whatsapp'), async (req, res) => {
  const order = await sql`SELECT * FROM whatsapp_orders WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (order.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ checkoutLink: `https://wa.me/${order.rows[0].customer_phone}?text=I%20want%20to%20pay%20for%20order%20${req.params.id}` });
});

// 4. Logistics
app.post('/api/logistics/route', requireBusiness, requireModule('logistics'), (req, res) => { res.json({ routeId: Date.now(), stops: req.body.stops }); });
app.post('/api/logistics/driver/assign', requireBusiness, requireModule('logistics'), (req, res) => { res.json({ success: true }); });
app.get('/api/logistics/driver/:id/track', requireBusiness, requireModule('logistics'), (req, res) => { res.json({ location: { lat: -15.3875, lng: 28.3228 } }); });

// 5. Agritech
app.post('/api/agritech/farmer', requireBusiness, requireModule('agritech'), async (req, res) => {
  const { name, crop, price, location } = req.body;
  const result = await sql`INSERT INTO agritech_farmers (business_id, name, crop, price, location) VALUES (${req.business.id}, ${name}, ${crop}, ${price}, ${location}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, crop, price, location });
});
app.get('/api/agritech/farmers', requireBusiness, requireModule('agritech'), async (req, res) => {
  const farmers = await sql`SELECT * FROM agritech_farmers WHERE business_id = ${req.business.id}`;
  res.json({ farmers: farmers.rows });
});
app.post('/api/agritech/buyer/match', requireBusiness, requireModule('agritech'), async (req, res) => {
  const { crop, maxPrice } = req.body;
  const matches = await sql`SELECT * FROM agritech_farmers WHERE business_id = ${req.business.id} AND crop = ${crop} AND price <= ${maxPrice}`;
  res.json({ matches: matches.rows });
});
app.get('/api/agritech/price/intelligence', requireBusiness, requireModule('agritech'), (req, res) => { res.json({ prices: { maize: 120, soy: 250, groundnuts: 300 } }); });

// 6. AI Support
app.post('/api/ai/chat', requireBusiness, requireModule('ai'), async (req, res) => {
  const { query } = req.body;
  const faq = await sql`SELECT answer FROM faqs WHERE business_id = ${req.business.id} AND question ILIKE ${'%' + query + '%'} LIMIT 1`;
  let answer = "I'm still learning. Please ask your business owner.";
  if (faq.rowCount > 0) answer = faq.rows[0].answer;
  res.json({ response: answer });
});
app.post('/api/ai/train', requireBusiness, requireModule('ai'), async (req, res) => {
  const { question, answer } = req.body;
  await sql`INSERT INTO faqs (business_id, question, answer) VALUES (${req.business.id}, ${question}, ${answer})`;
  res.json({ success: true });
});

// 7. Lending
app.post('/api/lending/score', requireBusiness, requireModule('lending'), async (req, res) => {
  const { income, debt, history } = req.body;
  let score = 500;
  if (income > 5000) score += 100;
  if (debt < 1000) score += 50;
  if (history === 'good') score += 150;
  await sql`INSERT INTO lending_scores (business_id, income, debt, history, score) VALUES (${req.business.id}, ${income}, ${debt}, ${history}, ${score})`;
  res.json({ score, risk: score > 600 ? 'low' : 'high' });
});
app.post('/api/lending/eligibility', requireBusiness, requireModule('lending'), (req, res) => {
  const { score, requestedAmount } = req.body;
  const eligible = score > 650 && requestedAmount <= 5000;
  res.json({ eligible, maxAmount: eligible ? 5000 : 0 });
});

// 8. SME
app.post('/api/sme/sale', requireBusiness, requireModule('sme'), async (req, res) => {
  const { amount, customerId } = req.body;
  const result = await sql`INSERT INTO sme_sales (business_id, amount, customer_id, date) VALUES (${req.business.id}, ${amount}, ${customerId}, NOW()) RETURNING id`;
  res.json({ id: result.rows[0].id });
});
app.post('/api/sme/expense', requireBusiness, requireModule('sme'), async (req, res) => {
  const { amount, category } = req.body;
  const result = await sql`INSERT INTO sme_expenses (business_id, amount, category, date) VALUES (${req.business.id}, ${amount}, ${category}, NOW()) RETURNING id`;
  res.json({ id: result.rows[0].id });
});
app.get('/api/sme/profit', requireBusiness, requireModule('sme'), async (req, res) => {
  const sales = await sql`SELECT SUM(amount) as total FROM sme_sales WHERE business_id = ${req.business.id}`;
  const expenses = await sql`SELECT SUM(amount) as total FROM sme_expenses WHERE business_id = ${req.business.id}`;
  const totalSales = sales.rows[0].total || 0;
  const totalExpenses = expenses.rows[0].total || 0;
  res.json({ profit: totalSales - totalExpenses, revenue: totalSales, costs: totalExpenses });
});

// 9. Inventory/POS
app.post('/api/inventory/product', requireBusiness, requireModule('inventory'), async (req, res) => {
  const { name, price, stock } = req.body;
  const result = await sql`INSERT INTO inventory_products (business_id, name, price, stock) VALUES (${req.business.id}, ${name}, ${price}, ${stock}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, price, stock });
});
app.put('/api/inventory/stock', requireBusiness, requireModule('inventory'), async (req, res) => {
  const { productId, quantity } = req.body;
  await sql`UPDATE inventory_products SET stock = stock + ${quantity} WHERE id = ${productId} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
app.get('/api/inventory/alerts', requireBusiness, requireModule('inventory'), async (req, res) => {
  const lowStock = await sql`SELECT * FROM inventory_products WHERE business_id = ${req.business.id} AND stock < 5`;
  res.json({ lowStock: lowStock.rows });
});
app.get('/api/inventory/products', requireBusiness, requireModule('inventory'), async (req, res) => {
  const products = await sql`SELECT * FROM inventory_products WHERE business_id = ${req.business.id}`;
  res.json({ products: products.rows });
});
app.post('/api/pos/sale', requireBusiness, requireModule('inventory'), async (req, res) => {
  const { productId, quantity, paymentMethod } = req.body;
  const product = await sql`SELECT price, stock FROM inventory_products WHERE id = ${productId} AND business_id = ${req.business.id}`;
  if (product.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
  if (product.rows[0].stock < quantity) return res.status(400).json({ error: 'Insufficient stock' });
  await sql`UPDATE inventory_products SET stock = stock - ${quantity} WHERE id = ${productId}`;
  res.json({ success: true, total: product.rows[0].price * quantity, paymentMethod });
});

// 10. Social Ads
app.post('/api/social/ad/create', requireBusiness, requireModule('social_ads'), async (req, res) => {
  const { name, budget, target } = req.body;
  const result = await sql`INSERT INTO social_ads (business_id, name, budget, target, status, leads) VALUES (${req.business.id}, ${name}, ${budget}, ${target}, 'active', 0) RETURNING id`;
  res.json({ id: result.rows[0].id, name, budget, target, status: 'active', leads: 0 });
});
app.post('/api/social/ad/budget', requireBusiness, requireModule('social_ads'), async (req, res) => {
  const { adId, newBudget } = req.body;
  await sql`UPDATE social_ads SET budget = ${newBudget} WHERE id = ${adId} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
app.get('/api/social/leads', requireBusiness, requireModule('social_ads'), async (req, res) => {
  const leads = await sql`SELECT SUM(leads) as total FROM social_ads WHERE business_id = ${req.business.id}`;
  res.json({ leads: leads.rows[0].total || 0 });
});
app.get('/api/social/ads', requireBusiness, requireModule('social_ads'), async (req, res) => {
  const ads = await sql`SELECT * FROM social_ads WHERE business_id = ${req.business.id}`;
  res.json({ ads: ads.rows });
});

// 11. Freelance
app.post('/api/freelance/service', requireBusiness, requireModule('freelance'), async (req, res) => {
  const { title, price, seller } = req.body;
  const result = await sql`INSERT INTO freelance_services (business_id, title, price, seller) VALUES (${req.business.id}, ${title}, ${price}, ${seller}) RETURNING id`;
  res.json({ id: result.rows[0].id, title, price, seller });
});
app.get('/api/freelance/services', requireBusiness, requireModule('freelance'), async (req, res) => {
  const services = await sql`SELECT * FROM freelance_services WHERE business_id = ${req.business.id}`;
  res.json({ services: services.rows });
});
app.post('/api/freelance/order', requireBusiness, requireModule('freelance'), async (req, res) => {
  const { serviceId, buyer } = req.body;
  const result = await sql`INSERT INTO freelance_orders (business_id, service_id, buyer, status) VALUES (${req.business.id}, ${serviceId}, ${buyer}, 'escrow') RETURNING id, created_at`;
  res.json({ id: result.rows[0].id, serviceId, buyer, status: 'escrow', createdAt: result.rows[0].created_at });
});
app.post('/api/freelance/escrow', requireBusiness, requireModule('freelance'), async (req, res) => {
  const { orderId } = req.body;
  await sql`UPDATE freelance_orders SET status = 'released' WHERE id = ${orderId} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
app.get('/api/freelance/orders', requireBusiness, requireModule('freelance'), async (req, res) => {
  const orders = await sql`SELECT * FROM freelance_orders WHERE business_id = ${req.business.id}`;
  res.json({ orders: orders.rows });
});

// 12. Clinic
app.post('/api/clinic/patient', requireBusiness, requireModule('clinic'), async (req, res) => {
  const { name, phone, address } = req.body;
  const result = await sql`INSERT INTO clinic_patients (business_id, name, phone, address) VALUES (${req.business.id}, ${name}, ${phone}, ${address}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, phone, address });
});
app.post('/api/clinic/appointment', requireBusiness, requireModule('clinic'), async (req, res) => {
  const { patientId, date, reason } = req.body;
  const result = await sql`INSERT INTO clinic_appointments (business_id, patient_id, date, reason) VALUES (${req.business.id}, ${patientId}, ${date}, ${reason}) RETURNING id`;
  res.json({ id: result.rows[0].id, patientId, date, reason });
});
app.get('/api/clinic/patient/:id/bill', requireBusiness, requireModule('clinic'), async (req, res) => {
  const patient = await sql`SELECT * FROM clinic_patients WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (patient.rowCount === 0) return res.status(404).json({ error: 'Patient not found' });
  res.json({ patient: patient.rows[0], bill: Math.floor(Math.random() * 500) });
});
app.get('/api/clinic/patients', requireBusiness, requireModule('clinic'), async (req, res) => {
  const patients = await sql`SELECT * FROM clinic_patients WHERE business_id = ${req.business.id}`;
  res.json({ patients: patients.rows });
});
app.get('/api/clinic/appointments', requireBusiness, requireModule('clinic'), async (req, res) => {
  const appointments = await sql`SELECT * FROM clinic_appointments WHERE business_id = ${req.business.id}`;
  res.json({ appointments: appointments.rows });
});

// 13. KYC
app.post('/api/kyc/id', requireBusiness, requireModule('kyc'), (req, res) => {
  const { idNumber, name } = req.body;
  res.json({ verified: idNumber && idNumber.length >= 5, message: idNumber && idNumber.length >= 5 ? 'ID verified' : 'Invalid ID' });
});
app.post('/api/kyc/phone', requireBusiness, requireModule('kyc'), (req, res) => {
  const { phone } = req.body;
  res.json({ verified: phone && phone.length === 10, message: phone && phone.length === 10 ? 'Phone verified' : 'Invalid phone' });
});

// 14. E‑commerce
app.post('/api/ecommerce/product', requireBusiness, requireModule('ecommerce'), async (req, res) => {
  const { name, price } = req.body;
  const result = await sql`INSERT INTO ecommerce_products (business_id, name, price) VALUES (${req.business.id}, ${name}, ${price}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, price });
});
app.get('/api/ecommerce/products', requireBusiness, requireModule('ecommerce'), async (req, res) => {
  const products = await sql`SELECT * FROM ecommerce_products WHERE business_id = ${req.business.id}`;
  res.json({ products: products.rows });
});
app.post('/api/ecommerce/order', requireBusiness, requireModule('ecommerce'), async (req, res) => {
  const { productId, quantity, customer } = req.body;
  const result = await sql`INSERT INTO ecommerce_orders (business_id, product_id, quantity, customer, status) VALUES (${req.business.id}, ${productId}, ${quantity}, ${customer}, 'pending') RETURNING id`;
  res.json({ id: result.rows[0].id, productId, quantity, customer, status: 'pending' });
});
app.post('/api/ecommerce/payment', requireBusiness, requireModule('ecommerce'), async (req, res) => {
  const { orderId, method } = req.body;
  await sql`UPDATE ecommerce_orders SET status = 'paid' WHERE id = ${orderId} AND business_id = ${req.business.id}`;
  res.json({ success: true, paymentMethod: method });
});
app.get('/api/ecommerce/orders', requireBusiness, requireModule('ecommerce'), async (req, res) => {
  const orders = await sql`SELECT * FROM ecommerce_orders WHERE business_id = ${req.business.id}`;
  res.json({ orders: orders.rows });
});

// 15. AI Tutoring
app.post('/api/tutor/chat', requireBusiness, requireModule('tutor'), (req, res) => {
  const { question, grade } = req.body;
  let answer = "I'm here to help with your studies.";
  if (question.includes('algebra')) answer = "Algebra is about solving equations. Example: x + 2 = 5 → x = 3.";
  res.json({ answer });
});
app.get('/api/tutor/curriculum', requireBusiness, requireModule('tutor'), (req, res) => {
  const { grade } = req.query;
  const curriculum = [
    { grade: 10, subject: 'Math', topic: 'Algebra', content: 'Solving linear equations' },
    { grade: 10, subject: 'Science', topic: 'Biology', content: 'Cell structure' }
  ];
  const filtered = curriculum.filter(c => c.grade == grade);
  res.json({ curriculum: filtered });
});

// 16. Local Business Discovery
app.post('/api/discovery/business', requireBusiness, requireModule('discovery'), async (req, res) => {
  const { name, category, location, whatsapp } = req.body;
  const result = await sql`INSERT INTO businesses_list (business_id, name, category, location, whatsapp) VALUES (${req.business.id}, ${name}, ${category}, ${location}, ${whatsapp}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, category, location, whatsapp });
});
app.get('/api/discovery/businesses', requireBusiness, requireModule('discovery'), async (req, res) => {
  const { category } = req.query;
  let query = sql`SELECT * FROM businesses_list WHERE business_id = ${req.business.id}`;
  if (category) query = sql`SELECT * FROM businesses_list WHERE business_id = ${req.business.id} AND category = ${category}`;
  const businesses = await query;
  res.json({ businesses: businesses.rows });
});
app.post('/api/discovery/review', requireBusiness, requireModule('discovery'), async (req, res) => {
  const { businessId, rating, comment } = req.body;
  if (!businessId || !rating) return res.status(400).json({ error: 'Business ID and rating required' });
  const listed = await sql`SELECT id FROM businesses_list WHERE id = ${businessId} AND business_id = ${req.business.id}`;
  if (listed.rowCount === 0) return res.status(404).json({ error: 'Listed business not found' });
  const result = await sql`
    INSERT INTO discovery_reviews (business_list_id, reviewer_business_id, rating, comment)
    VALUES (${businessId}, ${req.business.id}, ${rating}, ${comment})
    RETURNING *
  `;
  res.json({ review: result.rows[0] });
});
app.get('/api/discovery/business/:id/whatsapp', requireBusiness, requireModule('discovery'), async (req, res) => {
  const business = await sql`SELECT whatsapp FROM businesses_list WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (business.rowCount === 0) return res.status(404).json({ error: 'Business not found' });
  res.json({ whatsappLink: `https://wa.me/${business.rows[0].whatsapp}` });
});

// ---------- DEBUG: Check if new-features.html exists ----------
app.get('/debug-file', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '../public/new-features.html');
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      res.json({ exists: false, error: err.message, path: filePath });
    } else {
      res.json({ exists: true, path: filePath });
    }
  });
});
// ========== ADD MODULES TO BUSINESS (for testing) ==========
app.post('/api/business/add-modules', requireBusiness, async (req, res) => {
  const { modules } = req.body; // array of module keys to add
  if (!modules || !Array.isArray(modules)) {
    return res.status(400).json({ error: 'modules array required' });
  }
  let newModules = [...req.business.modules];
  for (const mod of modules) {
    if (!newModules.includes(mod)) newModules.push(mod);
  }
  await sql`
    UPDATE businesses SET modules = ${newModules} WHERE id = ${req.business.id}
  `;
  res.json({ success: true, modules: newModules });
});
// ---------- SERVE NEW FEATURES TESTER PAGE ----------
app.get('/new-features', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/new-features.html'));
});

// ---------- CATCH-ALL ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ---------- LOCAL TEST SERVER ----------
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 BaKangombe local server running on http://localhost:${PORT}`);
    console.log(`📖 Test endpoints: http://localhost:${PORT}/api/validate`);
    console.log(`💰 Multi‑tenant features: /api/momo/transfer, etc. (require API key and module permissions)`);
  });
}
module.exports = app;