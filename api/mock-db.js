// In-memory SQL Mock for BaKangombe when Postgres is not connected

const tables = {
  businesses: [
    {
      id: 1,
      name: 'Demo Business',
      email: 'demo@bakangombe.com',
      api_key: '80af46c3cae0f0f2c66b4495eac2271a173bf2b9d063020e25fe3407f0ccb7d6',
      modules: [
        'website', 'momo', 'mobile-money', 'mobile_money', 'invoice', 'whatsapp', 'logistics', 'agritech',
        'faq', 'ai', 'lending', 'sme', 'inventory', 'social_ads', 'ads', 'freelance',
        'clinic', 'kyc', 'ecommerce', 'tutor', 'tutoring', 'discovery', 'business', 'cv'
      ],
      wallet_balance: 25000.00,
      currency: 'ZMW',
      created_at: new Date()
    }
  ],
  subscriptions: [
    {
      id: 1,
      business_id: 1,
      plan: 'Pro',
      status: 'active',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      created_at: new Date()
    }
  ],
  feedback: [],
  feedback_responses: [],
  business_services: [],
  generated_systems: [],
  momo_transactions: [
    { id: 101, business_id: 1, amount: 250, phone: '0971234567', provider: 'MTN', status: 'completed', type: 'send', created_at: new Date(Date.now() - 3600000) },
    { id: 102, business_id: 1, amount: 500, phone: '0969876543', provider: 'Airtel', status: 'completed', type: 'request', created_at: new Date(Date.now() - 7200000) }
  ],
  invoices: [
    { id: 101, business_id: 1, customer: 'Lusaka Merchants Ltd', amount: 1500, items: 'Web Services & Consulting', status: 'unpaid', created_at: new Date() }
  ],
  whatsapp_products: [
    { id: 101, business_id: 1, name: 'Handcrafted Zambian Basket', price: 180, description: 'Authentic local artisanal craft' },
    { id: 102, business_id: 1, name: 'Natural Zambian Honey (500g)', price: 95, description: 'Pure raw forest honey from Northwestern Province' }
  ],
  whatsapp_orders: [
    { id: 101, business_id: 1, product_id: 101, customer_phone: '0977112233', status: 'pending', created_at: new Date() }
  ],
  logistics_routes: [
    { id: 101, business_id: 1, stops: 'Lusaka -> Kabwe -> Ndola', status: 'active', driver_id: 12 }
  ],
  agritech_farmers: [
    { id: 101, business_id: 1, name: 'Bornface Kangombe', crop: 'Maize', price: 120, location: 'Mkushi' },
    { id: 102, business_id: 1, name: 'Chanda Mumba', crop: 'Soybeans', price: 240, location: 'Mpongwe' }
  ],
  faqs: [
    { id: 1, business_id: 1, question: 'What is BaKangombe?', answer: 'BaKangombe is an enterprise Email Validation & Business Infrastructure platform.' },
    { id: 2, business_id: 1, question: 'How do I pay invoices?', answer: 'You can pay invoices via Mobile Money (MTN, Airtel, Zamtel) or direct bank transfer.' },
    { id: 3, business_id: 1, question: 'How fast is mobile money delivery?', answer: 'Transactions process in real-time, typically settling within 2 to 5 seconds.' }
  ],
  lending_scores: [
    { id: 101, business_id: 1, income: 8500, debt: 1200, history: 'good', score: 720 }
  ],
  sme_sales: [
    { id: 101, business_id: 1, amount: 3500, customer_id: 1, date: new Date() },
    { id: 102, business_id: 1, amount: 4800, customer_id: 2, date: new Date() }
  ],
  sme_expenses: [
    { id: 101, business_id: 1, amount: 2100, category: 'Inventory & Transport', date: new Date() }
  ],
  inventory_products: [
    { id: 101, business_id: 1, name: 'Solar Inverter 3kVA', price: 4500, stock: 15 },
    { id: 102, business_id: 1, name: 'Li-Ion Battery 100Ah', price: 6200, stock: 8 }
  ],
  social_ads: [
    { id: 101, business_id: 1, name: 'Harvest Promo Q4', budget: 1500, target: 'Farmers in Central Province', status: 'active', leads: 42 }
  ],
  freelance_services: [
    { id: 101, business_id: 1, title: 'Fullstack React & Node Developer', price: 850, seller: 'Bornface Kangombe' },
    { id: 102, business_id: 1, title: 'UI/UX Mobile App Designer', price: 600, seller: 'Bornface Kangombe' }
  ],
  freelance_orders: [
    { id: 101, business_id: 1, service_id: 101, buyer: 'Acme Corp', status: 'escrow', created_at: new Date() }
  ],
  clinic_patients: [
    { id: 101, business_id: 1, name: 'Bornface Kangombe', phone: '+260971234567', address: 'Plot 42, Great East Rd, Lusaka' }
  ],
  clinic_appointments: [
    { id: 101, business_id: 1, patient_id: 101, date: '2026-11-15', reason: 'Annual Health Checkup' }
  ],
  ecommerce_products: [
    { id: 101, business_id: 1, name: 'BaKangombe IoT Tracker', price: 950 },
    { id: 102, business_id: 1, name: 'Smart Energy Monitor', price: 1250 }
  ],
  ecommerce_orders: [
    { id: 101, business_id: 1, product_id: 101, quantity: 2, customer: 'Bornface Kangombe', status: 'paid' }
  ],
  tutor_curriculum: [
    { id: 1, business_id: 1, grade: 10, subject: 'Math', topic: 'Algebra', content: 'Quadratic equations and factoring basics.' },
    { id: 2, business_id: 1, grade: 12, subject: 'Science', topic: 'Physics', content: 'Electromagnetism and Ohm\'s Law.' }
  ],
  businesses_list: [
    { id: 101, business_id: 1, name: 'Kangombe Agro Supplies', category: 'Agriculture', location: 'Lusaka CBD', whatsapp: '+260971234567' },
    { id: 102, business_id: 1, name: 'Copperbelt Solar Solutions', category: 'Energy', location: 'Kitwe Industrial', whatsapp: '+260966554433' }
  ],
  discovery_reviews: [
    { id: 101, business_list_id: 101, reviewer_business_id: 1, rating: 5, comment: 'Excellent service and prompt delivery.' }
  ]
};

let autoIncrement = 200;

function getTable(name) {
  const clean = name.toLowerCase().replace(/['"`]/g, '').trim();
  if (!tables[clean]) {
    tables[clean] = [];
  }
  return tables[clean];
}

async function mockSql(strings, ...values) {
  // Reconstruct query text with placeholders replaced for basic parsing
  let rawText = '';
  for (let i = 0; i < strings.length; i++) {
    rawText += strings[i];
    if (i < values.length) {
      rawText += `__VAL_${i}__`;
    }
  }
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  // 1. SELECT 1 (Health check)
  if (/^select\s+1/i.test(trimmed)) {
    return { rows: [{ '?column?': 1 }], rowCount: 1 };
  }

  // 2. CREATE TABLE
  if (lower.startsWith('create table')) {
    const match = trimmed.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+)/i);
    if (match) {
      getTable(match[1]);
    }
    return { rows: [], rowCount: 0 };
  }

  // 3. INSERT INTO
  if (lower.startsWith('insert into')) {
    const match = trimmed.match(/insert\s+into\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(?:values\s*\(([^)]+)\)|select)/i);
    if (match) {
      const tableName = match[1];
      const table = getTable(tableName);
      const cols = match[2].split(',').map(c => c.trim().toLowerCase());
      
      const newRecord = {
        id: ++autoIncrement,
        created_at: new Date()
      };

      if (match[3]) {
        const valTokens = match[3].split(',').map(v => v.trim());
        cols.forEach((col, idx) => {
          const token = valTokens[idx];
          if (token && token.startsWith('__VAL_')) {
            const valIdx = parseInt(token.replace(/__VAL_(\d+)__/, '$1'), 10);
            newRecord[col] = values[valIdx];
          } else if (token === 'now()') {
            newRecord[col] = new Date();
          } else if (token) {
            newRecord[col] = token.replace(/^['"]|['"]$/g, '');
          }
        });
      } else {
        // Handle INSERT ... SELECT ... FROM businesses WHERE api_key = ${apiKey}
        values.forEach(v => {
          if (typeof v === 'string') newRecord.api_key = v;
          if (typeof v === 'object' && v instanceof Date) newRecord.expires_at = v;
        });
      }

      table.push(newRecord);
      return { rows: [newRecord], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }

  // 4. UPDATE
  if (lower.startsWith('update')) {
    const match = trimmed.match(/update\s+([a-zA-Z0-9_]+)\s+set\s+(.+?)(?:\s+where\s+(.+))?$/i);
    if (match) {
      const tableName = match[1];
      const table = getTable(tableName);
      const setClause = match[2];
      const whereClause = match[3] || '';

      const updated = [];
      for (const row of table) {
        if (matchesWhere(row, whereClause, values)) {
          // Parse SET assignments
          const assignments = setClause.split(',');
          for (const assign of assignments) {
            const [c, rawVal] = assign.split('=').map(s => s.trim());
            const col = c.toLowerCase();
            if (rawVal.startsWith('__VAL_')) {
              const valIdx = parseInt(rawVal.replace(/__VAL_(\d+)__/, '$1'), 10);
              row[col] = values[valIdx];
            } else if (rawVal.includes('now()')) {
              row[col] = new Date();
            } else if (rawVal.includes('+')) {
              const addMatch = rawVal.match(/__VAL_(\d+)__/);
              if (addMatch) {
                const addVal = values[parseInt(addMatch[1], 10)];
                row[col] = (Number(row[col]) || 0) + Number(addVal);
              }
            } else if (rawVal.includes('-')) {
              const subMatch = rawVal.match(/__VAL_(\d+)__/);
              if (subMatch) {
                const subVal = values[parseInt(subMatch[1], 10)];
                row[col] = (Number(row[col]) || 0) - Number(subVal);
              }
            } else {
              row[col] = rawVal.replace(/^['"]|['"]$/g, '');
            }
          }
          updated.push(row);
        }
      }
      return { rows: updated, rowCount: updated.length };
    }
  }

  // 5. DELETE FROM
  if (lower.startsWith('delete from')) {
    const match = trimmed.match(/delete\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+))?$/i);
    if (match) {
      const tableName = match[1];
      const table = getTable(tableName);
      const whereClause = match[2] || '';
      const remaining = [];
      const deleted = [];
      for (const row of table) {
        if (matchesWhere(row, whereClause, values)) {
          deleted.push(row);
        } else {
          remaining.push(row);
        }
      }
      tables[tableName.toLowerCase()] = remaining;
      return { rows: deleted, rowCount: deleted.length };
    }
  }

  // 6. SELECT
  if (lower.startsWith('select')) {
    const match = trimmed.match(/select\s+(.+?)\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?(?:\s+order\s+by.+?)?(?:\s+limit\s+\d+)?$/i);
    if (match) {
      const fields = match[1].trim();
      const tableName = match[2].trim();
      const whereClause = match[3] || '';
      const table = getTable(tableName);

      // Handle aggregations like SELECT SUM(amount) as total FROM ...
      if (/sum\s*\(\s*([a-zA-Z0-9_]+)\s*\)/i.test(fields)) {
        const sumCol = fields.match(/sum\s*\(\s*([a-zA-Z0-9_]+)\s*\)/i)[1].toLowerCase();
        let total = 0;
        for (const row of table) {
          if (matchesWhere(row, whereClause, values)) {
            total += Number(row[sumCol]) || 0;
          }
        }
        return { rows: [{ total }], rowCount: 1 };
      }

      const filtered = table.filter(row => matchesWhere(row, whereClause, values));
      return { rows: filtered, rowCount: filtered.length };
    }
  }

  return { rows: [], rowCount: 0 };
}

function matchesWhere(row, whereClause, values) {
  if (!whereClause || !whereClause.trim()) return true;
  const parts = whereClause.split(/\s+and\s+/i);
  for (const part of parts) {
    const trimmedPart = part.trim();
    // col = __VAL_x__
    const eqMatch = trimmedPart.match(/([a-zA-Z0-9_]+)\s*=\s*(?:__VAL_(\d+)__|'([^']*)'|(\d+))/i);
    if (eqMatch) {
      const col = eqMatch[1].toLowerCase();
      let targetVal;
      if (eqMatch[2] !== undefined) {
        targetVal = values[parseInt(eqMatch[2], 10)];
      } else if (eqMatch[3] !== undefined) {
        targetVal = eqMatch[3];
      } else {
        targetVal = Number(eqMatch[4]);
      }
      if (row[col] != targetVal) return false;
      continue;
    }

    // col < __VAL_x__ or col <= ...
    const numMatch = trimmedPart.match(/([a-zA-Z0-9_]+)\s*(<=|<|>=|>)\s*(?:__VAL_(\d+)__|(\d+))/i);
    if (numMatch) {
      const col = numMatch[1].toLowerCase();
      const op = numMatch[2];
      const targetVal = numMatch[3] !== undefined ? Number(values[parseInt(numMatch[3], 10)]) : Number(numMatch[4]);
      const rowVal = Number(row[col]) || 0;
      if (op === '<' && !(rowVal < targetVal)) return false;
      if (op === '<=' && !(rowVal <= targetVal)) return false;
      if (op === '>' && !(rowVal > targetVal)) return false;
      if (op === '>=' && !(rowVal >= targetVal)) return false;
      continue;
    }

    // ILIKE
    const likeMatch = trimmedPart.match(/([a-zA-Z0-9_]+)\s+ilike\s+__VAL_(\d+)__/i);
    if (likeMatch) {
      const col = likeMatch[1].toLowerCase();
      const pattern = String(values[parseInt(likeMatch[2], 10)]).replace(/%/g, '').toLowerCase();
      const val = String(row[col] || '').toLowerCase();
      if (!val.includes(pattern)) return false;
      continue;
    }

    // expires_at > NOW()
    if (/expires_at\s*>\s*now\(\)/i.test(trimmedPart)) {
      if (!row.expires_at || new Date(row.expires_at) <= new Date()) return false;
      continue;
    }
  }
  return true;
}

tables.ledger = tables.ledger || [];
tables.subscriptionInvoices = tables.subscriptionInvoices || [];
tables.platformRevenue = tables.platformRevenue || [];

const store = { state: tables };

function id(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function save() {
  return Promise.resolve(true);
}

function getBusiness(businessId) {
  return tables.businesses.find(b => b.id == businessId || b.apiKey === businessId || b.api_key === businessId);
}

function walletBalance(businessId) {
  const b = getBusiness(businessId);
  if (!b) return 0;
  if (b.wallet && typeof b.wallet.balance === 'number') return round2(b.wallet.balance);
  return round2(b.wallet_balance || 0);
}

function adjustWallet(businessId, delta) {
  const b = getBusiness(businessId);
  if (!b) throw new Error(`Business not found: ${businessId}`);
  const current = (b.wallet && typeof b.wallet.balance === 'number') ? b.wallet.balance : (b.wallet_balance || 0);
  const next = round2(current + Number(delta));
  if (next < 0 && delta < 0) {
    throw new Error(`Insufficient wallet balance. Current: ZMW ${current}, Requested: ZMW ${Math.abs(delta)}`);
  }
  b.wallet_balance = next;
  if (!b.wallet) {
    b.wallet = { balance: next, currency: b.currency || 'ZMW' };
  } else {
    b.wallet.balance = next;
  }
  return next;
}

function postLedger(businessId, entries) {
  if (!Array.isArray(entries)) entries = [entries];
  const created = [];
  for (const entry of entries) {
    const record = {
      id: id('led'),
      business_id: businessId,
      account: entry.account || 'general',
      debit: round2(entry.debit || 0),
      credit: round2(entry.credit || 0),
      description: entry.description || '',
      ref: entry.ref || '',
      created_at: new Date()
    };
    tables.ledger.push(record);
    created.push(record);
  }
  return created;
}

module.exports = {
  mockSql,
  tables,
  store,
  save,
  id,
  round2,
  postLedger,
  adjustWallet,
  walletBalance,
  getBusiness
};

