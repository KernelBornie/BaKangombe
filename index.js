const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { faker } = require('@faker-js/faker');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Custom header to brand every response
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'BaKangombe · Bornface Kangombe Kernel');
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Rate limiter: 100 requests per minute (free tier)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Rate limit exceeded. Free tier: 100 req/min. Join waitlist for premium.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const getCount = (req, defaultCount = 5) => {
  let count = parseInt(req.params.count) || defaultCount;
  return Math.min(Math.max(count, 1), 100);
};

// ---------- ENDPOINTS ----------
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

// Root endpoint (JSON)
app.get('/', (req, res) => {
  res.json({
    name: "BaKangombe",
    version: "1.0.0",
    description: "Mock data API by Bornface Kangombe Kernel",
    endpoints: {
      users: "/api/users/:count?",
      products: "/api/products/:count?",
      company: "/api/company",
      transactions: "/api/transactions/:count?"
    },
    rateLimit: "100 requests per minute (free tier)",
    premium: "Join waitlist on website for API keys, 10k req/min, custom schemas"
  });
});

// Start server locally
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 BaKangombe API running at http://localhost:${PORT}`);
    console.log(`📦 Try: http://localhost:${PORT}/api/users/3`);
  });
}

module.exports = app;