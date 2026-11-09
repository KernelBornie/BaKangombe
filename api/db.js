let PrismaClient = null;
let Prisma = null;

try {
  const p = require('@prisma/client');
  PrismaClient = p.PrismaClient;
  Prisma = p.Prisma;
} catch (e) {
  // Prisma client not yet generated on disk
}

const mockDb = require('./mock-db');

let prisma = null;

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Refusing to start with in-memory fallback.');
  console.error('Set DATABASE_URL or run with DATABASE_URL=memory explicitly for dev.');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
  // Dev-only: explicit opt-in to memory mode, and scream about it
  console.warn('⚠️  DEV MEMORY MODE — data will be lost on restart. Set DATABASE_URL to use Postgres.');
} else if (PrismaClient) {
  try {
    prisma = new PrismaClient();
  } catch (err) {
    console.error('PrismaClient init error:', err.message);
  }
}

async function adjustWallet(businessId, delta) {
  if (prisma && Prisma) {
    return prisma.$transaction(async tx => {
      const b = await tx.business.findUnique({ where: { id: String(businessId) } });
      if (!b) throw new Error('business not found');
      const next = Number(b.walletBalance) + Number(delta);
      if (next < 0 && delta < 0) throw new Error('insufficient wallet balance');
      const updated = await tx.business.update({
        where: { id: String(businessId) },
        data: { walletBalance: new Prisma.Decimal(next.toFixed(2)) }
      });
      return Number(updated.walletBalance);
    });
  }
  return mockDb.adjustWallet(businessId, delta);
}

async function walletBalance(businessId) {
  if (prisma) {
    const b = await prisma.business.findUnique({ where: { id: String(businessId) } });
    if (b) return Number(b.walletBalance);
  }
  return mockDb.walletBalance(businessId);
}

async function postLedger(businessId, entries) {
  if (prisma && Prisma) {
    const batchId = 'lbr_' + require('crypto').randomBytes(6).toString('hex');
    const list = Array.isArray(entries) ? entries : [entries];
    await prisma.ledgerEntry.createMany({
      data: list.map(e => ({
        id: 'le_' + require('crypto').randomBytes(6).toString('hex'),
        batchId,
        businessId: String(businessId),
        account: e.account || 'general',
        debit: new Prisma.Decimal(e.debit ?? 0),
        credit: new Prisma.Decimal(e.credit ?? 0),
        meta: e.meta ?? { ref: e.ref, description: e.description }
      }))
    });
    return batchId;
  }
  return mockDb.postLedger(businessId, entries);
}

module.exports = {
  prisma,
  Prisma,
  adjustWallet,
  walletBalance,
  postLedger,
  mockSql: mockDb.mockSql,
  tables: mockDb.tables,
  store: mockDb.store,
  save: mockDb.save,
  id: mockDb.id,
  round2: mockDb.round2,
  getBusiness: mockDb.getBusiness
};
