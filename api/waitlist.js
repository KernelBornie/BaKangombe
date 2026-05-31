const axios = require('axios');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('BREVO_API_KEY not set');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'BaKangombe', email: 'bornfacek135@gmail.com' },
      to: [{ email, name: email.split('@')[0] }],
      subject: 'Welcome to the BaKangombe Waitlist!',
      htmlContent: `<html><body>
        <h2>Thank you for joining!</h2>
        <p>You'll be the first to know when we launch premium features.</p>
        <p>– Bornface Kangombe Kernel</p>
      </body></html>`
    }, {
      headers: {
        'Accept': 'application/json',
        'api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Email sent to ${email} via Brevo`);
    return res.status(200).json({ message: 'Added to waitlist and welcome email sent!' });
  } catch (err) {
    console.error('Brevo error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to send email. Check Brevo API key or sender.' });
  }
}