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

// Serve static files from the public folder (one level up from api)
app.use(express.static(path.join(__dirname, '../public')));

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
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const LS_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
  const LS_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;
  const LS_VARIANT_ID = process.env.LEMONSQUEEZY_VARIANT_ID;
  if (!LS_API_KEY || !LS_STORE_ID || !LS_VARIANT_ID) {
    console.error('Missing Lemon Squeezy environment variables');
    return res.status(500).json({ error: 'Payment service not configured. Contact support.' });
  }
  try {
    const response = await axios.post(
      'https://api.lemonsqueezy.com/v1/checkouts',
      {
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: { email, custom: { user_email: email } },
            product_options: {
              redirect_url: 'https://ba-kangombe.vercel.app/success',
              receipt_button_text: 'Go to Dashboard',
              receipt_link_url: 'https://ba-kangombe.vercel.app/dashboard'
            },
            checkout_options: {
              embed: false,
              media: false,
              logo: false,
              desc: false,
              discount: true,
              dark: false
            }
          },
          relationships: {
            store: { data: { type: 'stores', id: LS_STORE_ID } },
            variant: { data: { type: 'variants', id: LS_VARIANT_ID } }
          }
        }
      },
      {
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${LS_API_KEY}`
        },
        timeout: 10000
      }
    );
    const checkoutUrl = response.data.data.attributes.url;
    if (!checkoutUrl) throw new Error('No checkout URL returned');
    res.json({ url: checkoutUrl });
  } catch (err) {
    console.error('Lemon Squeezy checkout error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Checkout failed. Please try again later.' });
  }
});

// ---------- LEMON SQUEEZY WEBHOOK (auto-create business & send API key) ----------
app.post('/api/lemonsqueezy/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const signature = req.headers['x-signature'];
  if (secret && signature !== crypto.createHmac('sha256', secret).update(req.body).digest('hex')) {
    console.error('Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  const event = JSON.parse(req.body);
  const eventName = event.meta.event_name;
  console.log('Webhook received:', eventName);
  if (eventName === 'order_created' || eventName === 'subscription_payment_success') {
    let userEmail, customData;
    if (eventName === 'order_created') {
      userEmail = event.data.attributes.user_email || event.data.attributes.customer_email;
      customData = event.data.attributes.custom_data || {};
    } else {
      userEmail = event.data.attributes.user_email;
      customData = event.meta.custom_data || {};
    }
    if (!userEmail) {
      console.error('No user email in webhook');
      return res.status(400).json({ error: 'No user email' });
    }
    const businessName = customData.business_name || userEmail.split('@')[0];
    const existing = await sql`SELECT id, api_key FROM businesses WHERE email = ${userEmail}`;
    let apiKey;
    if (existing.rowCount > 0) {
      apiKey = existing.rows[0].api_key;
      console.log(`Business already exists for ${userEmail}`);
    } else {
      apiKey = crypto.randomBytes(32).toString('hex');
      await sql`INSERT INTO businesses (name, email, api_key, modules) VALUES (${businessName}, ${userEmail}, ${apiKey}, ARRAY['website'])`;
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);
      await sql`INSERT INTO subscriptions (business_id, plan, status, expires_at) SELECT id, 'Pro', 'active', ${expiresAt} FROM businesses WHERE api_key = ${apiKey}`;
      console.log(`Business created for ${userEmail} with API key ${apiKey}`);
    }
    const apiKeyMessage = `Your API key: ${apiKey}\n\nYou can test your API at: https://ba-kangombe.vercel.app/new-features\nDocumentation: https://ba-kangombe.vercel.app/docs`;
    await sendEmail(userEmail, 'Your BaKangombe API Key', `<html><body><h2>Thank you for subscribing!</h2><p>${apiKeyMessage.replace(/\n/g, '<br>')}</p><p>– BaKangombe Team</p></body></html>`);
    console.log(`API key email sent to ${userEmail}`);
  }
  res.json({ received: true });
});

// ---------- TEST WEBHOOK ENDPOINT (for local testing) ----------
app.post('/api/test-webhook', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const apiKey = crypto.randomBytes(32).toString('hex');
  await sql`INSERT INTO businesses (name, email, api_key, modules) VALUES (${email.split('@')[0]}, ${email}, ${apiKey}, ARRAY['website'])`;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);
  await sql`INSERT INTO subscriptions (business_id, plan, status, expires_at) SELECT id, 'Pro', 'active', ${expiresAt} FROM businesses WHERE api_key = ${apiKey}`;
  await sendEmail(email, 'Your BaKangombe API Key (Test)', `<html><body><h2>Test API Key</h2><p>${apiKey}</p></body></html>`);
  res.json({ success: true, apiKey });
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
  await sql`INSERT INTO subscriptions (business_id, plan, status, expires_at) VALUES (${req.business.id}, ${plan}, 'active', ${expiresAt})`;
  res.json({ success: true, plan, expiresAt });
});

app.post('/api/system/create', requireBusiness, async (req, res) => {
  const { service } = req.body;
  const selected = SERVICE_CATALOG[service];
  if (!selected) return res.status(400).json({ error: 'Unknown service' });
  const dashboardUrl = `/dashboard/${req.business.id}/${service}`;
  await sql`INSERT INTO business_services (business_id, service_key, service_name, modules) VALUES (${req.business.id}, ${service}, ${selected.name}, ${selected.modules})`;
  await sql`INSERT INTO generated_systems (business_id, system_name, system_type, dashboard_url) VALUES (${req.business.id}, ${selected.name}, ${service}, ${dashboardUrl})`;
  let newModules = [...req.business.modules];
  for (const mod of selected.modules) {
    if (!newModules.includes(mod)) newModules.push(mod);
  }
  await sql`UPDATE businesses SET modules = ${newModules} WHERE id = ${req.business.id}`;
  req.business.modules = newModules;
  res.json({ success: true, system: selected.name, modules: selected.modules, dashboardUrl });
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

// ---------- ENRICHMENT ----------
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
app.post('/api/enrich', requireBusiness, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!HUNTER_API_KEY) return res.status(500).json({ error: 'Enrichment service not configured. Contact support.' });
  try {
    const sub = await sql`SELECT * FROM subscriptions WHERE business_id = ${req.business.id} AND status = 'active' AND expires_at > NOW() LIMIT 1`;
    if (sub.rowCount === 0) return res.status(402).json({ error: 'Active subscription required for enrichment. Please subscribe.' });
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
    res.status(500).json({ error: 'Enrichment failed. Check Hunter API key or try again later.', details: err.response?.data?.message || err.message });
  }
});

// ---------- WEBSITE BUILDER ----------
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
      const result = await sql`INSERT INTO feedback (name, email, message, user_agent) VALUES (${name}, ${email}, ${message}, ${req.headers['user-agent']}) RETURNING id`;
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
      await sql`INSERT INTO feedback_responses (feedback_id, reply_message, replied_by) VALUES (${feedbackId}, ${replyMessage}, ${req.adminEmail})`;
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

// Admin page (static HTML)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ---------- HEALTH CHECK ENDPOINT ----------
app.get('/api/health', async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', database: err.message });
  }
});

// ---------- SUCCESS PAGE (after payment) ----------
app.get('/success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful - BaKangombe</title>
      <style>
        body { background: #0a0c10; color: #eef2ff; font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; margin: 0; }
        .card { background: rgba(255,255,255,0.03); border-radius: 1.5rem; padding: 2rem; border: 1px solid rgba(255,255,255,0.08); max-width: 500px; }
        h1 { color: #10b981; }
        .btn { display: inline-block; margin-top: 1rem; padding: 0.75rem 1.5rem; background: #4f46e5; color: white; border-radius: 2rem; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>✓ Payment Successful!</h1>
        <p>Thank you for subscribing to BaKangombe Premium.</p>
        <p>Your API key will be sent to your email within a few minutes.</p>
        <p>You can also register a business manually at <a href="/new-features" style="color:#a0c4ff;">/new-features</a>.</p>
        <a href="/" class="btn">← Back to Home</a>
      </div>
    </body>
    </html>
  `);
});

// ---------- PROFESSIONAL, INTERACTIVE, COMPREHENSIVE DOCUMENTATION ----------
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BaKangombe · Complete API Documentation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; scroll-behavior: smooth; }
    body { background: #f5f2e8; color: #1e1a16; font-family: 'Georgia', 'Times New Roman', Times, serif; line-height: 1.7; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; background: #fffef7; box-shadow: 0 0 30px rgba(0,0,0,0.05); }
    .nav-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; padding-bottom: 1rem; margin-bottom: 2rem; border-bottom: 1px solid #e2dcd0; font-family: system-ui, -apple-system, sans-serif; }
    .logo { font-size: 1.6rem; font-weight: 700; background: linear-gradient(135deg, #8b5a2b, #c49a6c); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .nav-links { display: flex; gap: 1.5rem; }
    .nav-links a { text-decoration: none; color: #5a3e2b; font-weight: 500; transition: color 0.2s; }
    .nav-links a:hover { color: #8b5a2b; }
    .toc-container { position: sticky; top: 2rem; float: right; width: 280px; margin-left: 2rem; margin-bottom: 2rem; background: #faf8f3; border-left: 4px solid #c49a6c; padding: 1rem; font-family: system-ui, sans-serif; font-size: 0.9rem; border-radius: 0 8px 8px 0; }
    .toc-container h2 { font-size: 1.2rem; margin-bottom: 0.5rem; font-weight: 600; }
    .toc-container ul { list-style: none; max-height: 80vh; overflow-y: auto; }
    .toc-container li { margin: 0.5rem 0; }
    .toc-container a { text-decoration: none; color: #5a3e2b; display: block; padding: 0.2rem 0; transition: 0.2s; }
    .toc-container a:hover { color: #8b5a2b; text-decoration: underline; }
    .main-content { overflow: hidden; }
    h1, h2, h3 { font-weight: normal; letter-spacing: -0.3px; margin-top: 2rem; }
    h1 { font-size: 2.8rem; margin-top: 0; }
    h2 { font-size: 1.8rem; border-bottom: 1px solid #e2dcd0; padding-bottom: 0.3rem; margin-top: 2rem; }
    h3 { font-size: 1.4rem; margin: 1.5rem 0 0.5rem; color: #4a3724; }
    .endpoint { margin: 1.5rem 0; padding: 1rem 1.5rem; background: #fefcf8; border-left: 3px solid #c49a6c; border-radius: 0 8px 8px 0; }
    .method { display: inline-block; background: #2c5f2d; color: white; font-family: monospace; font-size: 0.7rem; padding: 0.2rem 0.6rem; border-radius: 20px; margin-right: 0.8rem; vertical-align: middle; }
    .method.free { background: #2c5f2d; }
    .method.premium { background: #b76e2e; }
    .path { font-family: monospace; font-size: 1rem; }
    pre { background: #2d2a24; color: #f5e6d3; padding: 0.8rem; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; margin: 0.8rem 0; }
    code { font-family: monospace; background: #f0ede8; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; color: #3b2a1f; }
    .copy-btn { background: #e2dcd0; border: none; padding: 0.2rem 0.7rem; border-radius: 20px; font-size: 0.7rem; cursor: pointer; margin-left: 0.5rem; }
    .copy-btn:hover { background: #c49a6c; color: white; }
    .diagram { background: #fef8ef; border: 1px dashed #c49a6c; padding: 1rem; margin: 1rem 0; font-family: monospace; white-space: pre; overflow-x: auto; font-size: 0.8rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #e2dcd0; padding: 0.5rem; text-align: left; }
    th { background: #faf8f3; font-weight: 600; }
    footer { margin-top: 3rem; text-align: center; font-size: 0.8rem; color: #9b8a7a; border-top: 1px solid #e2dcd0; padding-top: 2rem; clear: both; }
    @media (max-width: 900px) { .toc-container { float: none; width: 100%; margin: 0 0 2rem 0; position: static; } }
  </style>
</head>
<body>
<div class="container">
  <div class="nav-bar">
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
  <div class="toc-container">
    <h2>📖 Contents</h2>
    <ul>
      <li><a href="#auth">🔐 Authentication & Rate Limits</a></li>
      <li><a href="#email">📧 Email Validation & Enrichment</a></li>
      <li><a href="#business">🏢 Business Management</a></li>
      <li><a href="#modules">📦 The 16 Business Modules</a>
        <ul style="margin-left: 1rem; list-style: circle;">
          <li><a href="#mod1">1. Mobile Money</a></li>
          <li><a href="#mod2">2. Invoice & ZRA Billing</a></li>
          <li><a href="#mod3">3. WhatsApp Mini E‑commerce</a></li>
          <li><a href="#mod4">4. Logistics & Delivery</a></li>
          <li><a href="#mod5">5. Agritech Marketplace</a></li>
          <li><a href="#mod6">6. AI Customer Support</a></li>
          <li><a href="#mod7">7. Micro‑Lending</a></li>
          <li><a href="#mod8">8. SME Dashboard</a></li>
          <li><a href="#mod9">9. Inventory & POS</a></li>
          <li><a href="#mod10">10. Social Ads</a></li>
          <li><a href="#mod11">11. Freelance Marketplace</a></li>
          <li><a href="#mod12">12. Clinic Management</a></li>
          <li><a href="#mod13">13. Identity Verification (KYC)</a></li>
          <li><a href="#mod14">14. E‑commerce BaaS</a></li>
          <li><a href="#mod15">15. AI Tutoring</a></li>
          <li><a href="#mod16">16. Local Business Discovery</a></li>
        </ul>
      </li>
      <li><a href="#feedback">📝 Feedback & Waitlist</a></li>
      <li><a href="#errors">❌ Error Codes</a></li>
    </ul>
  </div>
  <div class="main-content">
    <h1>BaKangombe</h1>
    <p style="font-size:1.2rem">Complete API Reference · Email Validation & 16 Business Systems</p>
    <p>BaKangombe is a unified platform that provides email intelligence (validation, enrichment, disposable detection, domain scoring) and a full suite of 16 ready‑to‑use business modules. Whether you're a startup, an enterprise, or a developer, you can integrate any of these modules via a single API key and start building immediately.</p>
    <h2 id="auth">🔐 Authentication & Rate Limits</h2>
    <p>All endpoints except <code>/api/validate</code> and <code>/api/feedback</code> require a valid <code>X-API-Key</code> header containing your business API key. This ensures that your data is isolated and secure.</p>
    <pre><code>X-API-Key: your_business_api_key</code></pre>
    <p>To obtain a key, call <code>POST /api/business/register</code> or use the <a href="/new-features">interactive tester</a>. Each business owns its own data – no cross‑tenant access is possible.</p>
    <h3>Rate Limits</h3>
    <table>
      <thead><tr><th>Plan</th><th>Requests per minute</th><th>Monthly cap</th></tr></thead>
      <tbody><tr><td>Free</td><td>100</td><td>Unlimited</td></tr><tr><td>Premium</td><td>10,000</td><td>300,000</td></tr></tbody>
    </table>
    <p>When you exceed the limit, the API returns HTTP 429 with a <code>Retry-After</code> header. We recommend implementing exponential backoff in your clients.</p>

    <h2 id="email">📧 Email Validation & Enrichment</h2>
    <p>These endpoints are the core of BaKangombe's email intelligence. They use advanced DNS checks, real‑time MX lookups, and (for enrichment) the Hunter.io API to return verified company and person data.</p>
    <div class="endpoint"><h3><span class="method free">POST</span> <span class="path">/api/validate</span></h3><p>Validates a single email address. Checks syntax, MX records, disposable domain, and free provider status. Returns a quality score (0–100). No API key required.</p><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate -H "Content-Type: application/json" -d '{"email":"user@example.com"}'</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate -H \"Content-Type: application/json\" -d \'{\"email\":\"user@example.com\"}\'')">Copy</button></div>
    <div class="endpoint"><h3><span class="method premium">POST</span> <span class="path">/api/enrich</span></h3><p>Enriches an email with company/person data (name, company, verification status). Requires an active subscription and a valid Hunter.io API key on the server.</p><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/enrich -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"email":"bill@microsoft.com"}'</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/enrich -H \"X-API-Key: YOUR_KEY\" -H \"Content-Type: application/json\" -d \'{\"email\":\"bill@microsoft.com\"}\'')">Copy</button></div>
    <div class="endpoint"><h3><span class="method premium">POST</span> <span class="path">/api/disposable</span></h3><p>Checks if an email domain is disposable (e.g., mailinator.com). Useful to block temporary signups.</p><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/disposable -H "X-API-Key: YOUR_KEY" -d '{"email":"temp@mailinator.com"}'</code></pre></div>
    <div class="endpoint"><h3><span class="method premium">POST</span> <span class="path">/api/domain/score</span></h3><p>Returns SPF, DKIM and DMARC status and a security score (0–100) for any domain. Helps assess email deliverability.</p><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/domain/score -H "X-API-Key: YOUR_KEY" -d '{"domain":"github.com"}'</code></pre></div>
    <div class="endpoint"><h3><span class="method premium">POST</span> <span class="path">/api/validate/batch</span></h3><p>Upload a CSV file where the first column contains email addresses. Returns validation results for every row. Ideal for cleaning large lists.</p><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H "X-API-Key: YOUR_KEY" -F "file=@emails.csv"</code></pre></div>

    <h2 id="business">🏢 Business Management</h2>
    <p>These endpoints handle business registration, subscription management, and system activation. They are the entry point for any customer.</p>
    <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/business/register</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/business/register -H "Content-Type: application/json" -d '{"name":"My Business","email":"contact@example.com"}'</code></pre></div>
    <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/subscription/activate</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/subscription/activate -H "X-API-Key: YOUR_KEY" -d '{"plan":"Pro"}'</code></pre><p>Activates a monthly subscription. The expires_at field is set to one month from now.</p></div>
    <div class="endpoint"><h3><span class="method">POST</span> <span class="path">/api/system/create</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/system/create -H "X-API-Key: YOUR_KEY" -d '{"service":"clinic"}'</code></pre><p>Available services: <code>business_management</code>, <code>mobile_money</code>, <code>ecommerce</code>, <code>ai_chatbot</code>, <code>clinic</code>, <code>agritech</code>, <code>freelance</code>, <code>discovery</code>, <code>website_builder</code>. This endpoint enables the required modules for the chosen system.</p></div>
    <div class="endpoint"><h3><span class="method">GET</span> <span class="path">/api/business/me</span></h3><pre><code>curl -X GET https://ba-kangombe.vercel.app/api/business/me -H "X-API-Key: YOUR_KEY"</code></pre><p>Returns the current business profile, including the list of enabled modules.</p></div>

    <h2 id="modules">📦 The 16 Business Modules</h2>
    <p>Each module is a complete sub‑system that you can enable via <code>/api/system/create</code>. All endpoints require the corresponding module key (e.g., <code>'momo'</code>, <code>'invoice'</code>, <code>'clinic'</code>) and are secured by the <code>requireModule</code> middleware.</p>
    <h3 id="mod1">1. Mobile Money <code>momo</code></h3>
    <p>Simulate mobile money transfers and requests. All transactions are stored per business and can be listed.</p>
    <ul><li><code>POST /api/momo/transfer</code> – send money (amount, phone, provider)</li><li><code>POST /api/momo/request</code> – request money</li><li><code>GET /api/momo/transactions</code> – list all transactions</li></ul>
    <div class="diagram">Mobile Money flow: Customer A → POST /momo/transfer → transaction created (status processing) → after 2 seconds → status completed.</div>
    <h3 id="mod2">2. Invoice & ZRA Billing <code>invoice</code></h3>
    <ul><li><code>POST /api/invoice/create</code></li><li><code>PUT /api/invoice/:id/pay</code></li><li><code>GET /api/invoice/export/csv</code></li></ul>
    <h3 id="mod3">3. WhatsApp Mini E‑commerce <code>whatsapp</code></h3>
    <ul><li><code>POST /api/whatsapp/product</code></li><li><code>GET /api/whatsapp/products</code></li><li><code>POST /api/whatsapp/order</code></li><li><code>GET /api/whatsapp/order/:id/checkout</code></li></ul>
    <h3 id="mod4">4. Logistics & Delivery <code>logistics</code></h3>
    <ul><li><code>POST /api/logistics/route</code></li><li><code>POST /api/logistics/driver/assign</code></li><li><code>GET /api/logistics/driver/:id/track</code></li></ul>
    <h3 id="mod5">5. Agritech Marketplace <code>agritech</code></h3>
    <ul><li><code>POST /api/agritech/farmer</code></li><li><code>GET /api/agritech/farmers</code></li><li><code>POST /api/agritech/buyer/match</code></li><li><code>GET /api/agritech/price/intelligence</code></li></ul>
    <div class="diagram">Agritech flow: Farmer (name, crop, price, location) → POST /farmer → stored. Buyer → POST /buyer/match?crop=maize&maxPrice=200 → returns matching farmers.</div>
    <h3 id="mod6">6. AI Customer Support <code>ai</code></h3>
    <ul><li><code>POST /api/ai/chat</code></li><li><code>POST /api/ai/train</code></li></ul>
    <h3 id="mod7">7. Micro‑Lending <code>lending</code></h3>
    <ul><li><code>POST /api/lending/score</code></li><li><code>POST /api/lending/eligibility</code></li></ul>
    <h3 id="mod8">8. SME Dashboard <code>sme</code></h3>
    <ul><li><code>POST /api/sme/sale</code></li><li><code>POST /api/sme/expense</code></li><li><code>GET /api/sme/profit</code></li></ul>
    <h3 id="mod9">9. Inventory & POS <code>inventory</code></h3>
    <ul><li><code>POST /api/inventory/product</code></li><li><code>PUT /api/inventory/stock</code></li><li><code>GET /api/inventory/alerts</code></li><li><code>GET /api/inventory/products</code></li><li><code>POST /api/pos/sale</code></li></ul>
    <h3 id="mod10">10. Social Ads <code>social_ads</code></h3>
    <ul><li><code>POST /api/social/ad/create</code></li><li><code>POST /api/social/ad/budget</code></li><li><code>GET /api/social/leads</code></li><li><code>GET /api/social/ads</code></li></ul>
    <h3 id="mod11">11. Freelance Marketplace <code>freelance</code></h3>
    <ul><li><code>POST /api/freelance/service</code></li><li><code>GET /api/freelance/services</code></li><li><code>POST /api/freelance/order</code></li><li><code>POST /api/freelance/escrow</code></li><li><code>GET /api/freelance/orders</code></li></ul>
    <h3 id="mod12">12. Clinic Management <code>clinic</code></h3>
    <ul><li><code>POST /api/clinic/patient</code></li><li><code>GET /api/clinic/patients</code></li><li><code>POST /api/clinic/appointment</code></li><li><code>GET /api/clinic/appointments</code></li><li><code>GET /api/clinic/patient/:id/bill</code></li></ul>
    <h3 id="mod13">13. Identity Verification (KYC) <code>kyc</code></h3>
    <ul><li><code>POST /api/kyc/id</code></li><li><code>POST /api/kyc/phone</code></li></ul>
    <h3 id="mod14">14. E‑commerce BaaS <code>ecommerce</code></h3>
    <ul><li><code>POST /api/ecommerce/product</code></li><li><code>GET /api/ecommerce/products</code></li><li><code>POST /api/ecommerce/order</code></li><li><code>GET /api/ecommerce/orders</code></li><li><code>POST /api/ecommerce/payment</code></li></ul>
    <h3 id="mod15">15. AI Tutoring <code>tutor</code></h3>
    <ul><li><code>POST /api/tutor/chat</code></li><li><code>GET /api/tutor/curriculum</code></li></ul>
    <h3 id="mod16">16. Local Business Discovery <code>discovery</code></h3>
    <ul><li><code>POST /api/discovery/business</code></li><li><code>GET /api/discovery/businesses</code></li><li><code>POST /api/discovery/review</code></li><li><code>GET /api/discovery/business/:id/whatsapp</code></li></ul>

    <h2 id="feedback">📝 Feedback & Waitlist</h2>
    <div class="endpoint"><h3><span class="method free">POST</span> <span class="path">/api/feedback</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/feedback -H "Content-Type: application/json" -d '{"name":"John","email":"john@example.com","message":"Great API!"}'</code></pre><p>Sends a confirmation email to the user and stores the feedback in the database.</p></div>
    <div class="endpoint"><h3><span class="method free">POST</span> <span class="path">/api/waitlist</span></h3><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/waitlist -d '{"email":"user@example.com"}'</code></pre><p>Adds an email to the waitlist and sends a welcome email (if Brevo API key is configured).</p></div>

    <h2 id="errors">❌ Error Codes</h2>
    <table>
      <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
      <tbody>
        <tr><td>400</td><td>Bad request – missing or invalid JSON</td></tr>
        <tr><td>401</td><td>Unauthorized – API key missing or invalid</td></tr>
        <tr><td>402</td><td>Payment required – subscription needed for enrichment</td></tr>
        <tr><td>403</td><td>Forbidden – module not enabled for this business</td></tr>
        <tr><td>404</td><td>Not found – resource does not exist</td></tr>
        <tr><td>429</td><td>Rate limit exceeded</td></tr>
        <tr><td>500</td><td>Internal server error – check logs</td></tr>
      </tbody>
    </table>

    <h2>🔧 Interactive Testing</h2>
    <p>Visit <a href="/new-features">/new-features</a> for a full UI where you can register, activate modules, and test every endpoint live. The tester uses the same API key and shows real‑time responses.</p>
  </div>
  <footer>
    <p>Built by <strong>Bornface Kangombe Kernel</strong> – developer, creator, founder.</p>
    <p><a href="/docs">Documentation</a> · <a href="https://github.com/KernelBornie/BaKangombe">GitHub</a> · <a href="/new-features">Live Demo</a></p>
  </footer>
</div>
<script>
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    const toast = document.createElement('div');
    toast.innerText = '✓ Copied to clipboard';
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.background = '#2c5f2d';
    toast.style.color = 'white';
    toast.style.padding = '0.5rem 1rem';
    toast.style.borderRadius = '2rem';
    toast.style.fontSize = '0.8rem';
    toast.style.zIndex = '1000';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }
</script>
</body>
</html>`);
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