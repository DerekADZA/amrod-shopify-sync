import 'dotenv/config';
import axios from 'axios';

// Config
const AMROD_AUTH_URL   = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL   = 'https://vendorapi.amrod.co.za';

// Create axios client
const amrodClient = axios.create({
  baseURL: AMROD_BASE_URL,
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  timeout: 60000
});

// Get Amrod token
async function getAmrodToken() {
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  if (!AMROD_EMAIL || !AMROD_PASSWORD || !AMROD_CUSTOMER_CODE) {
    console.error('❌ Missing Amrod credentials');
    process.exit(1);
  }
  try {
    const res = await axios.post(AMROD_AUTH_URL, {
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    });
    const token = res.data.token || res.data.access_token;
    if (!token) throw new Error('No token returned');
    console.log('✅ Amrod token received');
    return token;
  } catch (err) {
    console.error('❌ Amrod auth failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

// Test endpoints
async function testEndpoints(token) {
  const endpoints = [
    '/api/v1/Products/WithBranding',
    '/api/v1/ProductsWithBranding'
  ];
  for (const ep of endpoints) {
    try {
      console.log(`\n▶ Trying: ${ep}`);
      const res = await amrodClient.get(ep, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (Array.isArray(res.data) && res.data.length) {
        console.log(`✅ ${ep} - Got ${res.data.length} products`);
        console.log('Sample product:', JSON.stringify(res.data[0], null, 2));
      } else {
        console.log(`❌ ${ep} - No products returned`);
      }
    } catch (err) {
      console.error(`❌ ${ep} failed:`, err.response?.status, err.response?.data);
    }
  }
}

(async () => {
  const token = await getAmrodToken();
  await testEndpoints(token);
})();
