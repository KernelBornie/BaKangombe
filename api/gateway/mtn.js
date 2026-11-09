const axios = require('axios');

const TARGET_ENV = process.env.MTN_TARGET_ENV || 'sandbox';
const BASE_URL = TARGET_ENV === 'live' ? 'https://proxy.momoapi.mtn.com' : 'https://sandbox.momodeveloper.mtn.com';

async function getToken(service = 'disbursement') {
  const user = service === 'disbursement' ? process.env.MTN_DISBURSEMENT_USER : process.env.MTN_COLLECTION_USER;
  const pass = service === 'disbursement' ? process.env.MTN_DISBURSEMENT_PASS : process.env.MTN_COLLECTION_PASS;
  const key = service === 'disbursement' ? process.env.MTN_DISBURSEMENT_KEY : process.env.MTN_COLLECTION_KEY;

  if (!user || !pass || !key) {
    throw new Error(`MTN ${service} API keys missing in environment`);
  }

  const basic = Buffer.from(`${user}:${pass}`).toString('base64');
  const resp = await axios.post(`${BASE_URL}/${service}/token/`, {}, {
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': key
    },
    timeout: 10000
  });

  return { token: resp.data.access_token, key };
}

async function payout({ phone, amount, reference, currency = 'ZMW', narration = 'MTN Payout' }) {
  const { token, key } = await getToken('disbursement');
  const cleanPhone = String(phone).replace(/[^0-9]/g, '');
  const msisdn = cleanPhone.startsWith('260') ? cleanPhone : (cleanPhone.startsWith('0') ? '260' + cleanPhone.slice(1) : '260' + cleanPhone);

  const payload = {
    amount: String(amount),
    currency,
    externalId: reference || `MTN-OUT-${Date.now()}`,
    payee: { partyIdType: 'MSISDN', partyId: msisdn },
    payerMessage: narration,
    payeeNote: narration
  };

  const xRef = require('crypto').randomUUID();
  await axios.post(`${BASE_URL}/disbursement/v1_0/transfer`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': xRef,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return {
    success: true,
    status: 'successful',
    providerRef: xRef,
    amount: Number(amount),
    raw: { xRef, payload }
  };
}

async function collect({ phone, amount, reference, currency = 'ZMW', narration = 'MTN Collection' }) {
  const { token, key } = await getToken('collection');
  const cleanPhone = String(phone).replace(/[^0-9]/g, '');
  const msisdn = cleanPhone.startsWith('260') ? cleanPhone : (cleanPhone.startsWith('0') ? '260' + cleanPhone.slice(1) : '260' + cleanPhone);

  const payload = {
    amount: String(amount),
    currency,
    externalId: reference || `MTN-IN-${Date.now()}`,
    payer: { partyIdType: 'MSISDN', partyId: msisdn },
    payerMessage: narration,
    payeeNote: narration
  };

  const xRef = require('crypto').randomUUID();
  await axios.post(`${BASE_URL}/collection/v1_0/requesttopay`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': xRef,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return {
    success: true,
    status: 'pending',
    providerRef: xRef,
    amount: Number(amount),
    raw: { xRef, payload }
  };
}

async function status({ providerRef }) {
  const { token, key } = await getToken('collection');
  const resp = await axios.get(`${BASE_URL}/collection/v1_0/requesttopay/${providerRef}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': key
    },
    timeout: 10000
  });
  return {
    status: resp.data.status?.toLowerCase() === 'successful' ? 'successful' : resp.data.status?.toLowerCase(),
    providerRef,
    raw: resp.data
  };
}

async function health() {
  try {
    const { token } = await getToken('collection');
    return { ok: !!token, detail: 'MTN Token service reachable' };
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
