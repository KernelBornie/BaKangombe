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

// ---------- SITE SETTINGS (for customisation) ----------
app.get('/api/site/settings', requireBusiness, async (req, res) => {
  try {
    const result = await sql`SELECT * FROM site_settings WHERE business_id = ${req.business.id}`;
    if (result.rowCount === 0) {
      // Return defaults
      return res.json({
        hero_title: null,
        hero_description: null,
        about_content: null,
        contact_email: null,
        contact_phone: null,
        contact_address: null,
        categories: ['Electronics', 'Fashion', 'Home', 'Toys'],
        testimonials: []
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/site/settings', requireBusiness, async (req, res) => {
  const { hero_title, hero_description, about_content, contact_email, contact_phone, contact_address, categories, testimonials } = req.body;
  try {
    await sql`
      INSERT INTO site_settings (business_id, hero_title, hero_description, about_content, contact_email, contact_phone, contact_address, categories, testimonials, updated_at)
      VALUES (${req.business.id}, ${hero_title}, ${hero_description}, ${about_content}, ${contact_email}, ${contact_phone}, ${contact_address}, ${JSON.stringify(categories)}, ${JSON.stringify(testimonials)}, NOW())
      ON CONFLICT (business_id) DO UPDATE SET
        hero_title = EXCLUDED.hero_title,
        hero_description = EXCLUDED.hero_description,
        about_content = EXCLUDED.about_content,
        contact_email = EXCLUDED.contact_email,
        contact_phone = EXCLUDED.contact_phone,
        contact_address = EXCLUDED.contact_address,
        categories = EXCLUDED.categories,
        testimonials = EXCLUDED.testimonials,
        updated_at = NOW()
    `;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// ---------- FULL WEBSITE GENERATOR (Apple‑inspired, editable via admin) ----------
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
    .product-card { transition: transform 0.2s, box-shadow 0.2s; }
    .product-card:hover { transform: translateY(-5px); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); }
    .admin-btn { position: fixed; bottom: 20px; right: 20px; background: #1f2937; color: white; padding: 10px 15px; border-radius: 30px; cursor: pointer; z-index: 1000; font-size: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
    .admin-btn:hover { background: #374151; }
  </style>
  ${extraHead}
</head>
<body class="font-sans antialiased">
  <header class="bg-white shadow-md sticky top-0 z-50">
    <div class="container mx-auto px-4 py-4 flex justify-between items-center flex-wrap">
      <div class="text-2xl font-bold text-blue-600" id="siteTitle">${siteName}</div>
      <nav class="space-x-6">
        <a href="/" class="hover:text-blue-600">Home</a>
        <a href="/products.html" class="hover:text-blue-600">Products</a>
        <a href="/about.html" class="hover:text-blue-600">About</a>
        <a href="/contact.html" class="hover:text-blue-600">Contact</a>
      </nav>
    </div>
  </header>
  <main>${content}</main>
  <footer class="bg-gray-800 text-gray-300 py-12 mt-16">
    <div class="container mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-8">
      <div><h3 class="font-bold text-white mb-2" id="footerSiteName">${siteName}</h3><p class="text-sm">Delivering quality since 2025.</p></div>
      <div><h3 class="font-bold text-white mb-2">Support</h3><ul class="text-sm space-y-1"><li><a href="/contact.html">Contact</a></li><li><a href="#">Returns</a></li><li><a href="#">FAQ</a></li></ul></div>
      <div><h3 class="font-bold text-white mb-2">Legal</h3><ul class="text-sm space-y-1"><li><a href="#">Privacy</a></li><li><a href="#">Terms</a></li></ul></div>
      <div><h3 class="font-bold text-white mb-2">Follow Us</h3><div class="flex space-x-4"><a href="#">📘</a><a href="#">🐦</a><a href="#">📷</a></div></div>
    </div>
    <div class="container mx-auto px-4 text-center text-sm mt-8 pt-4 border-t border-gray-700">
      &copy; ${new Date().getFullYear()} ${siteName}. All rights reserved. | Powered by BaKangombe API
    </div>
  </footer>
  <div class="admin-btn" onclick="window.location.href='/admin.html'">⚙️ Admin</div>
</body>
</html>`;

  // Home page with hero, featured, categories, new arrivals, testimonials, newsletter (all editable via admin)
  const homeScript = `
    let allProducts = [];
    let settings = {};
    async function loadSettings() {
      try {
        const res = await fetch(API_BASE + '/site/settings', { headers: { 'X-API-Key': API_KEY } });
        settings = await res.json();
        document.getElementById('heroTitle').innerText = settings.hero_title || '${siteName}';
        document.getElementById('heroDesc').innerText = settings.hero_description || '${description || 'Quality products, fast delivery, secure payments.'}';
        document.getElementById('featuredTitle').innerText = settings.featured_title || '🔥 Featured Products';
        document.getElementById('newArrivalsTitle').innerText = settings.new_arrivals_title || '✨ New Arrivals';
        document.getElementById('testimonialsTitle').innerText = settings.testimonials_title || 'What Our Customers Say';
        const categories = settings.categories || ['Electronics','Fashion','Home','Toys'];
        const catContainer = document.getElementById('categoriesGrid');
        catContainer.innerHTML = categories.map(c => \`<div class="bg-white p-6 rounded-xl text-center shadow hover:shadow-lg transition"><h3 class="font-bold">\${c}</h3></div>\`).join('');
        const testimonials = settings.testimonials || [];
        const testContainer = document.getElementById('testimonialsGrid');
        if (testimonials.length) {
          testContainer.innerHTML = testimonials.map(t => \`<div class="bg-white p-6 rounded-xl shadow">“\${t.text}” – <strong>\${t.author}</strong></div>\`).join('');
        } else {
          testContainer.innerHTML = \`<div class="bg-white p-6 rounded-xl shadow">“Amazing experience! Fast delivery and great support.” – <strong>Alice</strong></div>
            <div class="bg-white p-6 rounded-xl shadow">“The mobile money checkout was super smooth.” – <strong>Bob</strong></div>
            <div class="bg-white p-6 rounded-xl shadow">“I love the product variety. Will shop again.” – <strong>Carol</strong></div>\`;
        }
      } catch (err) { console.error(err); }
    }
    async function loadProducts() {
      try {
        const res = await fetch(API_BASE + '/ecommerce/products', { headers: { 'X-API-Key': API_KEY } });
        const data = await res.json();
        allProducts = data.products || [];
        renderFeatured(allProducts.slice(0, 6));
        renderNewArrivals(allProducts.slice(6, 12));
      } catch (err) { console.error(err); }
    }
    function renderFeatured(products) {
      const container = document.getElementById('featuredProducts');
      if (!products.length) { container.innerHTML = '<p class="col-span-full">No products yet. Add some via admin.</p>'; return; }
      container.innerHTML = products.map(p => \`
        <div class="product-card bg-white rounded-xl shadow p-4">
          <h3 class="text-lg font-semibold">\${p.name}</h3>
          <p class="text-gray-600">$\${p.price}</p>
          <button onclick="buy(\${p.id})" class="mt-2 bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 w-full">Buy Now</button>
        </div>
      \`).join('');
    }
    function renderNewArrivals(products) {
      const container = document.getElementById('newArrivals');
      if (!products.length) { container.innerHTML = '<p class="col-span-full">More products coming soon.</p>'; return; }
      container.innerHTML = products.map(p => \`
        <div class="product-card bg-white rounded-xl shadow p-4">
          <h3 class="text-lg font-semibold">\${p.name}</h3>
          <p class="text-gray-600">$\${p.price}</p>
          <button onclick="buy(\${p.id})" class="mt-2 bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 w-full">Buy Now</button>
        </div>
      \`).join('');
    }
    async function buy(id) {
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
      if (!email || !email.includes('@')) { alert('Valid email required'); return; }
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
    window.onload = () => { loadSettings(); loadProducts(); };
  `;

  const homeContent = `
    <!-- Hero (editable) -->
    <section class="bg-gradient-to-r from-indigo-700 to-purple-800 text-white py-24">
      <div class="container mx-auto px-4 text-center">
        <h1 id="heroTitle" class="text-5xl md:text-6xl font-extrabold mb-4">${siteName}</h1>
        <p id="heroDesc" class="text-xl max-w-2xl mx-auto">${description || 'Quality products, fast delivery, secure payments.'}</p>
        <div class="mt-8 flex gap-4 justify-center">
          <a href="/products.html" class="bg-white text-indigo-700 px-8 py-3 rounded-full font-semibold hover:bg-gray-100 transition">Shop Now →</a>
          <a href="/about.html" class="border border-white px-8 py-3 rounded-full font-semibold hover:bg-white hover:text-indigo-700 transition">Learn More</a>
        </div>
      </div>
    </section>

    <!-- Featured Products -->
    <section class="container mx-auto px-4 py-16">
      <h2 id="featuredTitle" class="text-3xl font-bold text-center mb-8">🔥 Featured Products</h2>
      <div id="featuredProducts" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">Loading...</div>
    </section>

    <!-- Categories (editable via admin) -->
    <section class="bg-gray-100 py-16">
      <div class="container mx-auto px-4">
        <h2 class="text-3xl font-bold text-center mb-8">Shop by Category</h2>
        <div id="categoriesGrid" class="grid grid-cols-2 md:grid-cols-4 gap-4">Loading...</div>
      </div>
    </section>

    <!-- New Arrivals -->
    <section class="container mx-auto px-4 py-16">
      <h2 id="newArrivalsTitle" class="text-3xl font-bold text-center mb-8">✨ New Arrivals</h2>
      <div id="newArrivals" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">Loading...</div>
    </section>

    <!-- Testimonials (editable) -->
    <section class="bg-indigo-50 py-16">
      <div class="container mx-auto px-4 text-center">
        <h2 id="testimonialsTitle" class="text-3xl font-bold mb-8">What Our Customers Say</h2>
        <div id="testimonialsGrid" class="grid md:grid-cols-3 gap-8">Loading...</div>
      </div>
    </section>

    <!-- Newsletter -->
    <section class="container mx-auto px-4 py-16 text-center">
      <h3 class="text-2xl font-bold mb-4">Subscribe to our Newsletter</h3>
      <div class="max-w-md mx-auto flex gap-2">
        <input type="email" id="newsletterEmail" placeholder="Your email" class="flex-1 px-4 py-2 border rounded-l focus:outline-none">
        <button onclick="subscribeNewsletter()" class="bg-blue-600 text-white px-6 py-2 rounded-r hover:bg-blue-700">Subscribe</button>
      </div>
      <p class="text-gray-600 text-sm mt-2">Get 10% off your first order!</p>
    </section>
  `;

  zip.addFile('index.html', Buffer.from(generatePage('Home', homeContent, '', homeScript), 'utf8'));

  // Products page (full grid + search)
  const productsScript = `
    let allProducts = [];
    function renderProducts(products) {
      const container = document.getElementById('allProducts');
      if (!products.length) { container.innerHTML = '<p class="col-span-full text-center">No products match your search.</p>'; return; }
      container.innerHTML = products.map(p => \`
        <div class="product-card bg-white rounded-xl shadow p-4">
          <h3 class="text-lg font-semibold">\${p.name}</h3>
          <p class="text-gray-600">$\${p.price}</p>
          <button onclick="buy(\${p.id})" class="mt-2 bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 w-full">Buy Now</button>
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
    async function buy(id) {
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
    <div class="container mx-auto px-4 py-12">
      <h1 class="text-4xl font-bold mb-6">All Products</h1>
      <div class="mb-8"><input type="text" id="searchInput" placeholder="Search products..." onkeyup="filterProducts()" class="w-full md:w-1/2 px-4 py-3 border rounded-full focus:outline-none"></div>
      <div id="allProducts" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">Loading...</div>
    </div>
  `;
  zip.addFile('products.html', Buffer.from(generatePage('Products', productsContent, '', productsScript), 'utf8'));

  // About page (editable via admin)
  const aboutScript = `
    async function loadAbout() {
      try {
        const res = await fetch(API_BASE + '/site/settings', { headers: { 'X-API-Key': API_KEY } });
        const data = await res.json();
        document.getElementById('aboutContent').innerHTML = data.about_content || '<p>We are a modern e‑commerce platform dedicated to bringing you the best products at unbeatable prices.</p>';
      } catch (err) { console.error(err); }
    }
    window.onload = loadAbout;
  `;
  const aboutContent = `
    <div class="container mx-auto px-4 py-12 max-w-4xl">
      <h1 class="text-4xl font-bold mb-6">About ${siteName}</h1>
      <div id="aboutContent" class="text-lg">Loading...</div>
    </div>
  `;
  zip.addFile('about.html', Buffer.from(generatePage('About', aboutContent, '', aboutScript), 'utf8'));

  // Contact page (editable via admin)
  const contactScript = `
    async function loadContact() {
      try {
        const res = await fetch(API_BASE + '/site/settings', { headers: { 'X-API-Key': API_KEY } });
        const data = await res.json();
        document.getElementById('contactEmail').innerText = data.contact_email || 'support@${siteName.toLowerCase().replace(/ /g, '')}.com';
        document.getElementById('contactPhone').innerText = data.contact_phone || '+260 97 123 4567';
        document.getElementById('contactAddress').innerText = data.contact_address || 'Lusaka, Zambia';
      } catch (err) { console.error(err); }
    }
    async function sendMessage() {
      const name = document.getElementById('contactName').value;
      const email = document.getElementById('contactEmailInput').value;
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
    window.onload = loadContact;
  `;
  const contactContent = `
    <div class="container mx-auto px-4 py-12 max-w-2xl">
      <h1 class="text-3xl font-bold mb-6">Contact Us</h1>
      <div class="mb-6">
        <p><strong>Email:</strong> <span id="contactEmail"></span></p>
        <p><strong>Phone:</strong> <span id="contactPhone"></span></p>
        <p><strong>Address:</strong> <span id="contactAddress"></span></p>
      </div>
      <form id="contactForm" class="space-y-4">
        <input type="text" id="contactName" placeholder="Your name" class="w-full px-4 py-2 border rounded" required>
        <input type="email" id="contactEmailInput" placeholder="Your email" class="w-full px-4 py-2 border rounded" required>
        <textarea id="contactMessage" rows="5" placeholder="Your message" class="w-full px-4 py-2 border rounded" required></textarea>
        <button type="button" onclick="sendMessage()" class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">Send Message</button>
      </form>
    </div>
  `;
  zip.addFile('contact.html', Buffer.from(generatePage('Contact', contactContent, '', contactScript), 'utf8'));

  // Admin page (password protected)
  const adminHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard – ${siteName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    const API_KEY = '${apiKey}';
    const API_BASE = '${baseUrl}';
    let products = [];
    let settings = {};

    // Simple password protection (change "admin123" to your own)
    const ADMIN_PASSWORD = 'admin123';
    function checkAuth() {
      if (!localStorage.getItem('admin_auth')) {
        const pwd = prompt('Enter admin password:');
        if (pwd !== ADMIN_PASSWORD) {
          alert('Wrong password');
          window.location.href = '/';
          return false;
        }
        localStorage.setItem('admin_auth', 'true');
      }
      return true;
    }
    if (!checkAuth()) throw new Error('Unauthorized');

    async function loadProducts() {
      const res = await fetch(API_BASE + '/ecommerce/products', { headers: { 'X-API-Key': API_KEY } });
      const data = await res.json();
      products = data.products || [];
      renderProductList();
    }
    function renderProductList() {
      const container = document.getElementById('productList');
      if (!products.length) { container.innerHTML = '<tr><td colspan="3" class="text-center">No products. Add one below.</td></tr>'; return; }
      container.innerHTML = products.map(p => \`
        <tr class="border-b">
          <td class="p-2">\${p.name}</td>
          <td class="p-2">$\${p.price}</td>
          <td class="p-2">
            <button onclick="deleteProduct(\${p.id})" class="bg-red-600 text-white px-2 py-1 rounded ml-2">Delete</button>
          </td>
        </tr>
      \`).join('');
    }
    async function addProduct() {
      const name = document.getElementById('prodName').value;
      const price = parseFloat(document.getElementById('prodPrice').value);
      if (!name || isNaN(price)) { alert('Name and price required'); return; }
      const res = await fetch(API_BASE + '/ecommerce/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ name, price })
      });
      if (res.ok) {
        alert('Product added');
        document.getElementById('prodName').value = '';
        document.getElementById('prodPrice').value = '';
        loadProducts();
      } else alert('Error');
    }
    async function deleteProduct(id) {
      if (!confirm('Delete this product?')) return;
      // Add a DELETE endpoint in your backend for production
      alert('Delete not implemented in this demo. Use your backend API.');
    }
    async function loadSettings() {
      const res = await fetch(API_BASE + '/site/settings', { headers: { 'X-API-Key': API_KEY } });
      settings = await res.json();
      document.getElementById('heroTitle').value = settings.hero_title || '';
      document.getElementById('heroDesc').value = settings.hero_description || '';
      document.getElementById('aboutContent').value = settings.about_content || '';
      document.getElementById('contactEmail').value = settings.contact_email || '';
      document.getElementById('contactPhone').value = settings.contact_phone || '';
      document.getElementById('contactAddress').value = settings.contact_address || '';
      document.getElementById('categories').value = (settings.categories || ['Electronics','Fashion','Home','Toys']).join(',');
      document.getElementById('testimonials').value = (settings.testimonials || []).map(t => t.text + '|' + t.author).join('\\n');
    }
    async function saveSettings() {
      const newSettings = {
        hero_title: document.getElementById('heroTitle').value,
        hero_description: document.getElementById('heroDesc').value,
        about_content: document.getElementById('aboutContent').value,
        contact_email: document.getElementById('contactEmail').value,
        contact_phone: document.getElementById('contactPhone').value,
        contact_address: document.getElementById('contactAddress').value,
        categories: document.getElementById('categories').value.split(',').map(s => s.trim()),
        testimonials: document.getElementById('testimonials').value.split('\\n').filter(l => l.trim()).map(l => {
          const [text, author] = l.split('|');
          return { text: text.trim(), author: author ? author.trim() : 'Anonymous' };
        })
      };
      const res = await fetch(API_BASE + '/site/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify(newSettings)
      });
      if (res.ok) alert('Settings saved');
      else alert('Error saving');
    }
    window.onload = () => { loadProducts(); loadSettings(); };
  </script>
</head>
<body class="bg-gray-100 p-8">
  <div class="max-w-6xl mx-auto">
    <h1 class="text-3xl font-bold mb-6">Admin Dashboard – ${siteName}</h1>
    <div class="bg-white p-6 rounded shadow mb-8">
      <h2 class="text-xl font-bold mb-4">Manage Products</h2>
      <div class="mb-4 flex gap-2">
        <input type="text" id="prodName" placeholder="Product name" class="border p-2 rounded flex-1">
        <input type="number" id="prodPrice" placeholder="Price" class="border p-2 rounded w-32">
        <button onclick="addProduct()" class="bg-green-600 text-white px-4 py-2 rounded">Add Product</button>
      </div>
      <table class="w-full border">
        <thead><tr><th>Name</th><th>Price</th><th>Actions</th></tr></thead>
        <tbody id="productList">Loading...</tbody>
      </table>
    </div>
    <div class="bg-white p-6 rounded shadow">
      <h2 class="text-xl font-bold mb-4">Site Settings</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label>Hero Title</label><input id="heroTitle" class="w-full border p-2 rounded"></div>
        <div><label>Hero Description</label><input id="heroDesc" class="w-full border p-2 rounded"></div>
        <div><label>About Content (HTML allowed)</label><textarea id="aboutContent" rows="4" class="w-full border p-2 rounded"></textarea></div>
        <div><label>Contact Email</label><input id="contactEmail" class="w-full border p-2 rounded"></div>
        <div><label>Contact Phone</label><input id="contactPhone" class="w-full border p-2 rounded"></div>
        <div><label>Contact Address</label><input id="contactAddress" class="w-full border p-2 rounded"></div>
        <div><label>Categories (comma separated)</label><input id="categories" class="w-full border p-2 rounded"></div>
        <div><label>Testimonials (one per line: text|author)</label><textarea id="testimonials" rows="4" class="w-full border p-2 rounded"></textarea></div>
      </div>
      <button onclick="saveSettings()" class="bg-blue-600 text-white px-6 py-2 rounded mt-4">Save All Settings</button>
    </div>
    <div class="mt-8 text-center"><a href="/" class="text-blue-600">← Back to site</a></div>
  </div>
</body>
</html>`;
  zip.addFile('admin.html', Buffer.from(adminHtml, 'utf8'));

  // 404 page
  const errorPage = `<!DOCTYPE html><html><head><title>404</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-100 flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-6xl font-bold text-blue-600">404</h1><p class="text-xl mt-4">Page not found.</p><a href="/" class="mt-6 inline-block bg-blue-600 text-white px-6 py-2 rounded">Go Home</a></div></body></html>`;
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
    // Add site_settings table
    await sql`CREATE TABLE IF NOT EXISTS site_settings (
      business_id INTEGER REFERENCES businesses(id) UNIQUE,
      hero_title TEXT,
      hero_description TEXT,
      about_content TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      contact_address TEXT,
      categories JSONB DEFAULT '["Electronics","Fashion","Home","Toys"]',
      testimonials JSONB DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW()
    )`;
    res.json({ message: "All tables created/updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== REMAINING MULTI‑TENANT FEATURES ==========
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
  const { modules } = req.body;
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