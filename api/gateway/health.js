const providers = {
  flutterwave: require('./flutterwave'),
  mtn:         require('./mtn'),
  airtel:      require('./airtel'),
  zamtel:      require('./zamtel')
};

const REQUIRED_ENV = {
  flutterwave: ['FLW_SECRET_KEY'],
  mtn:         ['MTN_COLLECTION_KEY', 'MTN_COLLECTION_USER', 'MTN_COLLECTION_PASS',
                'MTN_DISBURSEMENT_KEY', 'MTN_DISBURSEMENT_USER', 'MTN_DISBURSEMENT_PASS'],
  airtel:      ['AIRTEL_CLIENT_ID', 'AIRTEL_CLIENT_SECRET', 'AIRTEL_PIN'],
  zamtel:      ['CELLULANT_USER', 'CELLULANT_PASS', 'CELLULANT_BASE_URL']
};

async function check(name) {
  const missing = REQUIRED_ENV[name].filter(k => !process.env[k]);
  if (missing.length) {
    return { provider: name, configured: false, missing };
  }
  try {
    if (typeof providers[name].health === 'function') {
      const r = await providers[name].health();
      return { provider: name, configured: true, reachable: r.ok, detail: r.detail };
    }
    return { provider: name, configured: true, reachable: 'unknown' };
  } catch (e) {
    return { provider: name, configured: true, reachable: false, error: e.message };
  }
}

async function all() {
  return Promise.all(Object.keys(REQUIRED_ENV).map(check));
}

module.exports = { all, check };
