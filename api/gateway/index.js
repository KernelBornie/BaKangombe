const sandbox     = require('./sandbox');
const flutterwave = require('./flutterwave');
const mtn         = require('./mtn');
const airtel      = require('./airtel');
const zamtel      = require('./zamtel');
const health      = require('./health');

const MODE             = process.env.MOMO_MODE || 'sandbox';         // sandbox | live
const PRIMARY          = process.env.MOMO_PROVIDER || 'flutterwave'; // flutterwave | mtn | airtel | zamtel | auto
const FALLBACK         = process.env.MOMO_FALLBACK || 'mtn';          // used when primary throws
const FALLBACK_ENABLED = process.env.MOMO_FALLBACK_DISABLED !== 'true';

const CLIENTS = { flutterwave, mtn, airtel, zamtel };

const CARRIER_TO_CLIENT = {
  MTN:    'mtn',
  AIRTEL: 'airtel',
  ZAMTEL: 'zamtel'
};

function tryProvider(name, op, args) {
  const c = CLIENTS[name];
  if (!c) throw new Error(`unknown provider ${name}`);
  const fn = c[op] || (op === 'disburse' ? c.payout : c.disburse);
  if (!fn) throw new Error(`operation ${op} not supported by provider ${name}`);
  return fn(args);
}

async function dispatch(op, args, opts = {}) {
  if (MODE === 'sandbox') return sandbox[op](args);

  // Carrier-aware routing: if MOMO_PROVIDER=auto, pick client by carrier
  const provider = (PRIMARY === 'auto')
    ? (CARRIER_TO_CLIENT[args.carrier] || 'flutterwave')
    : PRIMARY;

  const errors = [];

  // Attempt 1: primary
  try {
    return await tryProvider(provider, op, args);
  } catch (e) {
    errors.push({ provider, error: e.message });
    if (!FALLBACK_ENABLED || FALLBACK === provider) {
      const err = new Error(`primary provider ${provider} failed: ${e.message}`);
      err.attempts = errors;
      throw err;
    }
  }

  // Attempt 2: fallback (except for carrier-specific like zamtel — only Cellulant handles it)
  const fb = (args.carrier === 'ZAMTEL' && FALLBACK !== 'zamtel') ? 'zamtel' : FALLBACK;
  try {
    const result = await tryProvider(fb, op, args);
    result.raw = { ...result.raw, _fallbackFrom: provider, _fallbackReason: errors[0].error };
    return result;
  } catch (e) {
    errors.push({ provider: fb, error: e.message });
    const err = new Error(`both providers failed (${provider}, ${fb})`);
    err.attempts = errors;
    throw err;
  }
}

async function payout(args)   { return dispatch('payout',  args); }
async function disburse(args) { return dispatch('payout',  args); }
async function collect(args)  { return dispatch('collect', args); }

async function status({ providerRef, reference }) {
  if (MODE === 'sandbox') return sandbox.status({ providerRef, reference });
  try {
    return await tryProvider(PRIMARY, 'status', { providerRef, reference });
  } catch (e) {
    if (!FALLBACK_ENABLED) throw e;
    return tryProvider(FALLBACK, 'status', { providerRef, reference });
  }
}

module.exports = {
  payout,
  disburse,
  collect,
  status,
  MODE,
  PROVIDER: PRIMARY,
  FALLBACK,
  health: health.all
};
