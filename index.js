const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { faker } = require('@faker-js/faker');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- In‑memory store for premium keys ----------
const premiumKeys = new Map(); // email -> { apiKey, createdAt }

function generateApiKey() {
    return crypto.randomUUID();
}

// ---------- Email via Brevo ----------
async function sendWelcomeEmail(email, apiKey) {
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    if (!BREVO_API_KEY) {
        console.error('❌ BREVO_API_KEY not set');
        return;
    }
    const htmlContent = `
        <h2>Welcome to BaKangombe Premium!</h2>
        <p>Your unique API key is:</p>
        <pre><code>${apiKey}</code></pre>
        <p>Use header: <code>x-api-key: ${apiKey}</code></p>
        <p>Rate limit: <strong>10,000 requests per minute</strong>.</p>
        <p>Test it:</p>
        <pre><code>curl -H "x-api-key: ${apiKey}" https://ba-kangombe.vercel.app/api/users/3</code></pre>
        <p>Mvua,<br>Bornface Kangombe Kernel</p>
    `;
    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'api-key': BREVO_API_KEY,
            },
            body: JSON.stringify({
                sender: { email: 'bornfacek135@gmail.com', name: 'BaKangombe' },
                to: [{ email: email }],
                subject: '🎉 Your BaKangombe Premium API Key',
                htmlContent: htmlContent,
            }),
        });
        if (response.ok) {
            console.log(`📧 Welcome email sent via Brevo to ${email}`);
        } else {
            const err = await response.json();
            console.error(`Brevo error: ${JSON.stringify(err)}`);
        }
    } catch (err) {
        console.error('Failed to send email:', err);
    }
}

// ---------- Analytics ----------
const requestCounts = {
    total: 0,
    byEndpoint: {},
    free: 0,
    premium: 0,
};

app.use((req, res, next) => {
    requestCounts.total++;
    const endpoint = req.path;
    requestCounts.byEndpoint[endpoint] = (requestCounts.byEndpoint[endpoint] || 0) + 1;
    res.on('finish', () => {
        if (req.plan === 'premium') requestCounts.premium++;
        else requestCounts.free++;
    });
    next();
});

app.use(cors());

// ---------- Custom header ----------
app.use((req, res, next) => {
    res.setHeader('X-Powered-By', 'BaKangombe · Bornface Kangombe Kernel');
    console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// ---------- Premium API key middleware ----------
const DEMO_PREMIUM_KEY = process.env.PREMIUM_API_KEY || '9b39d7aa-f78b-42ac-b5be-4f764738c726';

function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        req.plan = 'free';
        return next();
    }
    if (apiKey === DEMO_PREMIUM_KEY) {
        req.plan = 'premium';
        return next();
    }
    for (let [email, data] of premiumKeys.entries()) {
        if (data.apiKey === apiKey) {
            req.plan = 'premium';
            return next();
        }
    }
    return res.status(401).json({ error: 'Invalid API key' });
}

// ---------- Rate limiters ----------
const freeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Rate limit exceeded. Free tier: 100 req/min. Upgrade to premium for higher limits.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const premiumLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10000,
    message: { error: 'Rate limit exceeded. Premium tier: 10,000 req/min.' },
    standardHeaders: true,
    legacyHeaders: false,
});

function planBasedRateLimiter(req, res, next) {
    if (req.plan === 'premium') {
        return premiumLimiter(req, res, next);
    } else {
        return freeLimiter(req, res, next);
    }
}

app.use('/api/', authenticateApiKey);
app.use('/api/', planBasedRateLimiter);

const getCount = (req, defaultCount = 5) => {
    let count = parseInt(req.params.count) || defaultCount;
    return Math.min(Math.max(count, 1), 100);
};

// ---------- API Endpoints ----------
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
    res.json({ count, data: users });
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
        imageUrl: faker.image.urlLoremFlickr({ category: 'product' }),
        rating: faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
        reviews: faker.number.int({ min: 0, max: 5000 }),
    }));
    res.json({ count, data: products });
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
    res.json(company);
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
    res.json({ count, data: transactions });
});

app.get('/api/premium/stats', (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    if (apiKey === DEMO_PREMIUM_KEY) {
        return res.json({ plan: 'premium', requests_limit: 10000, message: 'Premium key active' });
    }
    for (let [email, data] of premiumKeys.entries()) {
        if (data.apiKey === apiKey) {
            return res.json({ plan: 'premium', requests_limit: 10000, message: 'Premium key active' });
        }
    }
    res.status(401).json({ error: 'Invalid API key' });
});

app.get('/api/analytics', (req, res) => {
    const auth = req.headers['x-admin-key'];
    if (auth !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json({
        total: requestCounts.total,
        free: requestCounts.free,
        premium: requestCounts.premium,
        byEndpoint: requestCounts.byEndpoint,
        uptime: process.uptime(),
    });
});

app.get('/api/admin/keys', (req, res) => {
    const auth = req.headers['x-admin-key'];
    if (auth !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const keys = Array.from(premiumKeys.entries()).map(([email, data]) => ({
        email,
        apiKey: data.apiKey,
        createdAt: data.createdAt || new Date().toISOString(),
    }));
    res.json({ count: keys.length, keys });
});

// ---------- Lemon Squeezy Webhook (raw body) ----------
app.post('/api/ls-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const rawBody = req.body.toString();
    try {
        const payload = JSON.parse(rawBody);
        const eventName = payload.meta?.event_name;
        console.log(`Processing event: ${eventName}`);

        let customerEmail = null;
        if (payload.data?.attributes?.user_email) {
            customerEmail = payload.data.attributes.user_email;
        } else if (payload.data?.attributes?.customer_email) {
            customerEmail = payload.data.attributes.customer_email;
        }

        const grantEvents = ['order_created', 'subscription_created', 'subscription_payment_success'];
        if (grantEvents.includes(eventName) && customerEmail) {
            const apiKey = generateApiKey();
            premiumKeys.set(customerEmail, { apiKey, createdAt: new Date() });
            console.log(`✅ Premium granted to ${customerEmail} with API key ${apiKey}`);
            await sendWelcomeEmail(customerEmail, apiKey);
        } else if (grantEvents.includes(eventName) && !customerEmail) {
            console.error(`Event ${eventName} had no user email.`);
        } else {
            console.log(`Ignored event: ${eventName}`);
        }
        res.status(200).send('Webhook received');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(400).send('Bad Request');
    }
});

app.use(express.json());

// ---------- Create Lemon Squeezy Checkout ----------
app.post('/api/create-ls-checkout', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const requestBody = {
            data: {
                type: 'checkouts',
                attributes: {
                    checkout_data: { email: email, custom: {} },
                    product_options: { redirect_url: 'https://ba-kangombe.vercel.app/success.html' },
                },
                relationships: {
                    store: { data: { type: 'stores', id: process.env.LS_STORE_ID } },
                    variant: { data: { type: 'variants', id: process.env.LS_VARIANT_ID } },
                },
            },
        };

        const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
                'Authorization': `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
            },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.errors?.[0]?.detail || 'Failed to create checkout');
        res.json({ url: data.data.attributes.url });
    } catch (error) {
        console.error('Lemon Squeezy checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- Root endpoint ----------
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>BaKangombe API</title><style>body{font-family:system-ui;background:#0a0f1c;color:#eef2ff;padding:2rem;text-align:center;}</style></head>
        <body>
          <h1>⚡ BaKangombe API</h1>
          <p>Free mock data API by Bornface Kangombe Kernel</p>
          <pre>GET /api/users/3\nGET /api/products/5\nGET /api/company\nGET /api/transactions/10</pre>
          <p>✨ Free tier: 100 req/min (no key). Premium: 10,000 req/min ($9/mo).</p>
          <a href="https://ba-kangombe.vercel.app">🌐 Landing Page</a> · <a href="https://github.com/KernelBornie/BaKangombe">GitHub</a>
        </body>
        </html>
    `);
});

// Start server locally
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 BaKangombe API running at http://localhost:${PORT}`);
        console.log(`📦 Try: http://localhost:${PORT}/api/users/3`);
        console.log(`💎 Demo premium key: ${DEMO_PREMIUM_KEY}`);
    });
}

module.exports = app;
