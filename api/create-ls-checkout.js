const axios = require('axios');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  // Hardcoded keys – replace with your actual test mode values
  const LS_API_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5NGQ1OWNlZi1kYmI4LTRlYTUtYjE3OC1kMjU0MGZjZDY5MTkiLCJqdGkiOiJhNDJiNmY3MGE4ZmZlODc1MmM3YzhmNjVkZTAwNmMwMTU4MDY3NjE5ZmM0ZmEyMWEzZWUyYzBkYmMyMGU5NzUxMmQ3YTMzMzY0MTg4NjVkNyIsImlhdCI6MTc4MDI0MzI4Mi44NTAyOTksIm5iZiI6MTc4MDI0MzI4Mi44NTAzMDIsImV4cCI6MTc5NTk5NjgwMC4wMzEyMiwic3ViIjoiNzIwMzMyMSIsInNjb3BlcyI6W119.bk-ut2bSJZrxtHqB0dzB6cTfloT7HobpC8nESzc1L4kwzHWp-follS-o6DmCnfR9-HKmMg5GpbDvpIIwKRTM3X3JTVdKSnwCbJwlUaoB6kTyAz8ZsHFkEH8j7gCB1xAxXOKoEXnpW435TQlkiEsJgBd5F3XNCbc5qyNVsE7mAMa2wCZ8hmAv1NjCpnUHoLKGQsoniOZ55QECXcer6gbPnrUH7rktydx4LboXQGFoZxhMJuhedq1fAoBpvnu5K6g4GrNRECDlXNlANw2cbrt5nHWzlub9kXyXGsBJ9WEbMXJPtEwM_Afdw1WzYBbd7-3Tt3qGh9jzrpSL6icEBOav9JsxyoBSTgRlHvXg6-y2BFtsSOQRl0_OlSA-JcfxEwS5sZIdz1miMoBt6H-jEBpAfdbcvIEqk65BrQI6xtourKAok92zJDYfw5oe5e8erqTiGyJgMQ4ndLGddn1XgqsMFDEgDHMs5uIQBitk5Lmk1Umte9Odu7PE8v9i7pgGa0eWekqd7AudJoT3IBhPGxInyH_Nj9HXsGmBgM2AP0ONkRSz9Gd_8yLETQECIB7opL9dhMrsm_XuCPcYPs11K5Jot5cazcaAOzrHMNmmQyo9xUrNPWwBoRfSOeO3xIWd7ZSi-OaWLfinLTFKZoTuDyQK0hQ1Fas2Oq8LctMwT1m-Tj4';
  const LS_STORE_ID = '387550';
  const LS_VARIANT_ID = '1705111';

  try {
    const response = await axios.post(
      'https://api.lemonsqueezy.com/v1/checkouts',
      {
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: { email, custom: { user_email: email } },
            product_options: {
              redirect_url: 'https://ba-kangombe.vercel.app/success',
              receipt_button_text: 'Go to Dashboard',
              receipt_link_url: 'https://ba-kangombe.vercel.app/dashboard'
            },
            checkout_options: { embed: false, media: false, logo: false, desc: false, discount: true, dark: false }
          },
          relationships: {
            store: { data: { type: 'stores', id: LS_STORE_ID } },
            variant: { data: { type: 'variants', id: LS_VARIANT_ID } }
          }
        }
      },
      {
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${LS_API_KEY}`
        }
      }
    );
    const checkoutUrl = response.data.data.attributes.url;
    res.status(200).json({ url: checkoutUrl });
  } catch (error) {
    console.error('Lemon Squeezy error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Checkout failed' });
  }
}
