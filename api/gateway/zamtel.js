const axios = require('axios');

const BASE_URL = process.env.CELLULANT_BASE_URL || 'https://api.cellulant.io';

function getAuth() {
  const user = process.env.CELLULANT_USER;
  const pass = process.env.CELLULANT_PASS;
  if (!user || !pass) throw new Error('Cellulant Zamtel credentials not configured');
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

async function payout({ phone, amount, reference, currency = 'ZMW' }) {
  const auth = getAuth();
  const payload = {
    serviceCode: 'ZAMTEL_DISBURSE',
    accountNumber: phone,
    amount: Number(amount),
    currencyCode: currency,
    reference: reference || `ZAMTEL-OUT-${Date.now()}`
  };

  const resp = await axios.post(`${BASE_URL}/v2/disbursements`, payload, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });

  return {
    success: true,
    status: 'successful',
    providerRef: resp.data?.transactionId || reference,
    amount: Number(amount),
    raw: resp.data
  };
}

async function collect({ phone, amount, reference, currency = 'ZMW' }) {
  const auth = getAuth();
  const payload = {
    serviceCode: 'ZAMTEL_EXPRESS',
    msisdn: phone,
    amount: Number(amount),
    currencyCode: currency,
    merchantTransactionID: reference || `ZAMTEL-IN-${Date.now()}`
  };

  const resp = await axios.post(`${BASE_URL}/v2/checkout`, payload, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });

  return {
    success: true,
    status: 'pending',
    providerRef: resp.data?.checkoutToken || reference,
    amount: Number(amount),
    raw: resp.data
  };
}

async function status({ providerRef }) {
  const auth = getAuth();
  const resp = await axios.get(`${BASE_URL}/v2/query/${providerRef}`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 10000
  });
  return {
    status: resp.data?.status === 'SUCCESS' ? 'successful' : 'pending',
    providerRef,
    raw: resp.data
  };
}

async function health() {
  const user = process.env.CELLULANT_USER;
  const pass = process.env.CELLULANT_PASS;
  if (!user || !pass) return { ok: false, detail: 'Cellulant credentials missing' };
  return { ok: true, detail: 'Cellulant gateway configured' };
}

module.exports = {
  payout,
  disburse: payout,
  collect,
  status,
  health
};
