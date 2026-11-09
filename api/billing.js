const crypto = require('crypto');
const { store, save, id, round2, postLedger, adjustWallet, walletBalance, getBusiness } = require('./db');
const gateway = require('./gateway');

// ---------- Subscription plans ----------
const PLANS = {
  free:     { price: 0,    modules: 2,  txnFeePct: 1.5, escrowFeePct: 5, label: 'Free' },
  starter:  { price: 99,   modules: 6,  txnFeePct: 1.0, escrowFeePct: 4, label: 'Starter' },
  growth:   { price: 299,  modules: 12, txnFeePct: 0.7, escrowFeePct: 3, label: 'Growth' },
  scale:    { price: 799,  modules: 16, txnFeePct: 0.5, escrowFeePct: 2, label: 'Scale' }
};

// Your platform's own wallet — this is YOU, the operator.
function operatorWallet() {
  let op = store.state.businesses.find(b => b.isOperator === true || b.id === 'operator' || String(b.apiKey || b.api_key).startsWith('operator_'));
  if (!op) {
    const opKey = process.env.OPERATOR_API_KEY || ('operator_' + crypto.randomBytes(16).toString('hex'));
    op = {
      id: 'operator',
      name: process.env.OPERATOR_NAME || 'BaKangombe Platform Operator',
      email: process.env.OPERATOR_EMAIL || 'operator@bakangombe.com',
      apiKey: opKey,
      api_key: opKey,
      modules: Object.keys(PLANS),
      wallet: { balance: 0.00, currency: 'ZMW' },
      wallet_balance: 0.00,
      isOperator: true,
      tpin: process.env.OPERATOR_TPIN || '1002345678',
      flwAccount: process.env.OPERATOR_FLW_ACCOUNT || '',
      created_at: new Date()
    };
    store.state.businesses.push(op);
  }
  // Ensure sync
  if (op.wallet_balance === undefined) op.wallet_balance = op.wallet ? op.wallet.balance : 0;
  if (!op.wallet) op.wallet = { balance: op.wallet_balance, currency: 'ZMW' };
  return op;
}

/**
 * Charge platform fee across 5 revenue streams
 * Supports both ({ businessId, type, grossAmount, meta }) and (businessId, amount, kind, meta)
 */
async function chargePlatformFee(optsOrBizId, amountOrType, kindOrAmount, maybeMeta) {
  let businessId, type, grossAmount, meta;
  if (typeof optsOrBizId === 'object' && optsOrBizId !== null) {
    businessId = optsOrBizId.businessId;
    type = optsOrBizId.type || optsOrBizId.kind;
    grossAmount = optsOrBizId.grossAmount ?? optsOrBizId.amount ?? 0;
    meta = optsOrBizId.meta || {};
  } else {
    businessId = optsOrBizId;
    grossAmount = amountOrType;
    type = kindOrAmount;
    meta = maybeMeta || {};
  }

  if (type === 'txn') type = 'transaction';
  if (type === 'loan') type = 'loan_spread';

  const op = operatorWallet();
  const biz = getBusiness(businessId);
  const planKey = (biz && biz.plan && PLANS[biz.plan.toLowerCase()]) ? biz.plan.toLowerCase() : 'starter';
  const plan = PLANS[planKey] || PLANS.starter;

  let fee = 0;
  const numGross = round2(grossAmount);

  switch (type) {
    case 'transaction':
      // Commission on mobile-money transfers/collections: 0.5% - 1.5%
      fee = round2(numGross * (plan.txnFeePct / 100));
      if (fee < 0.20 && numGross > 0) fee = 0.20; // nominal floor
      break;
    case 'escrow':
      // Commission on freelance escrow release: 2% - 5%
      fee = round2(numGross * (plan.escrowFeePct / 100));
      if (fee < 1.00 && numGross > 0) fee = 1.00;
      break;
    case 'loan_spread':
    case 'loan':
      // 2% origination fee, earned once, disclosed (compliant with Moneylenders Act)
      fee = round2(numGross * 0.02);
      break;
    case 'module_activation':
      // Per-module fee
      fee = round2(meta.fee || 49.00);
      break;
    case 'subscription':
      fee = round2(numGross);
      break;
    default:
      fee = round2(meta.fee || 0);
  }

  const netAmount = round2(Math.max(0, numGross - (type === 'subscription' || type === 'module_activation' ? 0 : fee)));
  const ref = id('fee');

  // Credit Operator Wallet
  if (fee > 0) {
    await adjustWallet(op.id, fee);

    // Ledger posting
    await postLedger(op.id, {
      account: 'platform_revenue',
      debit: 0,
      credit: fee,
      description: `Platform fee: ${type} from ${biz ? biz.name : 'Business #' + businessId}`,
      ref
    });

    if (biz) {
      await postLedger(biz.id, {
        account: 'platform_fee_expense',
        debit: fee,
        credit: 0,
        description: `Fee deducted for ${type} (${ref})`,
        ref
      });
    }

    // Revenue record
    const record = {
      id: ref,
      business_id: businessId,
      business_name: biz ? biz.name : `Business ${businessId}`,
      type,
      gross_amount: numGross,
      fee,
      net_amount: netAmount,
      plan: planKey,
      meta,
      created_at: new Date()
    };
    store.state.platformRevenue = store.state.platformRevenue || [];
    store.state.platformRevenue.push(record);
  }

  await save();

  return {
    success: true,
    fee,
    grossAmount: numGross,
    netAmount,
    type,
    ref,
    operatorBalance: op.wallet_balance || op.wallet.balance
  };
}

/**
 * Create a monthly subscription invoice for a business
 */
async function createSubscriptionInvoice({ businessId, planKey = 'starter' }) {
  const biz = getBusiness(businessId);
  if (!biz) throw new Error(`Business not found: ${businessId}`);
  const targetPlan = PLANS[planKey.toLowerCase()] || PLANS.starter;

  const invoice = {
    id: id('sub_inv'),
    business_id: biz.id,
    business_name: biz.name,
    business_email: biz.email,
    plan: planKey.toLowerCase(),
    amount: targetPlan.price,
    currency: 'ZMW',
    status: targetPlan.price === 0 ? 'paid' : 'unpaid',
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days grace
    created_at: new Date(),
    paid_at: targetPlan.price === 0 ? new Date() : null
  };

  store.state.subscriptionInvoices = store.state.subscriptionInvoices || [];
  store.state.subscriptionInvoices.push(invoice);
  await save();
  return invoice;
}

/**
 * Collect payment for a subscription invoice
 */
async function collectSubscription(invoiceId, { method = 'wallet', phone, carrier = 'MTN' } = {}) {
  store.state.subscriptionInvoices = store.state.subscriptionInvoices || [];
  const inv = store.state.subscriptionInvoices.find(i => i.id === invoiceId);
  if (!inv) throw new Error(`Subscription invoice not found: ${invoiceId}`);
  if (inv.status === 'paid') return { success: true, message: 'Already paid', invoice: inv };

  const biz = getBusiness(inv.business_id);
  if (!biz) throw new Error(`Business not found for invoice ${invoiceId}`);

  let chargeResult;

  if (method === 'wallet') {
    // Debit business wallet
    await adjustWallet(biz.id, -inv.amount);
    chargeResult = { success: true, method: 'wallet', ref: id('wlt_tx') };
  } else if (method === 'momo' || method === 'mobile_money') {
    // Collect via Mobile Money
    const momoPhone = phone || biz.phone || '0971234567';
    chargeResult = await gateway.collect({
      carrier,
      phone: momoPhone,
      amount: inv.amount,
      reference: inv.id,
      narration: `BaKangombe ${inv.plan.toUpperCase()} Subscription`
    });
    if (!chargeResult.success) {
      throw new Error(`Mobile money collection failed: ${chargeResult.error || chargeResult.message}`);
    }
  }

  // Credit platform operator
  await chargePlatformFee({
    businessId: biz.id,
    type: 'subscription',
    grossAmount: inv.amount,
    meta: { invoiceId: inv.id, plan: inv.plan, method }
  });

  inv.status = 'paid';
  inv.paid_at = new Date();
  inv.payment_method = method;
  inv.tx_ref = chargeResult.ref || chargeResult.txRef;

  // Update business plan & validity
  biz.plan = inv.plan;
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + 1);
  biz.subscription_expires_at = expiry;

  await save();
  return { success: true, invoice: inv, charge: chargeResult };
}

/**
 * Set plan for business
 */
async function setPlan(businessId, planKey) {
  const biz = getBusiness(businessId);
  if (!biz) throw new Error(`Business not found: ${businessId}`);
  const key = planKey.toLowerCase();
  if (!PLANS[key]) throw new Error(`Invalid plan: ${planKey}`);

  biz.plan = key;
  const plan = PLANS[key];

  // If upgrading to paid plan, create subscription invoice
  let invoice = null;
  if (plan.price > 0) {
    invoice = await createSubscriptionInvoice({ businessId: biz.id, planKey: key });
  } else {
    biz.subscription_expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  }

  await save();
  return { success: true, business: biz, plan, invoice };
}

/**
 * Run subscription billing cycle across all active businesses
 */
async function runSubscriptionBilling() {
  const results = [];
  store.state.subscriptionInvoices = store.state.subscriptionInvoices || [];

  for (const biz of store.state.businesses) {
    if (biz.isOperator) continue;
    const planKey = (biz.plan || 'starter').toLowerCase();
    const plan = PLANS[planKey] || PLANS.starter;
    if (plan.price === 0) continue;

    // Check if current subscription expired or nearing expiry (within 3 days)
    const expiresAt = biz.subscription_expires_at ? new Date(biz.subscription_expires_at) : new Date(0);
    const now = new Date();
    const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);

    if (daysUntilExpiry <= 3) {
      // Create invoice
      const inv = await createSubscriptionInvoice({ businessId: biz.id, planKey });
      let autoPaid = false;
      let errMessage = null;

      // Try auto-debit if wallet has enough funds
      const currentBalance = await walletBalance(biz.id);
      if (currentBalance >= plan.price) {
        try {
          await collectSubscription(inv.id, { method: 'wallet' });
          autoPaid = true;
        } catch (err) {
          errMessage = err.message;
        }
      }

      results.push({
        businessId: biz.id,
        businessName: biz.name,
        invoiceId: inv.id,
        amount: plan.price,
        autoPaid,
        error: errMessage
      });
    }
  }

  return { timestamp: new Date(), billedCount: results.length, details: results };
}

/**
 * Generate operator revenue and financial KPI report
 */
function revenueReport() {
  const op = operatorWallet();
  const revRecords = store.state.platformRevenue || [];
  const invoices = store.state.subscriptionInvoices || [];
  const businesses = (store.state.businesses || []).filter(b => !b.isOperator);

  // Group by stream
  const byStream = {
    subscription: 0,
    transaction: 0,
    escrow: 0,
    loan_spread: 0,
    module_activation: 0
  };

  let totalGross = 0;
  let totalRevenue = 0;

  for (const rec of revRecords) {
    const fee = round2(rec.fee || 0);
    totalRevenue = round2(totalRevenue + fee);
    totalGross = round2(totalGross + (rec.gross_amount || fee));
    if (byStream[rec.type] !== undefined) {
      byStream[rec.type] = round2(byStream[rec.type] + fee);
    } else {
      byStream[rec.type] = fee;
    }
  }

  const unpaidInvoices = invoices.filter(i => i.status !== 'paid');
  const overdueTotal = unpaidInvoices.reduce((sum, i) => round2(sum + (i.amount || 0)), 0);

  return {
    operator: {
      name: op.name,
      id: op.id,
      apiKey: op.apiKey || op.api_key,
      walletBalance: op.wallet_balance || (op.wallet ? op.wallet.balance : 0),
      currency: op.currency || 'ZMW',
      flwAccount: op.flwAccount || 'Configured via FLW_ACCOUNT'
    },
    summary: {
      totalRevenue,
      totalGrossVolume: totalGross,
      activeBusinessesCount: businesses.length,
      revenueEventsCount: revRecords.length,
      overdueInvoicesCount: unpaidInvoices.length,
      overdueAmount: overdueTotal
    },
    byStream,
    plans: PLANS,
    recentEvents: revRecords.slice(-25).reverse(),
    unpaidInvoices: unpaidInvoices.slice(-20)
  };
}

module.exports = {
  PLANS,
  operatorWallet,
  chargePlatformFee,
  createSubscriptionInvoice,
  collectSubscription,
  setPlan,
  runSubscriptionBilling,
  revenueReport
};
