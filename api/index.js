require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { faker } = require('@faker-js/faker');
const axios = require('axios');
const { Resend } = require('resend');
const dns = require('dns').promises;
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { Pool } = require('pg');
const crypto = require('crypto');
const OpenAI = require('openai');
const whois = require('whois-json');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const useragent = require('express-useragent');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(useragent.express());

// ---------- Database connection ----------
let pool;
if (process.env.POSTGRES_URL) {
  pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });
  pool.query(`
    CREATE TABLE IF NOT EXISTS usage (
      id SERIAL PRIMARY KEY,
      api_key VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      validations INTEGER DEFAULT 0,
      enrichments INTEGER DEFAULT 0,
      UNIQUE(api_key, date)
    );
  `).catch(console.error);
  pool.query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id SERIAL PRIMARY KEY,
      api_key VARCHAR(255) NOT NULL,
      event_name VARCHAR(255),
      event_data JSONB,
      ip VARCHAR(45),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `).catch(console.error);
  pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255),
      message TEXT,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `).catch(console.error);
}

// ---------- Email providers ----------
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'BaKangombe · Bornface Kangombe Kernel');
  console.log(`${req.method} ${req.path}`);
  next();
});

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

// ---------- MOCK ENDPOINTS (free) ----------
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

// ---------- UTILITY ENDPOINTS (FREE) ----------
app.get('/api/uuid', (req, res) => res.json({ uuid: uuidv4() }));

app.get('/api/random/number', (req, res) => {
  let { min = 0, max = 100 } = req.query;
  min = parseInt(min);
  max = parseInt(max);
  const random = Math.floor(Math.random() * (max - min + 1)) + min;
  res.json({ random, min, max });
});

app.get('/api/random/string', (req, res) => {
  let { length = 10 } = req.query;
  length = parseInt(length);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  res.json({ random_string: result, length });
});

app.get('/api/random/color', (req, res) => {
  const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  res.json({ color });
});

app.post('/api/qrcode', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const qrDataURL = await QRCode.toDataURL(text);
    res.json({ qr_code: qrDataURL });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

app.post('/api/validate/phone', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,6}[-\s\.]?[0-9]{1,6}$/im;
  const valid = phoneRegex.test(phone);
  res.json({ phone, valid });
});

app.post('/api/validate/credit-card', (req, res) => {
  const { cardNumber } = req.body;
  if (!cardNumber) return res.status(400).json({ error: 'cardNumber required' });
  const sanitized = cardNumber.replace(/\s/g, '');
  let sum = 0, alternate = false;
  for (let i = sanitized.length - 1; i >= 0; i--) {
    let n = parseInt(sanitized.charAt(i), 10);
    if (alternate) { n *= 2; if (n > 9) n = (n % 10) + 1; }
    sum += n;
    alternate = !alternate;
  }
  const valid = sum % 10 === 0;
  res.json({ cardNumber, valid });
});

app.post('/api/validate/url', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const pattern = new RegExp('^(https?:\\/\\/)?'+'((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+'((\\d{1,3}\\.){3}\\d{1,3}))'+'(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+'(\\?[;&a-z\\d%_.~+=-]*)?'+'(\\#[-a-z\\d_]*)?$','i');
  res.json({ url, valid: pattern.test(url) });
});

app.post('/api/base64/encode', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  res.json({ encoded: Buffer.from(text).toString('base64') });
});
app.post('/api/base64/decode', (req, res) => {
  const { encoded } = req.body;
  if (!encoded) return res.status(400).json({ error: 'encoded required' });
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    res.json({ decoded });
  } catch (err) {
    res.status(400).json({ error: 'Invalid base64 string' });
  }
});

app.post('/api/slugify', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const slug = text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '-');
  res.json({ slug });
});

app.get('/api/timestamp', (req, res) => {
  const now = new Date();
  res.json({
    unix: Math.floor(now.getTime() / 1000),
    utc: now.toUTCString(),
    iso: now.toISOString(),
    local: now.toString()
  });
});

app.get('/api/ip', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  res.json({ ip });
});

app.get('/api/user-agent', (req, res) => {
  res.json({
    browser: req.useragent.browser,
    version: req.useragent.version,
    os: req.useragent.os,
    platform: req.useragent.platform,
    isMobile: req.useragent.isMobile,
    isDesktop: req.useragent.isDesktop,
    source: req.useragent.source
  });
});

const quotes = [
  "The only limit is your mind.", "Code is poetry.", "Simplicity is the soul of efficiency.",
  "First, solve the problem. Then, write the code.", "Experience is the name everyone gives to their mistakes.",
  "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
  "Make it work, make it right, make it fast."
];
app.get('/api/quote', (req, res) => {
  const randomIndex = Math.floor(Math.random() * quotes.length);
  res.json({ quote: quotes[randomIndex], source: 'BaKangombe' });
});

const facts = [
  "Octopuses have three hearts.", "Bananas are berries, but strawberries aren't.",
  "The Eiffel Tower can be 15 cm taller during summer.", "Honey never spoils.",
  "A day on Venus is longer than a year on Venus.", "Cows have best friends.",
  "The shortest war in history lasted 38 minutes."
];
app.get('/api/fact', (req, res) => {
  const randomIndex = Math.floor(Math.random() * facts.length);
  res.json({ fact: facts[randomIndex] });
});

app.post('/api/hash/md5', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const hash = crypto.createHash('md5').update(text).digest('hex');
  res.json({ hash, algorithm: 'md5' });
});

app.post('/api/hash/sha256', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  res.json({ hash, algorithm: 'sha256' });
});

app.post('/api/text/stats', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const characters = text.length;
  const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  const lines = text.split(/\r?\n/).length;
  res.json({ characters, words, lines });
});

app.post('/api/palindrome', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const isPalindrome = cleaned === cleaned.split('').reverse().join('');
  res.json({ text, isPalindrome });
});

// ---------- EMAIL VALIDATION (free) ----------
const disposableDomains = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwawaymail.com', 'yopmail.com', 'mailnator.com', 'spamgourmet.com',
  'trashmail.com', 'fakeinbox.com', 'getnada.com', 'maildrop.cc'
]);

async function validateEmail(email) {
  const [localPart, domain] = email.split('@');
  if (!domain) return { valid: false, reason: 'missing domain' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return { valid: false, reason: 'invalid syntax' };
  let hasMx = false, hasA = false;
  try { const mxRecords = await dns.resolveMx(domain); hasMx = mxRecords && mxRecords.length > 0; } catch (err) {}
  if (!hasMx) {
    try { const aRecords = await dns.resolve4(domain); hasA = aRecords && aRecords.length > 0; } catch (err) {}
  }
  if (!hasMx && !hasA) return { valid: false, reason: 'domain does not exist' };
  const isDisposable = disposableDomains.has(domain.toLowerCase());
  const freeProviders = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'protonmail.com'];
  const isFreeProvider = freeProviders.includes(domain.toLowerCase());
  let score = 100;
  if (isDisposable) score -= 60;
  if (isFreeProvider) score -= 10;
  if (!hasMx && hasA) score -= 20;
  if (score < 0) score = 0;
  return { valid: true, has_mx: hasMx, has_a: hasA, is_disposable: isDisposable, is_free_provider: isFreeProvider, score };
}

app.post('/api/validate', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email address required' });
  const result = await validateEmail(email);
  if (req.isPremium) result.enriched = false;
  res.json({ email, ...result });
});

// ---------- WAITLIST ----------
async function sendWelcomeEmail(email) {
  const htmlContent = `<html><body><h2>Thank you for joining the BaKangombe waitlist!</h2><p>You'll be the first to know when we launch premium features.</p><p>– Bornface Kangombe Kernel</p></body></html>`;
  if (BREVO_API_KEY) {
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'BaKangombe', email: 'bornfacek135@gmail.com' },
        to: [{ email, name: email.split('@')[0] }],
        subject: 'Welcome to the BaKangombe Waitlist!',
        htmlContent: htmlContent
      }, {
        headers: { 'Accept': 'application/json', 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
      });
      console.log(`✅ Email sent via Brevo to ${email}`);
      return true;
    } catch (err) {
      console.warn(`Brevo failed for ${email}:`, err.response?.data || err.message);
    }
  }
  return false;
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
  const LS_API_KEY = process.env.LEMONSQUEEZY_API_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5NGQ1OWNlZi1kYmI4LTRlYTUtYjE3OC1kMjU0MGZjZDY5MTkiLCJqdGkiOiJhNDJiNmY3MGE4ZmZlODc1MmM3YzhmNjVkZTAwNmMwMTU4MDY3NjE5ZmM0ZmEyMWEzZWUyYzBkYmMyMGU5NzUxMmQ3YTMzMzY0MTg4NjVkNyIsImlhdCI6MTc4MDI0MzI4Mi44NTAyOTksIm5iZiI6MTc4MDI0MzI4Mi44NTAzMDIsImV4cCI6MTc5NTk5NjgwMC4wMzEyMiwic3ViIjoiNzIwMzMyMSIsInNjb3BlcyI6W119.bk-ut2bSJZrxtHqB0dzB6cTfloT7HobpC8nESzc1L4kwzHWp-follS-o6DmCnfR9-HKmMg5GpbDvpIIwKRTM3X3JTVdKSnwCbJwlUaoB6kTyAz8ZsHFkEH8j7gCB1xAxXOKoEXnpW435TQlkiEsJgBd5F3XNCbc5qyNVsE7mAMa2wCZ8hmAv1NjCpnUHoLKGQsoniOZ55QECXcer6gbPnrUH7rktydx4LboXQGFoZxhMJuhedq1fAoBpvnu5K6g4GrNRECDlXNlANw2cbrt5nHWzlub9kXyXGsBJ9WEbMXJPtEwM_Afdw1WzYBbd7-3Tt3qGh9jzrpSL6icEBOav9JsxyoBSTgRlHvXg6-y2BFtsSOQRl0_OlSA-JcfxEwS5sZIdz1miMoBt6H-jEBpAfdbcvIEqk65BrQI6xtourKAok92zJDYfw5oe5e8erqTiGyJgMQ4ndLGddn1XgqsMFDEgDHMs5uIQBitk5Lmk1Umte9Odu7PE8v9i7pgGa0eWekqd7AudJoT3IBhPGxInyH_Nj9HXsGmBgM2AP0ONkRSz9Gd_8yLETQECIB7opL9dhMrsm_XuCPcYPs11K5Jot5cazcaAOzrHMNmmQyo9xUrNPWwBoRfSOeO3xIWd7ZSi-OaWLfinLTFKZoTuDyQK0hQ1Fas2Oq8LctMwT1m-Tj4';
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
        relationships: {
          store: { data: { type: 'stores', id: LS_STORE_ID } },
          variant: { data: { type: 'variants', id: LS_VARIANT_ID } }
        }
      }
    }, {
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${LS_API_KEY}`
      }
    });
    res.json({ url: response.data.data.attributes.url });
  } catch (err) {
    console.error('Lemon Squeezy error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// ---------- PREMIUM ENDPOINTS (require X-API-Key) ----------

// Helper: parse CSV buffer
async function parseCSVBuffer(buffer) {
  const results = [];
  const readable = Readable.from(buffer.toString());
  return new Promise((resolve, reject) => {
    readable
      .pipe(csv({ headers: false }))
      .on('data', (row) => {
        const email = Object.values(row)[0]?.trim();
        if (email && email.includes('@')) results.push(email);
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// 1. Email enrichment (Hunter)
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const enrichmentCache = new Map();

async function enrichEmailWithHunter(email) {
  if (!HUNTER_API_KEY) return { error: 'Hunter API key missing' };
  const cacheKey = `hunter:${email}`;
  if (enrichmentCache.has(cacheKey)) return enrichmentCache.get(cacheKey);
  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${HUNTER_API_KEY}`;
    const response = await axios.get(url);
    const data = response.data.data;
    const result = {
      email,
      verified: data.status === 'valid',
      accept_all: data.accept_all || false,
      disposable: data.disposable || false,
      webmail: data.webmail || false,
      mx_records: data.mx_records || false,
      score: data.score || 0,
      name: data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : null,
      company: data.company || null
    };
    enrichmentCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error('Hunter error:', err.response?.data || err.message);
    return { error: 'Hunter enrichment failed' };
  }
}

app.post('/api/enrich', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email address required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Enrichment requires a valid premium API key' });
  const result = await enrichEmailWithHunter(email);
  res.json(result);
});

// 2. Batch validation (CSV)
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/validate/batch', upload.single('file'), async (req, res) => {
  if (!req.isPremium) return res.status(402).json({ error: 'Batch validation requires a valid premium API key' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const emails = await parseCSVBuffer(req.file.buffer);
    if (emails.length === 0) return res.status(400).json({ error: 'No valid emails found in CSV' });
    const results = [];
    for (const email of emails) {
      const result = await validateEmail(email);
      results.push({ email, ...result });
    }
    res.json({ count: results.length, results });
  } catch (err) {
    console.error('Batch error:', err);
    res.status(500).json({ error: 'Failed to process CSV' });
  }
});

// 3. Domain reputation score
async function getTxtRecord(domain, prefix) {
  try {
    const records = await dns.resolveTxt(domain);
    const found = records.flat().find(record => record.startsWith(prefix));
    return found || null;
  } catch { return null; }
}

app.post('/api/domain/score', async (req, res) => {
  let { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  domain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const spf = await getTxtRecord(domain, 'v=spf1');
  const dkim = await getTxtRecord(domain, 'v=DKIM1');
  const dmarc = await getTxtRecord(domain, 'v=DMARC1');
  let score = 100;
  if (!spf) score -= 40;
  if (!dkim) score -= 30;
  if (!dmarc) score -= 30;
  if (score < 0) score = 0;
  res.json({
    domain,
    spf: !!spf,
    dkim: !!dkim,
    dmarc: !!dmarc,
    score,
    recommendation: score >= 80 ? 'Good' : score >= 50 ? 'Needs improvement' : 'Poor security'
  });
});

// 4. Disposable email check
app.post('/api/disposable', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  const domain = email.split('@')[1].toLowerCase();
  const isDisposable = disposableDomains.has(domain);
  res.json({ email, isDisposable });
});

// 5. Company enrichment by domain (Hunter)
app.post('/api/company/enrich', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!HUNTER_API_KEY) return res.status(500).json({ error: 'Hunter API key missing' });
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${HUNTER_API_KEY}`;
    const response = await axios.get(url);
    const data = response.data.data;
    const result = {
      domain,
      organization: data.organization || null,
      industry: data.industry || null,
      emails_count: data.emails_count || 0,
      pattern: data.pattern || null,
      emails_sample: data.emails ? data.emails.slice(0,5).map(e => e.value) : []
    };
    res.json(result);
  } catch (err) {
    console.error('Hunter domain error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Company enrichment failed' });
  }
});

// 6. Email finder (Hunter)
app.post('/api/email-finder', async (req, res) => {
  const { domain, first_name, last_name } = req.body;
  if (!domain || !first_name) return res.status(400).json({ error: 'domain and first_name required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!HUNTER_API_KEY) return res.status(500).json({ error: 'Hunter API key missing' });
  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(first_name)}&last_name=${encodeURIComponent(last_name || '')}&api_key=${HUNTER_API_KEY}`;
    const response = await axios.get(url);
    const data = response.data.data;
    res.json({
      email: data.email,
      confidence: data.confidence,
      score: data.score,
      pattern: data.pattern
    });
  } catch (err) {
    console.error('Hunter finder error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Email finder failed' });
  }
});

// 7. Email list cleaner (enhanced batch)
app.post('/api/clean', upload.single('file'), async (req, res) => {
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const emails = await parseCSVBuffer(req.file.buffer);
    if (emails.length === 0) return res.status(400).json({ error: 'No valid emails found' });
    const results = [];
    for (const email of emails) {
      const validation = await validateEmail(email);
      let enrichment = null;
      if (req.body.enrich === 'true' && HUNTER_API_KEY) {
        try {
          const enrichRes = await enrichEmailWithHunter(email);
          enrichment = { name: enrichRes.name, company: enrichRes.company };
        } catch (e) {}
      }
      results.push({
        email,
        valid: validation.valid,
        reason: validation.reason || null,
        is_disposable: validation.is_disposable,
        mx_record: validation.has_mx,
        score: validation.score,
        ...(enrichment || {})
      });
    }
    res.json({ count: results.length, results });
  } catch (err) {
    console.error('Cleaner error:', err);
    res.status(500).json({ error: 'Failed to clean list' });
  }
});

// 8. Social enrichment (Clearbit)
const CLEARBIT_API_KEY = process.env.CLEARBIT_API_KEY;

app.post('/api/social', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!CLEARBIT_API_KEY) return res.status(500).json({ error: 'Clearbit API key missing' });
  try {
    const url = `https://person.clearbit.com/v2/people/find?email=${encodeURIComponent(email)}`;
    const response = await axios.get(url, { headers: { Authorization: `Bearer ${CLEARBIT_API_KEY}` } });
    const data = response.data;
    res.json({
      email,
      name: data.name?.fullName,
      twitter: data.twitter?.handle ? `https://twitter.com/${data.twitter.handle}` : null,
      linkedin: data.linkedin?.handle ? `https://linkedin.com/in/${data.linkedin.handle}` : null,
      github: data.github?.handle ? `https://github.com/${data.github.handle}` : null,
      bio: data.bio
    });
  } catch (err) {
    if (err.response?.status === 404) res.json({ email, error: 'No social profiles found' });
    else { console.error('Clearbit error:', err.message); res.status(500).json({ error: 'Social enrichment failed' }); }
  }
});

// 9. API key generation
app.post('/api/generate-key', checkPremiumKey, async (req, res) => {
  if (!req.isPremium) return res.status(402).json({ error: 'Premium subscription required' });
  const newKey = crypto.randomUUID();
  res.json({ api_key: newKey });
});

// 10. Contact form
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Missing fields' });
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'BaKangombe', email: 'bornfacek135@gmail.com' },
      to: [{ email: 'bornfacek135@gmail.com', name: 'Support' }],
      subject: `Contact from ${name}`,
      htmlContent: `<p><strong>From:</strong> ${email}</p><p><strong>Message:</strong><br/>${message}</p>`
    }, {
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' }
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send' });
  }
});

// ---------- NEW PROFITABLE FEATURES (premium) ----------

// 11. Website builder
app.post('/api/website/generate', async (req, res) => {
  const { template = 'landing', title = 'My Site', content = 'Welcome!' } = req.body;
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  let html;
  if (template === 'landing') {
    html = `<!DOCTYPE html><html><head><title>${title}</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#0a0c10;color:#eef2ff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center}.card{background:rgba(255,255,255,0.05);border-radius:1rem;padding:2rem;max-width:500px}button{background:#4f46e5;border:none;padding:0.5rem 1rem;border-radius:2rem;color:white;cursor:pointer}</style></head><body><div class="card"><h1>${title}</h1><p>${content}</p><button onclick="alert('Hello!')">Click me</button></div></body></html>`;
  } else if (template === 'blog') {
    html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{background:#0a0c10;color:#eef2ff;font-family:system-ui;padding:2rem}article{max-width:800px;margin:auto}</style></head><body><article><h1>${title}</h1><p>${content}</p></article></body></html>`;
  } else {
    return res.status(400).json({ error: 'Invalid template. Use "landing" or "blog".' });
  }
  res.json({ html, template, title });
});

// 12. Coding coach (code review)
app.post('/api/coach/review', async (req, res) => {
  const { code, language = 'javascript' } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  let suggestions = [];
  if (language === 'javascript') {
    if (code.includes('var ')) suggestions.push('Avoid using "var". Use "let" or "const".');
    if (code.includes('== ') || code.includes(' ==')) suggestions.push('Use strict equality "===".');
    if (code.split('\n').length > 50) suggestions.push('Function/script is long. Consider splitting.');
    if (!code.includes(';')) suggestions.push('Missing semicolons.');
  } else if (language === 'python') {
    if (code.includes('print')) suggestions.push('Avoid print statements for production. Use logging.');
    if (code.length > 1000) suggestions.push('Code is long. Consider modularisation.');
  } else {
    suggestions.push('General advice: use meaningful variable names, keep functions small, add comments.');
  }
  let aiAdvice = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: `Review this ${language} code and give 2 concise improvement tips:\n\n${code.slice(0, 1500)}` }],
        max_tokens: 150,
      });
      aiAdvice = completion.choices[0].message.content;
    } catch (e) { console.error('AI coach error:', e.message); }
  }
  res.json({ suggestions, aiAdvice: aiAdvice || null });
});

// 13. Code testing (JavaScript lint & test simulation)
app.post('/api/code/test', async (req, res) => {
  const { code, testInput = '5,10' } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  let result = { passed: false, output: null, error: null };
  try {
    const func = new Function('input', code + '; return main;');
    const main = func(testInput);
    if (typeof main !== 'function') throw new Error('No "main" function exported');
    const output = main(testInput);
    result.output = output;
    result.passed = true;
  } catch (err) {
    result.error = err.message;
  }
  res.json(result);
});

// 14. App builder (boilerplate generator)
app.post('/api/app/generate', async (req, res) => {
  const { type = 'react', name = 'my-app' } = req.body;
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  let boilerplate = '';
  if (type === 'react') {
    boilerplate = `import React from 'react';\nfunction App() { return <div><h1>Welcome to ${name}</h1><p>Your React app is ready!</p></div>; }\nexport default App;`;
  } else if (type === 'express') {
    boilerplate = `const express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.send('Hello from ${name}'));\napp.listen(3000, () => console.log('Server running on port 3000'));`;
  } else {
    return res.status(400).json({ error: 'Invalid app type. Use "react" or "express".' });
  }
  res.json({ type, name, boilerplate });
});

// 15. AI analytics tracking & stats
app.post('/api/analytics/track', async (req, res) => {
  const { event, data: eventData = {} } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!pool) return res.status(500).json({ error: 'Database not configured' });
  const apiKey = req.headers['x-api-key'];
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  await pool.query('INSERT INTO analytics_events (api_key, event_name, event_data, ip) VALUES ($1, $2, $3, $4)', [apiKey, event, JSON.stringify(eventData), ip]);
  res.json({ success: true });
});

app.get('/api/analytics/stats', async (req, res) => {
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!pool) return res.status(500).json({ error: 'Database not configured' });
  const apiKey = req.headers['x-api-key'];
  const result = await pool.query('SELECT event_name, COUNT(*) as count FROM analytics_events WHERE api_key = $1 GROUP BY event_name', [apiKey]);
  res.json({ stats: result.rows });
});

app.get('/api/analytics/demo', (req, res) => res.json({ demo: true, message: 'This is a demo of analytics capabilities. Subscribe to get real tracking.' }));

// 16. Feedback button (free)
app.post('/api/feedback', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'name, email, message required' });
  if (!pool) return res.status(500).json({ error: 'Database not configured' });
  const userAgent = req.headers['user-agent'];
  await pool.query('INSERT INTO feedback (name, email, message, user_agent) VALUES ($1, $2, $3, $4)', [name, email, message, userAgent]);
  if (BREVO_API_KEY) {
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'BaKangombe', email: 'bornfacek135@gmail.com' },
        to: [{ email: 'bornfacek135@gmail.com', name: 'Support' }],
        subject: `New feedback from ${name}`,
        htmlContent: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Message:</strong><br/>${message}</p>`
      }, {
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
      });
    } catch (e) { console.error('Feedback email failed:', e.message); }
  }
  res.json({ success: true });
});

// 17. Custom chatbot (OpenAI)
app.post('/api/chatbot', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key missing' });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `You are a helpful assistant. Answer concisely: ${message}` }],
      max_tokens: 200,
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chatbot failed' });
  }
});

// ---------- AI ENDPOINTS (OpenAI) ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/ai/summarize', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key missing' });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Summarize this text in 2-3 sentences:\n\n${text}` }],
      max_tokens: 150,
    });
    res.json({ summary: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI summarization failed' });
  }
});

app.post('/api/ai/sentiment', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key missing' });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Analyze sentiment of this text. Return JSON: { "sentiment": "positive|neutral|negative", "confidence": 0-100, "explanation": "..." }\n\nText: ${text}` }],
      max_tokens: 100,
    });
    let result = completion.choices[0].message.content;
    try {
      const jsonMatch = result.match(/\{.*\}/s);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
      else result = { sentiment: 'unknown', confidence: 0, explanation: result };
    } catch (e) {}
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI sentiment failed' });
  }
});

// ---------- DOMAIN / DNS TOOLS ----------
app.post('/api/whois', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  try {
    const result = await whois(domain);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'WHOIS lookup failed' });
  }
});

app.post('/api/ssl-check', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  const https = require('https');
  const options = { method: 'HEAD', host: domain, port: 443, timeout: 5000 };
  const start = Date.now();
  const reqHttps = https.request(options, (resp) => {
    const elapsed = Date.now() - start;
    const valid = resp.socket.authorized !== false;
    const cert = resp.socket.getPeerCertificate();
    res.json({
      domain,
      valid,
      duration_ms: elapsed,
      certificate: {
        subject: cert.subject,
        issuer: cert.issuer,
        valid_from: cert.valid_from,
        valid_to: cert.valid_to,
      }
    });
  });
  reqHttps.on('error', (err) => res.status(500).json({ error: 'SSL check failed', message: err.message }));
  reqHttps.end();
});

app.post('/api/dns', async (req, res) => {
  const { domain, type = 'A' } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  if (!req.isPremium) return res.status(402).json({ error: 'Premium API key required' });
  try {
    let records;
    switch (type.toUpperCase()) {
      case 'A': records = await dns.resolve4(domain); break;
      case 'MX': records = await dns.resolveMx(domain); break;
      case 'TXT': const txt = await dns.resolveTxt(domain); records = txt.flat(); break;
      case 'CNAME': records = await dns.resolveCname(domain); break;
      case 'NS': records = await dns.resolveNs(domain); break;
      default: return res.status(400).json({ error: 'Unsupported DNS type. Use A, MX, TXT, CNAME, or NS' });
    }
    res.json({ domain, type: type.toUpperCase(), records });
  } catch (err) {
    res.status(500).json({ error: 'DNS lookup failed', message: err.message });
  }
});

// ----- Static pages -----
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Payment Successful – BaKangombe</title>
<style>body{background:#0a0c10;color:#eef2ff;font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;}.card{background:rgba(255,255,255,0.03);border-radius:1.5rem;padding:2rem;border:1px solid rgba(255,255,255,0.08);max-width:500px;}h1{color:#10b981;}a{color:#a0c4ff;text-decoration:none;}a:hover{text-decoration:underline;}</style>
</head>
<body><div class="card"><h1>✓ Payment Successful!</h1><p>Thank you for subscribing to BaKangombe Premium.</p><p>Your premium API key will be sent to your email shortly.</p><p><a href="/">← Back to BaKangombe</a></p></div></body>
</html>`);
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, '../public/docs.html')));

// ---------- CATCH-ALL (must be the very last route) ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;