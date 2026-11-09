#!/usr/bin/env node
/**
 * One-shot migration: api/data.json (or in-memory mock-db) -> Postgres via Prisma.
 * Idempotent: uses upsert by primary key.
 * Never deletes rows — safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/migrate-from-json.js
 */
const fs = require('fs');
const path = require('path');

let prisma, Prisma;
try {
  const p = require('@prisma/client');
  prisma = new p.PrismaClient();
  Prisma = p.Prisma;
} catch (e) {
  console.error('Prisma client not yet generated. Run: npx prisma generate');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'api', 'data.json');
const DEC = v => new Prisma.Decimal(String(v ?? 0));
const DT = v => v ? new Date(v) : new Date();
const J = v => v ?? {};

async function migrate() {
  let src;
  if (fs.existsSync(DB_PATH)) {
    console.log(`→ Reading ${DB_PATH}`);
    src = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } else {
    console.log(`→ ${DB_PATH} not found; exporting from api/mock-db state`);
    const { store } = require('../api/mock-db');
    src = store.state;
  }

  const counts = {};

  // ---- 1. Businesses ----
  counts.businesses = 0;
  for (const b of src.businesses || []) {
    const id = String(b.id);
    await prisma.business.upsert({
      where: { id },
      update: {
        name: b.name,
        tpin: b.tpin ?? null,
        pacra: b.pacra ?? null,
        apiKey: b.apiKey || b.api_key,
        plan: b.plan ?? 'free',
        isOperator: !!b.isOperator,
        walletBalance: DEC(b.wallet?.balance ?? b.wallet_balance ?? 0),
        currency: b.currency || b.wallet?.currency || 'ZMW',
        modules: b.modules ?? [],
        subscriptionPaidAt: b.subscriptionPaidAt ? DT(b.subscriptionPaidAt) : null
      },
      create: {
        id,
        name: b.name,
        tpin: b.tpin ?? null,
        pacra: b.pacra ?? null,
        apiKey: b.apiKey || b.api_key,
        plan: b.plan ?? 'free',
        isOperator: !!b.isOperator,
        walletBalance: DEC(b.wallet?.balance ?? b.wallet_balance ?? 0),
        currency: b.currency || b.wallet?.currency || 'ZMW',
        modules: b.modules ?? [],
        subscriptionPaidAt: b.subscriptionPaidAt ? DT(b.subscriptionPaidAt) : null,
        createdAt: DT(b.createdAt || b.created_at)
      }
    });
    counts.businesses++;
  }

  // ---- 2. Ledger ----
  counts.ledgerEntries = 0;
  for (const l of src.ledger || []) {
    const id = String(l.id);
    await prisma.ledgerEntry.upsert({
      where: { id },
      update: {},
      create: {
        id,
        batchId: l.batchId || `batch_${id}`,
        businessId: String(l.businessId || l.business_id),
        account: l.account || 'general',
        debit: DEC(l.debit),
        credit: DEC(l.credit),
        meta: J(l.meta || { ref: l.ref }),
        createdAt: DT(l.createdAt || l.created_at)
      }
    });
    counts.ledgerEntries++;
  }

  // ---- 3. Mobile money ----
  counts.mmTransactions = 0;
  for (const t of src.mmTransactions || src.momo_transactions || []) {
    const id = String(t.id);
    const ref = t.reference || `MOMO-REF-${id}`;
    await prisma.mmTransaction.upsert({
      where: { id },
      update: {},
      create: {
        id,
        businessId: String(t.businessId || t.business_id),
        type: t.type || 'send',
        carrier: t.carrier || t.provider || 'MTN',
        phone: t.phone,
        amount: DEC(t.amount),
        fee: DEC(t.fee || 0),
        total: DEC(t.total || t.amount),
        reference: ref,
        status: t.status ?? 'completed',
        gatewayRef: t.gatewayRef ?? null,
        simulated: !!t.simulated,
        note: t.note ?? null,
        providerRaw: t.providerRaw ?? null,
        settledAt: t.settledAt ? DT(t.settledAt) : null,
        failedAt: t.failedAt ? DT(t.failedAt) : null,
        createdAt: DT(t.createdAt || t.created_at)
      }
    });
    counts.mmTransactions++;
  }

  // ---- 4. Invoices ----
  counts.invoices = 0;
  for (const i of src.invoices || []) {
    const id = String(i.id);
    await prisma.invoice.upsert({
      where: { id },
      update: {},
      create: {
        id,
        businessId: String(i.businessId || i.business_id),
        number: i.number || `INV-${id}`,
        tpin: i.tpin ?? null,
        fiscalMarkId: i.fiscalMarkId ?? null,
        customer: J(typeof i.customer === 'object' ? i.customer : { name: i.customer }),
        lines: J(i.lines || [{ item: i.items, amount: i.amount }]),
        subtotal: DEC(i.subtotal || i.amount),
        vat: DEC(i.vat || 0),
        total: DEC(i.total || i.amount),
        currency: i.currency ?? 'ZMW',
        status: i.status ?? 'unpaid',
        verifyUrl: i.verifyUrl ?? null,
        zraSignature: i.zraSignature ?? null,
        receipt: i.receipt ?? null,
        paidAt: i.paidAt ? DT(i.paidAt) : null,
        createdAt: DT(i.createdAt || i.created_at)
      }
    });
    counts.invoices++;
  }

  counts.subscriptionInvoices = 0;
  for (const i of src.subscriptionInvoices || []) {
    const id = String(i.id);
    await prisma.subscriptionInvoice.upsert({
      where: { id },
      update: {},
      create: {
        id,
        businessId: String(i.businessId || i.business_id),
        plan: i.plan,
        amount: DEC(i.amount),
        currency: i.currency ?? 'ZMW',
        number: i.number || id,
        status: i.status ?? 'pending',
        providerRef: i.providerRef ?? i.tx_ref ?? null,
        dueAt: DT(i.dueAt || i.due_date),
        paidAt: i.paidAt ? DT(i.paidAt) : null,
        createdAt: DT(i.createdAt || i.created_at)
      }
    });
    counts.subscriptionInvoices++;
  }

  // ---- 5. Loans ----
  counts.loans = 0;
  for (const l of src.loans || []) {
    const id = String(l.id);
    const term = l.termMonths ?? 3;
    const orig = DEC(l.originationFee ?? Number(l.amount) * 0.02);
    const rate = DEC(l.interestRatePct ?? 18);
    const intAmt = DEC(l.interestAmount ?? (Number(l.amount) * Number(rate) / 100 * term / 12));
    const repay = DEC(l.totalRepayable ?? (Number(l.amount) + Number(orig) + Number(intAmt)));
    await prisma.loan.upsert({
      where: { id },
      update: {},
      create: {
        id,
        businessId: String(l.businessId || l.business_id),
        phone: l.phone,
        amount: DEC(l.amount),
        termMonths: term,
        originationFee: orig,
        interestRatePct: rate,
        interestAmount: intAmt,
        totalRepayable: repay,
        monthlyPayment: DEC(l.monthlyPayment ?? Number(repay) / term),
        score: Number(l.score ?? 500),
        disclosure: J(l.disclosure),
        status: l.status ?? 'disbursed',
        reference: l.reference || `LOAN-REF-${id}`,
        gatewayRef: l.gatewayRef ?? null,
        simulated: !!l.simulated,
        createdAt: DT(l.createdAt || l.created_at)
      }
    });
    counts.loans++;
  }

  console.log('\n✓ Migration complete:');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(28)} ${v}`);
  }
  return counts;
}

if (require.main === module) {
  migrate()
    .then(() => console.log('\n✓ Done.'))
    .catch(e => { console.error('Migration error:', e); process.exit(1); })
    .finally(() => prisma && prisma.$disconnect());
}

module.exports = { migrate };
