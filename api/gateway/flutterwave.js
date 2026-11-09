const axios = require('axios');

const BASE_URL = 'https://api.flutterwave.com/v3';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function payout({ carrier = 'MTN', phone, amount, reference, currency = 'ZMW', narration = 'BaKangombe Payout' }) {
  const bank = carrier.toUpperCase().includes('MTN') ? 'MPS' : carrier.toUpperCase().includes('AIRTEL') ? 'AIRTEL' : 'ZAMTEL';
  const payload = {
    account_bank: bank,
    account_number: phone,
    amount: Number(amount),
    narration,
    currency,
    reference: reference || `FLW-OUT-${Date.now()}`,
    callback_url: process.env.FLW_CALLBACK_URL || 'https://bakangombe.com/api/webhook/flutterwave',
    debit_currency: currency
  };

  const resp = await axios.post(`${BASE_URL}/transfers`, payload, {
    headers: getHeaders(),
    timeout: 15000
  });

  return {
    success: resp.data.status === 'success',
    status: resp.data.status === 'success' ? 'successful' : 'pending',
    providerRef: String(resp.data.data?.id || reference),
    flwRef: String(resp.data.data?.id || reference),
    amount: Number(amount),
    raw: resp.data
  };
}

async function collect({ carrier = 'MTN', phone, amount, reference, currency = 'ZMW', narration = 'BaKangombe Collection', email = 'billing@bakangombe.com' }) {
  const payload = {
    tx_ref: reference || `FLW-COL-${Date.now()}`,
    amount: Number(amount),
    currency,
    network: carrier.toUpperCase(),
    email,
    phone_number: phone,
    fullname: 'Customer',
    client_ip: '127.0.0.1',
    device_fingerprint: 'bkg_client',
    narration
  };

  const resp = await axios.post(`${BASE_URL}/charges?type=mobile_money_zambia`, payload, {
    headers: getHeaders(),
    timeout: 15000
  });

  return {
    success: resp.data.status === 'success',
    status: resp.data.status === 'success' ? 'successful' : 'pending',
    providerRef: String(resp.data.data?.flw_ref || resp.data.data?.id || reference),
    flwRef: String(resp.data.data?.flw_ref || resp.data.data?.id || reference),
    amount: Number(amount),
    raw: resp.data
  };
}

async function status({ providerRef, reference }) {
  const query = reference ? `verify_by_reference?tx_ref=${encodeURIComponent(reference)}` : `${providerRef}`;
  const url = reference ? `${BASE_URL}/transactions/${query}` : `${BASE_URL}/transactions/${providerRef}/verify`;
  const resp = await axios.get(url, { headers: getHeaders(), timeout: 10000 });
  return {
    status: resp.data?.data?.status === 'successful' ? 'successful' : 'pending',
    providerRef: String(resp.data?.data?.id || providerRef),
    raw: resp.data
  };
}

async function health() {
  const key = process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) return { ok: false, detail: 'FLW_SECRET_KEY not configured' };
  try {
    const resp = await axios.get(`${BASE_URL}/balances`, { headers: getHeaders(), timeout: 8000 });
    return { ok: resp.status === 200, detail: 'Flutterwave API reachable' };
  } catch (err) {
    return { ok: false, detail: err.response?.data?.message || err.message };
  }
}

module.exports = {
  payout,
  disburse: payout,
  collect,
  status,
  health
};
