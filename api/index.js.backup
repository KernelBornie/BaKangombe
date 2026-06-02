require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { faker } = require('@faker-js/faker');
const axios = require('axios');
const dns = require('dns').promises;
const { sql } = require('@vercel/postgres');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');

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
    console.error('Vercel Postgres error:', err);
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

// ---------- Rate limiting ----------
const FREE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100;
const PREMIUM_LIMIT_MAX = 10000;

const freeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: FREE_LIMIT_MAX,
  message: { error: `Rate limit exceeded. Free tier: ${FREE_LIMIT_MAX} req/min.` },
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for']
});

const premiumLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: PREMIUM_LIMIT_MAX,
  message: { error: 'Premium rate limit exceeded.' },
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for']
});

function checkPremiumKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  req.isPremium = !!(apiKey && apiKey === process.env.PREMIUM_API_KEY);
  next();
}

app.use('/api/', checkPremiumKey);
app.use('/api/', (req, res, next) => {
  if (req.isPremium) return premiumLimiter(req, res, next);
  return freeLimiter(req, res, next);
});

const getCount = (req, defaultCount = 5) => {
  let count = parseInt(req.params.count) || parseInt(req.query.count) || defaultCount;
  return Math.min(Math.max(count, 1), 100);
};

// ---------- MOCK ENDPOINTS (unchanged) ----------
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
  let hasMx = false;
  try { const mx = await dns.resolveMx(domain); hasMx = mx && mx.length > 0; } catch(e) {}
  if (!hasMx) return { valid: false, reason: 'domain does not exist' };
  const isDisposable = disposableDomains.has(domain.toLowerCase());
  const isFreeProvider = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'].includes(domain.toLowerCase());
  let score = 100;
  if (isDisposable) score -= 60;
  if (isFreeProvider) score -= 10;
  if (score < 0) score = 0;
  return { valid: true, has_mx: hasMx, is_disposable: isDisposable, is_free_provider: isFreeProvider, score };
}

app.post('/api/validate', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  const result = await validateEmail(email);
  res.json({ email, ...result });
});

// ---------- BATCH VALIDATION (CSV) ----------
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

// ---------- DOMAIN REPUTATION SCORE ----------
async function checkDnsRecord(domain, type) {
  try {
    const records = await dns.resolve(domain, type);
    return records && records.length > 0;
  } catch {
    return false;
  }
}

app.post('/api/domain/score', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });

  const spf = await checkDnsRecord(domain, 'TXT').then(records =>
    records.some(record => record.includes('v=spf1'))
  );
  const dkim = await checkDnsRecord(`default._domainkey.${domain}`, 'TXT').then(records =>
    records.some(record => record.includes('v=DKIM1'))
  );
  const dmarc = await checkDnsRecord(`_dmarc.${domain}`, 'TXT').then(records =>
    records.some(record => record.includes('v=DMARC1'))
  );

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

// ---------- DISPOSABLE EMAIL CHECK ----------
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

// ---------- ENRICHMENT ----------
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
app.post('/api/enrich', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!HUNTER_API_KEY) return res.status(500).json({ error: 'Hunter API key missing' });
  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${HUNTER_API_KEY}`;
    const response = await axios.get(url);
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
    console.error(err);
    res.status(500).json({ error: 'Enrichment failed' });
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

// ---------- GENERATE PREMIUM API KEY (after purchase) ----------
app.post('/api/generate-key', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  // In production, verify payment via LemonSqueezy webhook first.
  const newKey = `pk_${Math.random().toString(36).substr(2, 16)}`;
  // Store in DB (simplified – you should save it)
  res.json({ apiKey: newKey, message: 'Premium key generated. Save it securely.' });
});

// ---------- ADMIN ----------
app.get('/api/admin/feedback', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (dbReady) {
    try {
      const result = await sql`SELECT * FROM feedback ORDER BY created_at DESC`;
      return res.json({ feedback: result.rows, source: 'postgres' });
    } catch (err) { console.error(err); }
  }
  res.json({ feedback: feedbackStore, source: 'memory' });
});

app.post('/api/admin/respond', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { feedbackId, replyMessage, userEmail, userName } = req.body;
  if (!feedbackId || !replyMessage || !userEmail) return res.status(400).json({ error: 'Missing fields' });

  if (dbReady) {
    try {
      await sql`
        INSERT INTO feedback_responses (feedback_id, reply_message, replied_by)
        VALUES (${feedbackId}, ${replyMessage}, 'admin')
      `;
    } catch (err) { console.error(err); }
  }
  const html = `<html><body><h2>Response from BaKangombe Support</h2><p>Hello ${userName || 'Valued User'},</p><p>${replyMessage}</p><p>– BaKangombe Team</p></body></html>`;
  const sent = await sendEmail(userEmail, 'Response to your feedback', html);
  res.json({ success: true, emailSent: sent });
});

// ---------- Admin dashboard ----------
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ---------- Professional Documentation Page (inline HTML) ----------
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BaKangombe API – Email Validation & Enrichment</title>
  <meta name="description" content="Real‑time email validation, disposable detection, MX lookup, domain reputation scoring, batch CSV, and company enrichment API.">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0c10; color: #eef2ff; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
    .container { max-width: 1300px; margin: 0 auto; padding: 2rem; }
    .docs-layout { display: flex; gap: 2rem; }
    .sidebar { width: 280px; flex-shrink: 0; position: sticky; top: 2rem; height: fit-content; background: #0f1117; border-radius: 1rem; padding: 1.5rem; border: 1px solid rgba(255,255,255,0.08); }
    .sidebar h2 { font-size: 1.2rem; margin-bottom: 1rem; color: #a0c4ff; }
    .sidebar nav ul { list-style: none; }
    .sidebar nav li { margin: 0.75rem 0; }
    .sidebar nav a { color: #cbd5e6; text-decoration: none; transition: color 0.2s; font-size: 0.9rem; }
    .sidebar nav a:hover { color: #4f46e5; }
    .content { flex: 1; min-width: 0; }
    h1 { font-size: 2.2rem; background: linear-gradient(135deg, #d9a7c7, #fff0d4, #a0c4ff); -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 0.5rem; }
    h2 { font-size: 1.8rem; margin: 2rem 0 1rem; color: #a0c4ff; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem; }
    h3 { font-size: 1.3rem; margin: 1.5rem 0 0.75rem; color: #eef2ff; }
    .badge { display: inline-block; background: #4f46e5; padding: 0.2rem 0.7rem; border-radius: 2rem; font-size: 0.7rem; font-weight: 600; margin-right: 0.75rem; vertical-align: middle; }
    .badge.free { background: #10b981; }
    .badge.premium { background: #f59e0b; }
    .endpoint-card { background: rgba(255,255,255,0.03); border-radius: 1rem; padding: 1.5rem; margin: 1.5rem 0; border: 1px solid rgba(255,255,255,0.08); transition: border 0.2s; }
    .endpoint-card:hover { border-color: rgba(79,70,229,0.4); }
    .method { display: inline-block; background: #4f46e5; padding: 0.2rem 0.8rem; border-radius: 2rem; font-size: 0.75rem; font-weight: 700; margin-right: 0.8rem; font-family: monospace; }
    .path { font-family: 'Fira Code', monospace; font-size: 1.1rem; word-break: break-all; }
    pre { background: #0f1117; padding: 1rem; border-radius: 0.75rem; overflow-x: auto; font-size: 0.85rem; margin: 1rem 0; border: 1px solid rgba(255,255,255,0.05); font-family: 'Fira Code', monospace; }
    .copy-btn { background: #1e293b; border: none; padding: 0.3rem 0.9rem; border-radius: 2rem; color: #a0c4ff; cursor: pointer; font-size: 0.7rem; font-weight: 500; transition: all 0.2s; margin-left: 0.5rem; }
    .copy-btn:hover { background: #4f46e5; color: white; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.08); }
    th { font-weight: 600; color: #a0c4ff; }
    .toast { position: fixed; bottom: 20px; right: 20px; background: #10b981; color: white; padding: 0.5rem 1rem; border-radius: 2rem; font-size: 0.8rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 1000; }
    @media (max-width: 768px) { .docs-layout { flex-direction: column; } .sidebar { position: static; width: 100%; } .container { padding: 1rem; } }
  </style>
</head>
<body>
<div class="container">
  <div class="docs-layout">
    <aside class="sidebar">
      <h2>BaKangombe</h2>
      <nav>
        <ul>
          <li><a href="#overview">Overview</a></li>
          <li><a href="#authentication">Authentication</a></li>
          <li><a href="#base-url">Base URL</a></li>
          <li><a href="#rate-limits">Rate Limits</a></li>
          <li><a href="#endpoints">Endpoints</a>
            <ul style="margin-left: 1rem; list-style: circle;">
              <li><a href="#validate">Validate Email</a></li>
              <li><a href="#enrich">Enrich Email</a></li>
              <li><a href="#batch">Batch Validation</a></li>
              <li><a href="#domain-score">Domain Score</a></li>
              <li><a href="#disposable">Disposable Check</a></li>
              <li><a href="#website">Website Generator</a></li>
              <li><a href="#feedback">Submit Feedback</a></li>
            </ul>
          </li>
          <li><a href="#errors">Error Codes</a></li>
          <li><a href="#examples">Code Examples</a></li>
          <li><a href="#pricing">Pricing</a></li>
        </ul>
      </nav>
    </aside>

    <main class="content">
      <h1>BaKangombe API</h1>
      <p>Real‑time email validation, disposable detection, MX lookup, domain reputation scoring, batch CSV processing, and company enrichment. Trusted by developers to clean email lists and prevent fake signups.</p>

      <section id="overview">
        <h2>Overview</h2>
        <p><strong>BaKangombe</strong> provides a suite of email intelligence endpoints. Free tier covers syntax + MX + disposable detection (100 req/min). Premium unlocks batch validation, enrichment (via Hunter.io), domain security scoring, and website generation.</p>
      </section>

      <section id="base-url">
        <h2>Base URL</h2>
        <pre><code>https://ba-kangombe.vercel.app</code></pre>
      </section>

      <section id="authentication">
        <h2>Authentication</h2>
        <p><span class="badge free">Free</span> No API key required for <code>/api/validate</code> and <code>/api/feedback</code>.</p>
        <p><span class="badge premium">Premium</span> All other endpoints require an API key. Include it in the <code>X-API-Key</code> header.</p>
        <pre><code>curl -H "X-API-Key: YOUR_PREMIUM_KEY" https://ba-kangombe.vercel.app/api/enrich -d '{"email":"user@example.com"}'</code></pre>
        <p>Obtain a premium key by subscribing at <a href="/#pricing" style="color:#a0c4ff;">/pricing</a> and then call <code>POST /api/generate-key</code>.</p>
      </section>

      <section id="rate-limits">
        <h2>Rate Limits</h2>
        <table>
          <thead><tr><th>Plan</th><th>Requests per minute</th><th>Monthly cap</th></tr></thead>
          <tbody>
            <tr><td>Free</td><td>100</td><td>Unlimited (per minute)</td></tr>
            <tr><td>Premium</td><td>10,000</td><td>300,000 (10k/day)</td></tr>
          </tbody>
        </table>
      </section>

      <section id="endpoints">
        <h2>Endpoints</h2>

        <div id="validate" class="endpoint-card">
          <h3><span class="method">POST</span> <span class="path">/api/validate</span> <span class="badge free" style="font-size:0.7rem;">Free</span></h3>
          <p>Validates a single email address. Checks syntax, MX records, disposable status, and free provider. Returns a quality score (0–100).</p>
          <p><strong>Request body:</strong></p>
          <pre><code>{ "email": "user@example.com" }</code></pre>
          <p><strong>Response schema:</strong></p>
          <pre><code>{
  "email": "user@example.com",
  "valid": true,
  "has_mx": true,
  "is_disposable": false,
  "is_free_provider": false,
  "score": 100
}</code></pre>
          <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate -H \"Content-Type: application/json\" -d \'{\"email\":\"user@example.com\"}\'')">Copy cURL</button>
        </div>

        <div id="enrich" class="endpoint-card">
          <h3><span class="method">POST</span> <span class="path">/api/enrich</span> <span class="badge premium">Premium</span></h3>
          <p>Enriches an email with person and company data via Hunter.io. Requires premium API key.</p>
          <pre><code>{ "email": "bill.gates@microsoft.com" }</code></pre>
          <pre><code>{
  "email": "bill.gates@microsoft.com",
  "verified": true,
  "accept_all": false,
  "disposable": false,
  "webmail": false,
  "mx_records": true,
  "score": 95,
  "name": "Bill Gates",
  "company": "Microsoft"
}</code></pre>
          <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/enrich -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"email\":\"bill.gates@microsoft.com\"}\'')">Copy cURL</button>
        </div>

        <div id="batch" class="endpoint-card">
          <h3><span class="method">POST</span> <span class="path">/api/validate/batch</span> <span class="badge premium">Premium</span></h3>
          <p>Upload a CSV file (first column contains emails) and get validation results for all emails. Returns count and array of results.</p>
          <p><strong>Request:</strong> <code>multipart/form-data</code> with field <code>file</code> (CSV).</p>
          <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H "X-API-Key: YOUR_KEY" -F "file=@emails.csv"</code></pre>
          <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H \"X-API-Key: YOUR_KEY\" -F \"file=@emails.csv\"')">Copy cURL</button>
        </div>

        <div id="domain-score" class="endpoint-card">
          <h3><span class="method">POST</span> <span class="path">/api/domain/score</span> <span class="badge premium">Premium</span></h3>
          <p>Checks SPF, DKIM, and DMARC records for a domain. Returns a security score (0–100) and recommendation.</p>
          <pre><code>{ "domain": "github.com" }</code></pre>
          <pre><code>{
  "domain": "github.com",
  "spf": true,
  "dkim": true,
  "dmarc": true,
  "score": 100,
  "recommendation": "Excellent"
}</code></pre>
          <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/domain/score -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"domain\":\"github.com\"}\'')">Copy cURL</button>
        </div>

        <div id="disposable" class="endpoint-card">
          <h3><span class="method">POST</span> <span class="path">/api/disposable</span> <span class="badge premium">Premium</span></h3>
          <p>Checks if an email address belongs to a known disposable/temporary domain (e.g., Mailinator, 10minutemail).</p>
          <pre><code>{ "email": "temp@mailinator.com" }</code></pre>
          <pre><code>{ "email": "temp@mailinator.com", "isDisposable": true }</code></pre>
          <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/disposable -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"email\":\"temp@mailinator.com\"}\'')">Copy cURL</button>
        </div>

        <div id="website" class="endpoint-card">
          <h3><span class="method">POST</span> <span class="path">/api/website/generate</span> <span class="badge premium">Premium</span></h3>
          <p>Generates a simple landing page or blog HTML from a template. Useful for quick prototypes or previews.</p>
          <pre><code>{ "template": "landing", "title": "My Startup", "content": "We build awesome tools." }</code></pre>
          <pre><code>{ "html": "<!DOCTYPE html...>", "template": "landing", "title": "My Startup" }</code></pre>
          <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/website/generate -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"template\":\"landing\",\"title\":\"My Site\",\"content\":\"Hello\"}\'')">Copy cURL</button>
        </div>

        <div id="feedback" class="endpoint-card">
          <h3><span class="method">POST</span> <span class="path">/api/feedback</span> <span class="badge free">Free</span></h3>
          <p>Submits user feedback. A confirmation email is sent to the provided address. Data is stored in Vercel Postgres.</p>
          <pre><code>{ "name": "Alice", "email": "alice@example.com", "message": "Great API!" }</code></pre>
          <pre><code>{ "success": true, "message": "Thank you! A confirmation email has been sent." }</code></pre>
          <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/feedback -H \"Content-Type: application/json\" -d \'{\"name\":\"User\",\"email\":\"user@example.com\",\"message\":\"Great API!\"}\'')">Copy cURL</button>
        </div>
      </section>

      <section id="errors">
        <h2>Error Codes</h2>
        <table>
          <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>400</td><td>Bad request – missing email/domain or invalid JSON</td></tr>
            <tr><td>402</td><td>Payment required – premium endpoint called without valid API key</td></tr>
            <tr><td>429</td><td>Rate limit exceeded – slow down or upgrade</td></tr>
            <tr><td>500</td><td>Internal server error – our issue, please retry</td></tr>
          </tbody>
        </table>
      </section>

      <section id="examples">
        <h2>Code Examples</h2>
        <h3>JavaScript (Node.js)</h3>
        <pre><code>const response = await fetch('https://ba-kangombe.vercel.app/api/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@example.com' })
});
const data = await response.json();
console.log(data);</code></pre>
        <button class="copy-btn" onclick="copyToClipboard('const response = await fetch(\'https://ba-kangombe.vercel.app/api/validate\', {\n  method: \'POST\',\n  headers: { \'Content-Type\': \'application/json\' },\n  body: JSON.stringify({ email: \'test@example.com\' })\n});\nconst data = await response.json();\nconsole.log(data);')">Copy JS</button>

        <h3>Python</h3>
        <pre><code>import requests
res = requests.post('https://ba-kangombe.vercel.app/api/validate',
                    json={'email': 'test@example.com'})
print(res.json())</code></pre>
        <button class="copy-btn" onclick="copyToClipboard('import requests\nres = requests.post(\'https://ba-kangombe.vercel.app/api/validate\',\n                    json={\'email\': \'test@example.com\'})\nprint(res.json())')">Copy Python</button>
      </section>

      <section id="pricing">
        <h2>Pricing</h2>
        <table>
          <thead><tr><th>Plan</th><th>Price</th><th>Features</th></tr></thead>
          <tbody>
            <tr><td>Free</td><td>$0</td><td>100 req/min, validation only</td></tr>
            <tr><td>Pro</td><td>$9/month</td><td>10,000 req/min, batch, enrichment, domain score, disposable, website generator</td></tr>
          </tbody>
        </table>
        <p>Subscribe at <a href="/#pricing" style="color:#a0c4ff;">https://ba-kangombe.vercel.app/#pricing</a></p>
      </section>

      <p style="margin-top: 3rem; font-size: 0.85rem; text-align: center; color: #6c7a91;">Built by Bornface Kangombe. Need help? <a href="mailto:bornface.kangombe@cs.unza.zm" style="color:#a0c4ff;">Contact support</a></p>
    </main>
  </div>
</div>
<div id="toast" class="toast">✓ Copied to clipboard</div>
<script>
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    const toast = document.getElementById('toast');
    toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', 2000);
  }
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
</script>
</body>
</html>`);
});

// ---------- Static pages ----------
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Successful</title><style>body{background:#0a0c10;color:#eef2ff;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;text-align:center}.card{background:rgba(255,255,255,0.03);border-radius:1.5rem;padding:2rem;border:1px solid rgba(255,255,255,0.08);max-width:500px}h1{color:#10b981}a{color:#a0c4ff}</style></head><body><div class="card"><h1>✓ Payment Successful!</h1><p>Thank you for subscribing.<br>Your premium API key will be sent to your email.</p><p><a href="/">← Back</a></p></div></body></html>`);
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---------- CATCH-ALL ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;