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
const AdmZip = require('adm-zip');

const app = express();
app.use(cors());
app.use(express.json());
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
    await sql`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE,
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

// ---------- NEWSLETTER SUBSCRIBE ----------
app.post('/api/newsletter/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  try {
    await sql`INSERT INTO newsletter_subscribers (email) VALUES (${email}) ON CONFLICT (email) DO NOTHING`;
    if (BREVO_API_KEY) {
      await sendEmail(email, 'Welcome to our newsletter!', '<html><body><h2>Thanks for subscribing!</h2><p>You’ll receive updates and offers.</p></body></html>');
    }
    res.json({ success: true, message: 'Subscribed successfully!' });
  } catch (err) {
    console.error('Newsletter error:', err);
    res.status(500).json({ error: 'Subscription failed' });
  }
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

// ========== BUSINESS MULTI‑TENANCY ==========
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

app.post("/api/business/enable-module", requireBusiness, async (req, res) => {
  const { moduleKey } = req.body;
  if (!moduleKey) return res.status(400).json({ error: "moduleKey is required" });
  if (req.business.modules.includes(moduleKey)) {
    return res.json({ success: true, message: "Module already enabled", modules: req.business.modules });
  }
  await sql`
    UPDATE businesses 
    SET modules = array_append(modules, ${moduleKey}) 
    WHERE id = ${req.business.id}
  `;
  req.business.modules.push(moduleKey);
  res.json({ success: true, modules: req.business.modules });
});

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

// ---------- WEBSITE BUILDER (simple HTML snippet) ----------
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

// ---------- FULL WEBSITE GENERATOR (modern e‑commerce ZIP) ----------
app.post('/api/website/generate-full', requireBusiness, requireModule('website'), async (req, res) => {
  const { siteName, description, theme = 'modern' } = req.body;
  if (!siteName) return res.status(400).json({ error: 'siteName required' });

  const zip = new AdmZip();
  const apiKey = req.business.api_key;
  const baseUrl = 'https://ba-kangombe.vercel.app/api';

  const generatePage = (title, content, extraHead = '', extraScript = '') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteName} – ${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    const API_KEY = '${apiKey}';
    const API_BASE = '${baseUrl}';
    ${extraScript}
  </script>
  <style>
    body { background: #f9fafb; color: #111827; }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
  ${extraHead}
</head>
<body class="font-sans antialiased">
  <header class="bg-white shadow-md sticky top-0 z-50">
    <div class="container mx-auto px-4 py-4 flex justify-between items-center flex-wrap">
      <div class="text-2xl font-bold text-blue-600">${siteName}</div>
      <nav class="space-x-6">
        <a href="/" class="hover:text-blue-600">Home</a>
        <a href="/products.html" class="hover:text-blue-600">Products</a>
        <a href="/about.html" class="hover:text-blue-600">About</a>
        <a href="/contact.html" class="hover:text-blue-600">Contact</a>
      </nav>
    </div>
  </header>
  <main>${content}</main>
  <footer class="bg-gray-800 text-gray-300 py-8 mt-12">
    <div class="container mx-auto px-4 text-center">
      <p>&copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.</p>
      <p class="text-sm mt-2">Powered by BaKangombe API</p>
    </div>
  </footer>
</body>
</html>`;

  // Home page with hero, featured products, newsletter
  const homeScript = `
    async function loadFeaturedProducts() {
      try {
        const res = await fetch(API_BASE + '/ecommerce/products', { headers: { 'X-API-Key': API_KEY } });
        const data = await res.json();
        const container = document.getElementById('featuredProducts');
        if (data.products && data.products.length) {
          container.innerHTML = data.products.slice(0, 6).map(p => \`
            <div class="bg-white rounded-lg shadow p-4 transition hover:shadow-lg">
              <h3 class="text-lg font-semibold">\${p.name}</h3>
              <p class="text-gray-600">$\${p.price}</p>
              <button onclick="buyProduct(\${p.id})" class="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Buy Now</button>
            </div>
          \`).join('');
        } else {
          container.innerHTML = '<p class="col-span-full text-center">No products yet. Add some via the admin panel.</p>';
        }
      } catch (err) { console.error(err); }
    }
    async function buyProduct(id) {
      try {
        const res = await fetch(API_BASE + '/ecommerce/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
          body: JSON.stringify({ productId: id, quantity: 1, customer: 'Visitor' })
        });
        const order = await res.json();
        alert('Order created! ID: ' + order.id);
      } catch (err) { alert('Error: ' + err.message); }
    }
    async function subscribeNewsletter() {
      const email = document.getElementById('newsletterEmail').value;
      if (!email || !email.includes('@')) { alert('Please enter a valid email'); return; }
      try {
        const res = await fetch(API_BASE + '/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        alert(data.message || 'Subscribed!');
        document.getElementById('newsletterEmail').value = '';
      } catch (err) { alert('Error: ' + err.message); }
    }
    window.onload = loadFeaturedProducts;
  `;
  const homeContent = `
    <section class="bg-gradient-to-r from-blue-600 to-indigo-700 text-white py-20">
      <div class="container mx-auto px-4 text-center">
        <h1 class="text-5xl font-bold mb-4">${siteName}</h1>
        <p class="text-xl max-w-2xl mx-auto">${description || 'Quality products, fast delivery, secure payments.'}</p>
        <a href="/products.html" class="inline-block mt-6 bg-white text-blue-600 px-8 py-3 rounded-full font-semibold hover:bg-gray-100">Shop Now →</a>
      </div>
    </section>
    <section class="container mx-auto px-4 py-12">
      <h2 class="text-3xl font-bold text-center mb-8">Featured Products</h2>
      <div id="featuredProducts" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">Loading...</div>
    </section>
    <section class="bg-gray-100 py-12">
      <div class="container mx-auto px-4 text-center">
        <h3 class="text-2xl font-bold mb-4">Subscribe to our Newsletter</h3>
        <div class="max-w-md mx-auto flex gap-2">
          <input type="email" id="newsletterEmail" placeholder="Your email" class="flex-1 px-4 py-2 border rounded-l focus:outline-none">
          <button onclick="subscribeNewsletter()" class="bg-blue-600 text-white px-6 py-2 rounded-r hover:bg-blue-700">Subscribe</button>
        </div>
        <p class="text-gray-600 text-sm mt-2">Get 10% off your first order!</p>
      </div>
    </section>
  `;
  zip.addFile('index.html', Buffer.from(generatePage('Home', homeContent, '', homeScript), 'utf8'));

  // Products page with search
  const productsScript = `
    let allProducts = [];
    function renderProducts(products) {
      const container = document.getElementById('allProducts');
      if (!products.length) {
        container.innerHTML = '<p class="col-span-full text-center">No products match your search.</p>';
        return;
      }
      container.innerHTML = products.map(p => \`
        <div class="bg-white rounded-lg shadow p-4">
          <h3 class="text-lg font-semibold">\${p.name}</h3>
          <p class="text-gray-600">$\${p.price}</p>
          <button onclick="buyProduct(\${p.id})" class="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Buy Now</button>
        </div>
      \`).join('');
    }
    async function loadAllProducts() {
      const res = await fetch(API_BASE + '/ecommerce/products', { headers: { 'X-API-Key': API_KEY } });
      const data = await res.json();
      allProducts = data.products || [];
      renderProducts(allProducts);
    }
    function filterProducts() {
      const query = document.getElementById('searchInput').value.toLowerCase();
      const filtered = allProducts.filter(p => p.name.toLowerCase().includes(query));
      renderProducts(filtered);
    }
    async function buyProduct(id) {
      try {
        const res = await fetch(API_BASE + '/ecommerce/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
          body: JSON.stringify({ productId: id, quantity: 1, customer: 'Visitor' })
        });
        const order = await res.json();
        alert('Order created! ID: ' + order.id);
      } catch (err) { alert('Error: ' + err.message); }
    }
    window.onload = loadAllProducts;
  `;
  const productsContent = `
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-3xl font-bold mb-6">All Products</h1>
      <div class="mb-6">
        <input type="text" id="searchInput" placeholder="Search products..." onkeyup="filterProducts()" class="w-full md:w-1/2 px-4 py-2 border rounded focus:outline-none">
      </div>
      <div id="allProducts" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">Loading...</div>
    </div>
  `;
  zip.addFile('products.html', Buffer.from(generatePage('Products', productsContent, '', productsScript), 'utf8'));

  // About page
  const aboutContent = `
    <div class="container mx-auto px-4 py-12 max-w-4xl">
      <h1 class="text-4xl font-bold mb-6">About ${siteName}</h1>
      <p class="text-lg mb-4">We are a modern e‑commerce platform dedicated to bringing you the best products at unbeatable prices. Our mission is to provide a seamless shopping experience with secure payments and fast delivery.</p>
      <p class="text-lg mb-4">${description || 'We leverage the power of BaKangombe API to manage inventory, process orders, and connect with customers.'}</p>
      <p class="text-lg">Thank you for choosing us!</p>
    </div>
  `;
  zip.addFile('about.html', Buffer.from(generatePage('About', aboutContent), 'utf8'));

  // Contact page with feedback form
  const contactScript = `
    async function sendMessage() {
      const name = document.getElementById('contactName').value;
      const email = document.getElementById('contactEmail').value;
      const message = document.getElementById('contactMessage').value;
      if (!name || !email || !message) { alert('Please fill all fields'); return; }
      try {
        const res = await fetch(API_BASE + '/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message })
        });
        const data = await res.json();
        alert(data.message || 'Message sent!');
        document.getElementById('contactForm').reset();
      } catch (err) { alert('Error: ' + err.message); }
    }
  `;
  const contactContent = `
    <div class="container mx-auto px-4 py-12 max-w-2xl">
      <h1 class="text-3xl font-bold mb-6">Contact Us</h1>
      <form id="contactForm" class="space-y-4">
        <input type="text" id="contactName" placeholder="Your name" class="w-full px-4 py-2 border rounded" required>
        <input type="email" id="contactEmail" placeholder="Your email" class="w-full px-4 py-2 border rounded" required>
        <textarea id="contactMessage" rows="5" placeholder="Your message" class="w-full px-4 py-2 border rounded" required></textarea>
        <button type="button" onclick="sendMessage()" class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">Send Message</button>
      </form>
    </div>
  `;
  zip.addFile('contact.html', Buffer.from(generatePage('Contact', contactContent, '', contactScript), 'utf8'));

  // 404 page
  const errorPage = `<!DOCTYPE html><html><head><title>404 - Page Not Found</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-100 flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-6xl font-bold text-blue-600">404</h1><p class="text-xl mt-4">Oops! The page you're looking for doesn't exist.</p><a href="/" class="mt-6 inline-block bg-blue-600 text-white px-6 py-2 rounded">Go Home</a></div></body></html>`;
  zip.addFile('404.html', Buffer.from(errorPage, 'utf8'));

  const zipBuffer = zip.toBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${siteName.replace(/[^a-z0-9]/gi, '_')}.zip"`);
  res.send(zipBuffer);
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

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, '../public/admin.html')); });
app.get('/api/health', async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', database: err.message });
  }
});
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title><style>body{background:#0a0c10;color:#eef2ff;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;text-align:center}.card{background:rgba(255,255,255,0.03);border-radius:1.5rem;padding:2rem;border:1px solid rgba(255,255,255,0.08)}h1{color:#10b981}</style></head><body><div class="card"><h1>✓ Payment Successful!</h1><p>Your premium API key will be sent to your email.</p><a href="/">← Back</a></div></body></html>`);
});

// ---------- DOCUMENTATION (static HTML) ----------
app.get('/docs', (req, res) => { res.sendFile(path.join(__dirname, '../public/docs.html')); });

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

// ========== REMAINING MULTI‑TENANT FEATURES ==========
// (All 16 module endpoints – identical to your original code, omitted for brevity but must be included)
// For the sake of completeness, include all your existing module endpoints here.
// Since you already have them in your code, they remain unchanged.
// I will not repeat them to keep the answer readable, but you must keep them in your final file.

// ... (all your module endpoints: /api/momo/transfer, /api/invoice/create, etc.)

// ---------- SERVE NEW FEATURES TESTER PAGE ----------
app.get('/new-features', (req, res) => { res.sendFile(path.join(__dirname, '../public/new-features.html')); });

// ---------- CATCH-ALL ----------
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, '../public/index.html')); });

// ---------- LOCAL TEST SERVER ----------
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 BaKangombe local server running on http://localhost:${PORT}`);
    console.log(`📖 Test endpoints: http://localhost:${PORT}/api/validate`);
  });
}
module.exports = app;