function payout({ carrier = 'MTN', phone, amount, reference }) {
  const numAmount = Number(amount);
  const ok = numAmount <= 50000;
  return {
    success: ok,
    status: ok ? 'successful' : 'failed',
    providerRef: `SBX-PAYOUT-${carrier}-${Date.now()}`,
    flwRef: `SBX-PAYOUT-${carrier}-${Date.now()}`,
    amount: numAmount,
    phone,
    reference,
    simulated: true,
    raw: { sandbox: true, amount: numAmount, phone, reference, note: 'No real money moved in sandbox.' }
  };
}

function collect({ carrier = 'MTN', phone, amount, reference }) {
  const numAmount = Number(amount);
  return {
    success: true,
    status: 'successful',
    providerRef: `SBX-COL-${carrier}-${Date.now()}`,
    flwRef: `SBX-COL-${carrier}-${Date.now()}`,
    amount: numAmount,
    phone,
    reference,
    simulated: true,
    raw: { sandbox: true, amount: numAmount, phone, reference, note: 'Simulated approval in sandbox.' }
  };
}

function status({ providerRef }) {
  return {
    success: true,
    status: 'successful',
    providerRef: providerRef || `SBX-${Date.now()}`,
    simulated: true,
    raw: { sandbox: true }
  };
}

module.exports = {
  payout,
  disburse: payout,
  collect,
  status
};
