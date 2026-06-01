require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { faker } = require('@faker-js/faker');
const axios = require('axios');
const dns = require('dns').promises;
const { sql } = require('@vercel/postgres');

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

// ---------- Documentation page (inline HTML) ----------
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BaKangombe API Documentation</title>
  <style>
    body { background: #0a0c10; color: #eef2ff; font-family: system-ui; padding: 2rem; max-width: 1000px; margin: 0 auto; }
    h1, h2, h3 { color: #a0c4ff; }
    pre { background: #0f1117; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
    .endpoint { background: rgba(255,255,255,0.03); border-radius: 1rem; padding: 1rem; margin-bottom: 1rem; }
    .method { background: #4f46e5; display: inline-block; padding: 0.2rem 0.8rem; border-radius: 2rem; font-size: 0.75rem; margin-right: 1rem; }
    .copy-btn { background: #1e293b; border: none; padding: 0.2rem 0.8rem; border-radius: 2rem; color: #a0c4ff; cursor: pointer; }
    a { color: #a0c4ff; }
  </style>
</head>
<body>
  <h1>BaKangombe API Documentation</h1>
  <p>Base URL: <code>https://ba-kangombe.vercel.app</code></p>

  <h2>Authentication</h2>
  <p>Free tier: no API key required.<br>Premium tier: include <code>X-API-Key: YOUR_KEY</code> header.</p>

  <h2>Endpoints</h2>

  <div class="endpoint">
    <h3><span class="method">POST</span> /api/validate</h3>
    <p>Free – validate email syntax, MX, disposable status.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate -H "Content-Type: application/json" -d '{"email":"user@example.com"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate -H \"Content-Type: application/json\" -d \'{\"email\":\"user@example.com\"}\'')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> /api/enrich</h3>
    <p>Premium – enrichment via Hunter.io.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/enrich -H "Content-Type: application/json" -H "X-API-Key: YOUR_KEY" -d '{"email":"bill.gates@microsoft.com"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/enrich -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"email\":\"bill.gates@microsoft.com\"}\'')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> /api/validate/batch</h3>
    <p>Premium – batch CSV validation.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H "X-API-Key: YOUR_KEY" -F "file=@emails.csv"</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/validate/batch -H \"X-API-Key: YOUR_KEY\" -F \"file=@emails.csv\"')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> /api/domain/score</h3>
    <p>Premium – domain security score (SPF/DKIM/DMARC).</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/domain/score -H "Content-Type: application/json" -H "X-API-Key: YOUR_KEY" -d '{"domain":"github.com"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/domain/score -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"domain\":\"github.com\"}\'')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> /api/disposable</h3>
    <p>Premium – check if email is from a disposable domain.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/disposable -H "Content-Type: application/json" -H "X-API-Key: YOUR_KEY" -d '{"email":"temp@mailinator.com"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/disposable -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"email\":\"temp@mailinator.com\"}\'')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> /api/website/generate</h3>
    <p>Premium – generate landing page HTML.</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/website/generate -H "Content-Type: application/json" -H "X-API-Key: YOUR_KEY" -d '{"template":"landing","title":"My Site","content":"Hello"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/website/generate -H \"Content-Type: application/json\" -H \"X-API-Key: YOUR_KEY\" -d \'{\"template\":\"landing\",\"title\":\"My Site\",\"content\":\"Hello\"}\'')">Copy</button>
  </div>

  <div class="endpoint">
    <h3><span class="method">POST</span> /api/feedback</h3>
    <p>Free – submit feedback (sends confirmation email).</p>
    <pre><code>curl -X POST https://ba-kangombe.vercel.app/api/feedback -H "Content-Type: application/json" -d '{"name":"User","email":"user@example.com","message":"Great API!"}'</code></pre>
    <button class="copy-btn" onclick="copyToClipboard('curl -X POST https://ba-kangombe.vercel.app/api/feedback -H \"Content-Type: application/json\" -d \'{\"name\":\"User\",\"email\":\"user@example.com\",\"message\":\"Great API!\"}\'')">Copy</button>
  </div>

  <h2>Get a premium API key</h2>
  <p>Subscribe at <a href="/#pricing">/pricing</a> and then use <code>POST /api/generate-key</code>.</p>
  <p><a href="/">← Back to homepage</a></p>

  <script>
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text);
      const toast = document.createElement('div');
      toast.textContent = '✓ Copied!';
      toast.style.position = 'fixed';
      toast.style.bottom = '20px';
      toast.style.right = '20px';
      toast.style.background = '#10b981';
      toast.style.color = 'white';
      toast.style.padding = '0.5rem 1rem';
      toast.style.borderRadius = '2rem';
      toast.style.zIndex = '1000';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }
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