const axios = require('axios');

const BASE_URL = process.env.AIRTEL_BASE_URL || 'https://openapiuat.airtel.africa';

async function getToken() {
  const client_id = process.env.AIRTEL_CLIENT_ID;
  const client_secret = process.env.AIRTEL_CLIENT_SECRET;
  if (!client_id || !client_secret) throw new Error('Airtel API credentials missing');

  const resp = await axios.post(`${BASE_URL}/auth/oauth2/token`, {
    client_id,
    client_secret,
    grant_type: 'client_credentials'
  }, { timeout: 10000 });

  return resp.data.access_token;
}

async function payout({ phone, amount, reference, currency = 'ZMW' }) {
  const token = await getToken();
  const cleanPhone = String(phone).replace(/[^0-9]/g, '');
  const msisdn = cleanPhone.startsWith('260') ? cleanPhone : (cleanPhone.startsWith('0') ? '260' + cleanPhone.slice(1) : '260' + cleanPhone);

  const payload = {
    payee: { msisdn },
    reference: reference || `AIRTEL-OUT-${Date.now()}`,
    pin: process.env.AIRTEL_PIN || '1234',
    transaction: {
      amount: Number(amount),
      id: reference || `AIRTEL-TX-${Date.now()}`
    }
  };

  const resp = await axios.post(`${BASE_URL}/standard/v1/disbursements`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Country': 'ZM',
      'X-Currency': currency,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return {
    success: true,
    status: 'successful',
    providerRef: resp.data?.data?.transaction?.id || reference,
    amount: Number(amount),
    raw: resp.data
  };
}

async function collect({ phone, amount, reference, currency = 'ZMW' }) {
  const token = await getToken();
  const cleanPhone = String(phone).replace(/[^0-9]/g, '');
  const msisdn = cleanPhone.startsWith('260') ? cleanPhone : (cleanPhone.startsWith('0') ? '260' + cleanPhone.slice(1) : '260' + cleanPhone);

  const payload = {
    reference: reference || `AIRTEL-IN-${Date.now()}`,
    subscriber: { country: 'ZM', currency, msisdn },
    transaction: {
      amount: Number(amount),
      country: 'ZM',
      currency,
      id: reference || `AIRTEL-COL-${Date.now()}`
    }
  };

  const resp = await axios.post(`${BASE_URL}/merchant/v1/payments/`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Country': 'ZM',
      'X-Currency': currency,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return {
    success: true,
    status: 'pending',
    providerRef: resp.data?.data?.transaction?.id || reference,
    amount: Number(amount),
    raw: resp.data
  };
}

async function status({ providerRef }) {
  const token = await getToken();
  const resp = await axios.get(`${BASE_URL}/standard/v1/payments/${providerRef}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Country': 'ZM', 'X-Currency': 'ZMW' },
    timeout: 10000
  });
  return {
    status: resp.data?.data?.transaction?.status?.toLowerCase() === 'ts' ? 'successful' : 'pending',
    providerRef,
    raw: resp.data
  };
}

async function health() {
  try {
    const token = await getToken();
    return { ok: !!token, detail: 'Airtel OAuth reachable' };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

module.exports = {
  payout,
  disburse: payout,
  collect,
  status,
  health
};
