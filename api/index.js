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

// ---------- Vercel Postgres ----------
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

async function getMxRecords(domain) {
  return cachedDnsResolve(domain, 'mx', async () => {
    try {
      const mx = await dns.resolveMx(domain);
      return mx && mx.length > 0;
    } catch { return false; }
  });
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
app.use('/api/enrich', (req, res, next) => {
  if (req.isPremium) return rateLimitWithHeaders(req, res, next, PREMIUM_LIMIT_MAX);
  next();
});
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
app.use('/api/website/generate', (req, res, next) => {
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

// ---------- ENRICHMENT (enhanced error handling) ----------
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
app.post('/api/enrich', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!HUNTER_API_KEY) {
    console.error('Hunter API key missing');
    return res.status(500).json({ error: 'Enrichment service not configured. Contact support.' });
  }
  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${HUNTER_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data.data;
    res.json({
      email,
      verified: data.status === 'valid',
      accept_all: data.accept_all,
      disposable: data.disposable,
      webmail: data.webmail,
      mx_records: data.mx_records,
      score: data.score,
      name: data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : null,
      company: data.company
    });
  } catch (err) {
    console.error('Hunter API error:', err.response?.data || err.message);
    if (err.response?.status === 401 || err.response?.status === 403) {
      res.status(500).json({ error: 'Invalid Hunter API key. Please update configuration.' });
    } else if (err.response?.status === 429) {
      res.status(500).json({ error: 'Hunter API rate limit exceeded. Try again later.' });
    } else if (err.code === 'ECONNABORTED') {
      res.status(500).json({ error: 'Hunter API timeout. Please retry.' });
    } else {
      res.status(500).json({ error: 'Enrichment failed. Please try again later.' });
    }
  }
});

// ---------- WEBSITE BUILDER ----------
app.post('/api/website/generate', async (req, res) => {
  const { template = 'landing', title = 'My Site', content = 'Welcome!' } = req.body;
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
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

// ---------- GENERATE PREMIUM KEY ----------
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

// ---------- PROFESSIONAL DOCUMENTATION (complete) ----------
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BaKangombe API – Email Validation & Enrichment</title><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0c10;color:#eef2ff;font-family:system-ui;line-height:1.6}.container{max-width:1300px;margin:0 auto;padding:2rem}.docs-layout{display:flex;gap:2rem}.sidebar{width:280px;position:sticky;top:2rem;height:fit-content;background:#0f1117;border-radius:1rem;padding:1.5rem;border:1px solid rgba(255,255,255,0.08)}.sidebar h2{font-size:1.2rem;color:#a0c4ff;margin-bottom:1rem}.sidebar nav ul{list-style:none}.sidebar nav li{margin:0.75rem 0}.sidebar nav a{color:#cbd5e6;text-decoration:none;font-size:0.9rem}.sidebar nav a:hover{color:#4f46e5}.content{flex:1}h1{font-size:2.2rem;background:linear-gradient(135deg,#d9a7c7,#fff0d4,#a0c4ff);-webkit-background-clip:text;background-clip:text;color:transparent}h2{font-size:1.8rem;margin:2rem 0 1rem;color:#a0c4ff;border-bottom:1px solid rgba(255,255,255,0.1)}.badge{display:inline-block;background:#4f46e5;padding:0.2rem 0.7rem;border-radius:2rem;font-size:0.7rem;margin-right:0.75rem}.badge.free{background:#10b981}.badge.premium{background:#f59e0b}.endpoint-card{background:rgba(255,255,255,0.03);border-radius:1rem;padding:1.5rem;margin:1.5rem 0;border:1px solid rgba(255,255,255,0.08)}.method{background:#4f46e5;padding:0.2rem 0.8rem;border-radius:2rem;font-size:0.75rem;margin-right:0.8rem;font-family:monospace}.path{font-family:monospace;font-size:1.1rem}pre{background:#0f1117;padding:1rem;border-radius:0.75rem;overflow:auto;margin:1rem 0}.copy-btn{background:#1e293b;border:none;padding:0.3rem 0.9rem;border-radius:2rem;color:#a0c4ff;cursor:pointer}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{padding:0.75rem;border-bottom:1px solid rgba(255,255,255,0.08)}th{color:#a0c4ff}.toast{position:fixed;bottom:20px;right:20px;background:#10b981;color:#fff;padding:0.5rem 1rem;border-radius:2rem;opacity:0;transition:0.2s;pointer-events:none}@media (max-width:768px){.docs-layout{flex-direction:column}.sidebar{position:static;width:100%}}
</style></head>
<body><div class="container"><div class="docs-layout"><aside class="sidebar"><h2>BaKangombe</h2><nav><ul><li><a href="#overview">Overview</a></li><li><a href="#authentication">Authentication</a></li><li><a href="#base-url">Base URL</a></li><li><a href="#rate-limits">Rate Limits</a></li><li><a href="#endpoints">Endpoints</a><ul style="margin-left:1rem"><li><a href="#validate">Validate Email</a></li><li><a href="#enrich">Enrich Email</a></li><li><a href="#batch">Batch Validation</a></li><li><a href="#domain-score">Domain Score</a></li><li><a href="#disposable">Disposable Check</a></li><li><a href="#website">Website Generator</a></li><li><a href="#feedback">Submit Feedback</a></li></ul></li><li><a href="#errors">Error Codes</a></li><li><a href="#examples">Code Examples</a></li><li><a href="#pricing">Pricing</a></li></ul></nav></aside><main class="content"><h1>BaKangombe API</h1><p>Real‑time email validation, disposable detection, MX lookup, domain reputation scoring, batch CSV, and company enrichment.</p><section id="overview"><h2>Overview</h2><p><strong>BaKangombe</strong> provides email intelligence endpoints. Free tier covers syntax+MX+disposable detection (100 req/min). Premium unlocks batch validation, enrichment (Hunter.io), domain security scoring, and website generation.</p></section><section id="base-url"><h2>Base URL</h2><pre><code>https://ba-kangombe.vercel.app</code></pre></section><section id="authentication"><h2>Authentication</h2><p><span class="badge free">Free</span> No API key for <code>/api/validate</code> and <code>/api/feedback</code>.</p><p><span class="badge premium">Premium</span> All other endpoints require an API key in <code>X-API-Key</code> header.</p><pre><code>curl -H "X-API-Key: YOUR_PREMIUM_KEY" https://ba-kangombe.vercel.app/api/enrich -d '{"email":"user@example.com"}'</code></pre><p>Get premium key at <a href="/#pricing">/pricing</a> then call <code>POST /api/generate-key</code>.</p></section><section id="rate-limits"><h2>Rate Limits</h2><table><thead><tr><th>Plan</th><th>Requests per minute</th><th>Monthly cap</th></tr></thead><tbody><tr><td>Free</td><td>100</td><td>Unlimited</td></tr><tr><td>Premium</td><td>10,000</td><td>300,000</td></tr></tbody></table></section><section id="endpoints"><h2>Endpoints</h2><div id="validate" class="endpoint-card"><h3><span class="method">POST</span> <span class="path">/api/validate</span> <span class="badge free">Free</span></h3><p>Validate email syntax, MX, disposable status, score 0-100.</p><pre><code>{ "email": "user@example.com" }</code></pre><pre><code>{\n  "email": "user@example.com",\n  "valid": true,\n  "has_mx": true,\n  "is_disposable": false,\n  "is_free_provider": false,\n  "score": 100\n}</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate -H \"Content-Type: application/json\" -d \'{\"email\":\"user@example.com\"}\'')">Copy cURL</button></div><div id="enrich" class="endpoint-card"><h3><span class="method">POST</span> <span class="path">/api/enrich</span> <span class="badge premium">Premium</span></h3><p>Enrich email with person and company data (Hunter.io).</p><pre><code>{ "email": "bill.gates@microsoft.com" }</code></pre><pre><code>{\n  "email": "bill.gates@microsoft.com",\n  "verified": true,\n  "accept_all": false,\n  "disposable": false,\n  "webmail": false,\n  "mx_records": true,\n  "score": 95,\n  "name": "Bill Gates",\n  "company": "Microsoft"\n}</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/enrich -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"email\":\"bill.gates@microsoft.com\"}\'')">Copy cURL</button></div><div id="batch" class="endpoint-card"><h3><span class="method">POST</span> <span class="path">/api/validate/batch</span> <span class="badge premium">Premium</span></h3><p>Upload CSV file (first column emails) and get validation results.</p><pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H "X-API-Key: YOUR_KEY" -F "file=@emails.csv"</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H \"X-API-Key: YOUR_KEY\" -F \"file=@emails.csv\"')">Copy cURL</button></div><div id="domain-score" class="endpoint-card"><h3><span class="method">POST</span> <span class="path">/api/domain/score</span> <span class="badge premium">Premium</span></h3><p>Check SPF, DKIM, DMARC, return security score (0-100).</p><pre><code>{ "domain": "github.com" }</code></pre><pre><code>{\n  "domain": "github.com",\n  "spf": true,\n  "dkim": true,\n  "dmarc": true,\n  "score": 100,\n  "recommendation": "Excellent"\n}</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/domain/score -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"domain\":\"github.com\"}\'')">Copy cURL</button></div><div id="disposable" class="endpoint-card"><h3><span class="method">POST</span> <span class="path">/api/disposable</span> <span class="badge premium">Premium</span></h3><p>Check if email belongs to disposable/temporary domain.</p><pre><code>{ "email": "temp@mailinator.com" }</code></pre><pre><code>{ "email": "temp@mailinator.com", "isDisposable": true }</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/disposable -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"email\":\"temp@mailinator.com\"}\'')">Copy cURL</button></div><div id="website" class="endpoint-card"><h3><span class="method">POST</span> <span class="path">/api/website/generate</span> <span class="badge premium">Premium</span></h3><p>Generate a simple landing page or blog HTML.</p><pre><code>{ "template": "landing", "title": "My Startup", "content": "We build awesome tools." }</code></pre><pre><code>{ "html": "<!DOCTYPE html...>", "template": "landing", "title": "My Startup" }</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/website/generate -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"template\":\"landing\",\"title\":\"My Site\",\"content\":\"Hello\"}\'')">Copy cURL</button></div><div id="feedback" class="endpoint-card"><h3><span class="method">POST</span> <span class="path">/api/feedback</span> <span class="badge free">Free</span></h3><p>Submit feedback; confirmation email sent.</p><pre><code>{ "name": "Alice", "email": "alice@example.com", "message": "Great API!" }</code></pre><pre><code>{ "success": true, "message": "Thank you! A confirmation email has been sent." }</code></pre><button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/feedback -H \"Content-Type: application/json\" -d \'{\"name\":\"User\",\"email\":\"user@example.com\",\"message\":\"Great API!\"}\'')">Copy cURL</button></div></section><section id="errors"><h2>Error Codes</h2><table><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody><tr><td>400</td><td>Bad request – missing email/domain or invalid JSON</td></tr><tr><td>402</td><td>Payment required – premium endpoint without valid key</td></tr><tr><td>429</td><td>Rate limit exceeded – slow down or upgrade</td></tr><tr><td>500</td><td>Internal server error – please retry</td></tr></tbody></table></section><section id="examples"><h2>Code Examples</h2><h3>JavaScript (Node.js)</h3><pre><code>const response = await fetch('https://ba-kangombe.vercel.app/api/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@example.com' })
});
const data = await response.json();
console.log(data);</code></pre><button class="copy-btn" onclick="copyToClipboard(`const response = await fetch('https://ba-kangombe.vercel.app/api/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@example.com' })
});
const data = await response.json();
console.log(data);`)">Copy JS</button><h3>Python</h3><pre><code>import requests
res = requests.post('https://ba-kangombe.vercel.app/api/validate',
                    json={'email': 'test@example.com'})
print(res.json())</code></pre><button class="copy-btn" onclick="copyToClipboard(`import requests
res = requests.post('https://ba-kangombe.vercel.app/api/validate',
                    json={'email': 'test@example.com'})
print(res.json())`)">Copy Python</button></section><section id="pricing"><h2>Pricing</h2><table><thead><tr><th>Plan</th><th>Price</th><th>Features</th></tr></thead><tbody><tr><td>Free</td><td>$0</td><td>100 req/min, validation only</td></tr><tr><td>Pro</td><td>$9/month</td><td>10,000 req/min, batch, enrichment, domain score, disposable, website generator</td></tr></tbody></table><p>Subscribe at <a href="/#pricing">https://ba-kangombe.vercel.app/#pricing</a></p></section><p style="margin-top:3rem;text-align:center;color:#6c7a91">Built by Bornface Kangombe. Need help? <a href="mailto:bornface.kangombe@cs.unza.zm">Contact support</a></p></main></div></div><div id="toast" class="toast">✓ Copied</div><script>function copyToClipboard(text){navigator.clipboard.writeText(text);const t=document.getElementById('toast');t.style.opacity='1';setTimeout(()=>t.style.opacity='0',2000);}document.querySelectorAll('a[href^="#"]').forEach(a=>{a.addEventListener('click',function(e){const href=this.getAttribute('href');if(href==='#')return;const t=document.querySelector(href);if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth'});}});});</script></body></html>`);
});

// ---------- STATIC PAGES ----------
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title><style>body{background:#0a0c10;color:#eef2ff;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;text-align:center}.card{background:rgba(255,255,255,0.03);border-radius:1.5rem;padding:2rem;border:1px solid rgba(255,255,255,0.08)}h1{color:#10b981}</style></head><body><div class="card"><h1>✓ Payment Successful!</h1><p>Your premium API key will be sent to your email.</p><a href="/">← Back</a></div></body></html>`);
});
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
    res.json({ message: "All tables created/updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ---------- MULTI‑TENANT FEATURES (all 16, each with requireBusiness) ----------
// 1. Mobile Money
app.post('/api/momo/transfer', requireBusiness, async (req, res) => {
  const { amount, phone, provider } = req.body;
  if (!amount || !phone) return res.status(400).json({ error: 'Amount and phone required' });
  const result = await sql`INSERT INTO momo_transactions (business_id, amount, phone, provider, status, type) VALUES (${req.business.id}, ${amount}, ${phone}, ${provider}, 'pending', 'send') RETURNING id`;
  const id = result.rows[0].id;
  setTimeout(async () => { await sql`UPDATE momo_transactions SET status = 'completed' WHERE id = ${id}`; }, 2000);
  res.json({ success: true, transactionId: id, status: 'processing' });
});
app.post('/api/momo/request', requireBusiness, async (req, res) => {
  const { amount, phone, provider } = req.body;
  const result = await sql`INSERT INTO momo_transactions (business_id, amount, phone, provider, status, type) VALUES (${req.business.id}, ${amount}, ${phone}, ${provider}, 'pending', 'request') RETURNING id`;
  res.json({ success: true, transactionId: result.rows[0].id });
});
app.get('/api/momo/transactions', requireBusiness, async (req, res) => {
  const txs = await sql`SELECT * FROM momo_transactions WHERE business_id = ${req.business.id} ORDER BY created_at DESC`;
  res.json({ transactions: txs.rows });
});
// 2. Invoice
app.post('/api/invoice/create', requireBusiness, async (req, res) => {
  const { customer, amount, items } = req.body;
  const result = await sql`INSERT INTO invoices (business_id, customer, amount, items, status) VALUES (${req.business.id}, ${customer}, ${amount}, ${items}, 'unpaid') RETURNING id, created_at`;
  res.json({ id: result.rows[0].id, customer, amount, items, status: 'unpaid', createdAt: result.rows[0].created_at, paidAt: null });
});
app.get('/api/invoice/:id', requireBusiness, async (req, res) => {
  const inv = await sql`SELECT * FROM invoices WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (inv.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json(inv.rows[0]);
});
app.put('/api/invoice/:id/pay', requireBusiness, async (req, res) => {
  await sql`UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
app.get('/api/invoice/export/csv', requireBusiness, async (req, res) => {
  const invs = await sql`SELECT * FROM invoices WHERE business_id = ${req.business.id}`;
  let csv = 'id,customer,amount,status,createdAt,paidAt\n';
  invs.rows.forEach(i => { csv += `${i.id},${i.customer},${i.amount},${i.status},${i.created_at},${i.paid_at || ''}\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});
// 3. WhatsApp
app.post('/api/whatsapp/product', requireBusiness, async (req, res) => {
  const { name, price, description } = req.body;
  const result = await sql`INSERT INTO whatsapp_products (business_id, name, price, description) VALUES (${req.business.id}, ${name}, ${price}, ${description}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, price, description });
});
app.get('/api/whatsapp/products', requireBusiness, async (req, res) => {
  const products = await sql`SELECT * FROM whatsapp_products WHERE business_id = ${req.business.id}`;
  res.json({ products: products.rows });
});
app.post('/api/whatsapp/order', requireBusiness, async (req, res) => {
  const { productId, customerPhone } = req.body;
  const result = await sql`INSERT INTO whatsapp_orders (business_id, product_id, customer_phone, status) VALUES (${req.business.id}, ${productId}, ${customerPhone}, 'pending') RETURNING id, created_at`;
  res.json({ id: result.rows[0].id, productId, customerPhone, status: 'pending', createdAt: result.rows[0].created_at });
});
app.get('/api/whatsapp/order/:id/checkout', requireBusiness, async (req, res) => {
  const order = await sql`SELECT * FROM whatsapp_orders WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (order.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ checkoutLink: `https://wa.me/${order.rows[0].customer_phone}?text=I%20want%20to%20pay%20for%20order%20${req.params.id}` });
});
// 4. Logistics (simplified mock)
app.post('/api/logistics/route', requireBusiness, (req, res) => { res.json({ routeId: Date.now(), stops: req.body.stops }); });
app.post('/api/logistics/driver/assign', requireBusiness, (req, res) => { res.json({ success: true }); });
app.get('/api/logistics/driver/:id/track', requireBusiness, (req, res) => { res.json({ location: { lat: -15.3875, lng: 28.3228 } }); });
// 5. Agritech
app.post('/api/agritech/farmer', requireBusiness, async (req, res) => {
  const { name, crop, price, location } = req.body;
  const result = await sql`INSERT INTO agritech_farmers (business_id, name, crop, price, location) VALUES (${req.business.id}, ${name}, ${crop}, ${price}, ${location}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, crop, price, location });
});
app.get('/api/agritech/farmers', requireBusiness, async (req, res) => {
  const farmers = await sql`SELECT * FROM agritech_farmers WHERE business_id = ${req.business.id}`;
  res.json({ farmers: farmers.rows });
});
app.post('/api/agritech/buyer/match', requireBusiness, async (req, res) => {
  const { crop, maxPrice } = req.body;
  const matches = await sql`SELECT * FROM agritech_farmers WHERE business_id = ${req.business.id} AND crop = ${crop} AND price <= ${maxPrice}`;
  res.json({ matches: matches.rows });
});
app.get('/api/agritech/price/intelligence', requireBusiness, (req, res) => { res.json({ prices: { maize: 120, soy: 250, groundnuts: 300 } }); });
// 6. AI Support
app.post('/api/ai/chat', requireBusiness, async (req, res) => {
  const { query } = req.body;
  const faq = await sql`SELECT answer FROM faqs WHERE business_id = ${req.business.id} AND question ILIKE ${'%' + query + '%'} LIMIT 1`;
  let answer = "I'm still learning. Please ask your business owner.";
  if (faq.rowCount > 0) answer = faq.rows[0].answer;
  res.json({ response: answer });
});
app.post('/api/ai/train', requireBusiness, async (req, res) => {
  const { question, answer } = req.body;
  await sql`INSERT INTO faqs (business_id, question, answer) VALUES (${req.business.id}, ${question}, ${answer})`;
  res.json({ success: true });
});
// 7. Lending
app.post('/api/lending/score', requireBusiness, async (req, res) => {
  const { income, debt, history } = req.body;
  let score = 500;
  if (income > 5000) score += 100;
  if (debt < 1000) score += 50;
  if (history === 'good') score += 150;
  await sql`INSERT INTO lending_scores (business_id, income, debt, history, score) VALUES (${req.business.id}, ${income}, ${debt}, ${history}, ${score})`;
  res.json({ score, risk: score > 600 ? 'low' : 'high' });
});
app.post('/api/lending/eligibility', requireBusiness, (req, res) => {
  const { score, requestedAmount } = req.body;
  const eligible = score > 650 && requestedAmount <= 5000;
  res.json({ eligible, maxAmount: eligible ? 5000 : 0 });
});
// 8. SME
app.post('/api/sme/sale', requireBusiness, async (req, res) => {
  const { amount, customerId } = req.body;
  const result = await sql`INSERT INTO sme_sales (business_id, amount, customer_id, date) VALUES (${req.business.id}, ${amount}, ${customerId}, NOW()) RETURNING id`;
  res.json({ id: result.rows[0].id });
});
app.post('/api/sme/expense', requireBusiness, async (req, res) => {
  const { amount, category } = req.body;
  const result = await sql`INSERT INTO sme_expenses (business_id, amount, category, date) VALUES (${req.business.id}, ${amount}, ${category}, NOW()) RETURNING id`;
  res.json({ id: result.rows[0].id });
});
app.get('/api/sme/profit', requireBusiness, async (req, res) => {
  const sales = await sql`SELECT SUM(amount) as total FROM sme_sales WHERE business_id = ${req.business.id}`;
  const expenses = await sql`SELECT SUM(amount) as total FROM sme_expenses WHERE business_id = ${req.business.id}`;
  const totalSales = sales.rows[0].total || 0;
  const totalExpenses = expenses.rows[0].total || 0;
  res.json({ profit: totalSales - totalExpenses, revenue: totalSales, costs: totalExpenses });
});
// 9. Inventory/POS
app.post('/api/inventory/product', requireBusiness, async (req, res) => {
  const { name, price, stock } = req.body;
  const result = await sql`INSERT INTO inventory_products (business_id, name, price, stock) VALUES (${req.business.id}, ${name}, ${price}, ${stock}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, price, stock });
});
app.put('/api/inventory/stock', requireBusiness, async (req, res) => {
  const { productId, quantity } = req.body;
  await sql`UPDATE inventory_products SET stock = stock + ${quantity} WHERE id = ${productId} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
app.get('/api/inventory/alerts', requireBusiness, async (req, res) => {
  const lowStock = await sql`SELECT * FROM inventory_products WHERE business_id = ${req.business.id} AND stock < 5`;
  res.json({ lowStock: lowStock.rows });
});
app.post('/api/pos/sale', requireBusiness, async (req, res) => {
  const { productId, quantity, paymentMethod } = req.body;
  const product = await sql`SELECT price, stock FROM inventory_products WHERE id = ${productId} AND business_id = ${req.business.id}`;
  if (product.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
  if (product.rows[0].stock < quantity) return res.status(400).json({ error: 'Insufficient stock' });
  await sql`UPDATE inventory_products SET stock = stock - ${quantity} WHERE id = ${productId}`;
  res.json({ success: true, total: product.rows[0].price * quantity, paymentMethod });
});
// 10. Social Ads
app.post('/api/social/ad/create', requireBusiness, async (req, res) => {
  const { name, budget, target } = req.body;
  const result = await sql`INSERT INTO social_ads (business_id, name, budget, target, status, leads) VALUES (${req.business.id}, ${name}, ${budget}, ${target}, 'active', 0) RETURNING id`;
  res.json({ id: result.rows[0].id, name, budget, target, status: 'active', leads: 0 });
});
app.post('/api/social/ad/budget', requireBusiness, async (req, res) => {
  const { adId, newBudget } = req.body;
  await sql`UPDATE social_ads SET budget = ${newBudget} WHERE id = ${adId} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
app.get('/api/social/leads', requireBusiness, async (req, res) => {
  const leads = await sql`SELECT SUM(leads) as total FROM social_ads WHERE business_id = ${req.business.id}`;
  res.json({ leads: leads.rows[0].total || 0 });
});
// 11. Freelance
app.post('/api/freelance/service', requireBusiness, async (req, res) => {
  const { title, price, seller } = req.body;
  const result = await sql`INSERT INTO freelance_services (business_id, title, price, seller) VALUES (${req.business.id}, ${title}, ${price}, ${seller}) RETURNING id`;
  res.json({ id: result.rows[0].id, title, price, seller });
});
app.get('/api/freelance/services', requireBusiness, async (req, res) => {
  const services = await sql`SELECT * FROM freelance_services WHERE business_id = ${req.business.id}`;
  res.json({ services: services.rows });
});
app.post('/api/freelance/order', requireBusiness, async (req, res) => {
  const { serviceId, buyer } = req.body;
  const result = await sql`INSERT INTO freelance_orders (business_id, service_id, buyer, status) VALUES (${req.business.id}, ${serviceId}, ${buyer}, 'escrow') RETURNING id, created_at`;
  res.json({ id: result.rows[0].id, serviceId, buyer, status: 'escrow', createdAt: result.rows[0].created_at });
});
app.post('/api/freelance/escrow', requireBusiness, async (req, res) => {
  const { orderId } = req.body;
  await sql`UPDATE freelance_orders SET status = 'released' WHERE id = ${orderId} AND business_id = ${req.business.id}`;
  res.json({ success: true });
});
// 12. Clinic
app.post('/api/clinic/patient', requireBusiness, async (req, res) => {
  const { name, phone, address } = req.body;
  const result = await sql`INSERT INTO clinic_patients (business_id, name, phone, address) VALUES (${req.business.id}, ${name}, ${phone}, ${address}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, phone, address });
});
app.post('/api/clinic/appointment', requireBusiness, async (req, res) => {
  const { patientId, date, reason } = req.body;
  const result = await sql`INSERT INTO clinic_appointments (business_id, patient_id, date, reason) VALUES (${req.business.id}, ${patientId}, ${date}, ${reason}) RETURNING id`;
  res.json({ id: result.rows[0].id, patientId, date, reason });
});
app.get('/api/clinic/patient/:id/bill', requireBusiness, async (req, res) => {
  const patient = await sql`SELECT * FROM clinic_patients WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (patient.rowCount === 0) return res.status(404).json({ error: 'Patient not found' });
  res.json({ patient: patient.rows[0], bill: Math.floor(Math.random() * 500) });
});
// 13. KYC (mock)
app.post('/api/kyc/id', requireBusiness, (req, res) => {
  const { idNumber, name } = req.body;
  res.json({ verified: idNumber && idNumber.length >= 5, message: idNumber && idNumber.length >= 5 ? 'ID verified' : 'Invalid ID' });
});
app.post('/api/kyc/phone', requireBusiness, (req, res) => {
  const { phone } = req.body;
  res.json({ verified: phone && phone.length === 10, message: phone && phone.length === 10 ? 'Phone verified' : 'Invalid phone' });
});
// 14. E‑commerce BaaS
app.post('/api/ecommerce/product', requireBusiness, async (req, res) => {
  const { name, price } = req.body;
  const result = await sql`INSERT INTO ecommerce_products (business_id, name, price) VALUES (${req.business.id}, ${name}, ${price}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, price });
});
app.get('/api/ecommerce/products', requireBusiness, async (req, res) => {
  const products = await sql`SELECT * FROM ecommerce_products WHERE business_id = ${req.business.id}`;
  res.json({ products: products.rows });
});
app.post('/api/ecommerce/order', requireBusiness, async (req, res) => {
  const { productId, quantity, customer } = req.body;
  const result = await sql`INSERT INTO ecommerce_orders (business_id, product_id, quantity, customer, status) VALUES (${req.business.id}, ${productId}, ${quantity}, ${customer}, 'pending') RETURNING id`;
  res.json({ id: result.rows[0].id, productId, quantity, customer, status: 'pending' });
});
app.post('/api/ecommerce/payment', requireBusiness, async (req, res) => {
  const { orderId, method } = req.body;
  await sql`UPDATE ecommerce_orders SET status = 'paid' WHERE id = ${orderId} AND business_id = ${req.business.id}`;
  res.json({ success: true, paymentMethod: method });
});
// 15. AI Tutoring
app.post('/api/tutor/chat', requireBusiness, (req, res) => {
  const { question, grade } = req.body;
  let answer = "I'm here to help with your studies.";
  if (question.includes('algebra')) answer = "Algebra is about solving equations. Example: x + 2 = 5 → x = 3.";
  res.json({ answer });
});
app.get('/api/tutor/curriculum', requireBusiness, (req, res) => {
  const { grade } = req.query;
  const curriculum = [
    { grade: 10, subject: 'Math', topic: 'Algebra', content: 'Solving linear equations' },
    { grade: 10, subject: 'Science', topic: 'Biology', content: 'Cell structure' }
  ];
  const filtered = curriculum.filter(c => c.grade == grade);
  res.json({ curriculum: filtered });
});
// 16. Local Business Discovery
app.post('/api/discovery/business', requireBusiness, async (req, res) => {
  const { name, category, location, whatsapp } = req.body;
  const result = await sql`INSERT INTO businesses_list (business_id, name, category, location, whatsapp) VALUES (${req.business.id}, ${name}, ${category}, ${location}, ${whatsapp}) RETURNING id`;
  res.json({ id: result.rows[0].id, name, category, location, whatsapp });
});
app.get('/api/discovery/businesses', requireBusiness, async (req, res) => {
  const { category } = req.query;
  let query = sql`SELECT * FROM businesses_list WHERE business_id = ${req.business.id}`;
  if (category) query = sql`SELECT * FROM businesses_list WHERE business_id = ${req.business.id} AND category = ${category}`;
  const businesses = await query;
  res.json({ businesses: businesses.rows });
});
app.post('/api/discovery/review', requireBusiness, async (req, res) => { res.json({ success: true, reviewId: Date.now() }); });
app.get('/api/discovery/business/:id/whatsapp', requireBusiness, async (req, res) => {
  const business = await sql`SELECT whatsapp FROM businesses_list WHERE id = ${req.params.id} AND business_id = ${req.business.id}`;
  if (business.rowCount === 0) return res.status(404).json({ error: 'Business not found' });
  res.json({ whatsappLink: `https://wa.me/${business.rows[0].whatsapp}` });
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
    console.log(`💰 Multi‑tenant features: /api/momo/transfer, etc. (require API key)`);
  });
}
module.exports = app;