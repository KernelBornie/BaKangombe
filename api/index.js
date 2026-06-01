require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { faker } = require('@faker-js/faker');
const axios = require('axios');
const dns = require('dns').promises;
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const useragent = require('express-useragent');
const whois = require('whois-json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(useragent.express());

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
  if (!hasMx) { try { const aRecords = await dns.resolve4(domain); hasA = aRecords && aRecords.length > 0; } catch (err) {} }
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
  res.json({ email, ...result });
});

// ---------- WAITLIST (Brevo) ----------
const BREVO_API_KEY = process.env.BREVO_API_KEY;
async function sendWelcomeEmail(email) {
  if (!BREVO_API_KEY) return false;
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'BaKangombe', email: 'bornfacek135@gmail.com' },
      to: [{ email, name: email.split('@')[0] }],
      subject: 'Welcome to the BaKangombe Waitlist!',
      htmlContent: `<html><body><h2>Thank you for joining!</h2><p>– Bornface Kangombe Kernel</p></body></html>`
    }, { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } });
    return true;
  } catch (err) { return false; }
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
        relationships: { store: { data: { type: 'stores', id: LS_STORE_ID } }, variant: { data: { type: 'variants', id: LS_VARIANT_ID } } }
      }
    }, { headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: `Bearer ${LS_API_KEY}` } });
    res.json({ url: response.data.data.attributes.url });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// ---------- FEEDBACK (in-memory) ----------
let feedbackStore = [];
app.post('/api/feedback', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'name, email, message required' });
  feedbackStore.push({ id: feedbackStore.length + 1, name, email, message, createdAt: new Date().toISOString() });
  res.json({ success: true, message: 'Thank you for your feedback!' });
});

// ---------- Static pages ----------
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Successful</title><style>body{background:#0a0c10;color:#eef2ff;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;text-align:center}.card{background:rgba(255,255,255,0.03);border-radius:1.5rem;padding:2rem;border:1px solid rgba(255,255,255,0.08);max-width:500px}h1{color:#10b981}a{color:#a0c4ff}</style></head><body><div class="card"><h1>✓ Payment Successful!</h1><p>Thank you for subscribing.<br>Your premium API key will be sent to your email.</p><p><a href="/">← Back</a></p></div></body></html>`);
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, '../public/docs.html')));

// ---------- CATCH-ALL ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;