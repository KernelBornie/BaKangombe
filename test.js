const axios = require('axios');

const LS_API_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5NGQ1OWNlZi1kYmI4LTRlYTUtYjE3OC1kMjU0MGZjZDY5MTkiLCJqdGkiOiJmOThiODk0ZGM5MTc0MWVmMmMzMGY0MjA3NmJmNjg0MGMzMGViNjA1MzI0MTk2NzdjYjgzZjdjN2Y3NTI5MDFlMDdmOTc4M2EyMTMyMDI2YSIsImlhdCI6MTc3OTg5NTY3OS42OTIzOTIsIm5iZiI6MTc3OTg5NTY3OS42OTIzOTUsImV4cCI6MTc5NTczNzYwMC4wMzgyODcsInN1YiI6IjcyMDMzMjEiLCJzY29wZXMiOltdfQ.Z69ksZ6Hnb9cyQH0UO5pHTM78_qI5sCscmOTn1fJCdaiLePhREH2EEr55P-GzN1xe5_zUzWIOxttpJCsoho5nQXwnHS25UuRnuCuJeGYfRAeNIP58C8HimtIO0LE65pHLDl1ukK_9pFKUfBhRedHNN75SE4lQ0HBSt2qnHxnsFRix-uIoqDUevbMCfVpUkYQmshq93SO_wFTxB9t-RM-wtr13r-JfAQq7fGBgkA7JpoRMUVdLmkYCxK7s-rlQBU3DuCred6gOsQRE6FzSFGryPEZYlzjjyrg1CnFQMkf1hARFPFBCPS_hC3dx-qZe_0TTnkKdGbb23-quPp5aRxEhH6BjKzpNPcdNOt1X3fi2TbOozh5MeyIO71yyVTQD-4gOIfqMGr3pe3ErkwEgf35l9MbT7iR6JswOa5pMgbGN3B0JpBksBGHFF8CxwWoUcCI1I72OuOcdzB2rEQl7wOakVOToWuljYS1rNpbjBdPu4G-ovKFEI8VDqhIwSipasezcd1oVat_W52Xkcuw743abNZER7h7wLSUe5j0sKtuP-RCLIog09d0giqJsC2UzJu3tofsF7tHZ4uVM1yewaVWAwrYeRGFzAFxHOtXbr9gwMO2NGuWdXDaI7slPxWskMWnumzeM3p-5yKVZMfqvoe2NWGuypXRAoPZiIxdxpw27u8';
const STORE_ID = '387550';
const VARIANT_ID = '1088262';

async function createCheckout() {
  try {
    const response = await axios.post('https://api.lemonsqueezy.com/v1/checkouts', {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: { email: 'test@example.com', custom: { user_email: 'test@example.com' } },
          product_options: { redirect_url: 'https://ba-kangombe.vercel.app/success' }
        },
        relationships: {
          store: { data: { type: 'stores', id: STORE_ID } },
          variant: { data: { type: 'variants', id: VARIANT_ID } }
        }
      }
    }, {
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Bearer ${LS_API_KEY}`
      }
    });
    console.log('Checkout URL:', response.data.data.attributes.url);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

createCheckout();