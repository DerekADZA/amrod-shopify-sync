import 'dotenv/config';
import axios from 'axios';

const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';

// Get Amrod auth token
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

// Fetch products from the correct Amrod endpoint
async function fetchProducts(token) {
  const res = await axios.get(
    `${AMROD_BASE_URL}/Products/GetProductsAndBranding`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  // The API usually returns an array, or { Products: [...] }
  const data = Array.isArray(res.data) ? res.data : res.data.Products || [];
  return data;
}

(async () => {
  const token = await getAmrodToken();
  const products = await fetchProducts(token);
  console.log(`✅ ${products.length} products fetched`);
  const sample = products.slice(0, 3);
  sample.forEach((product, idx) => {
    console.log(`\n=== PRODUCT #${idx + 1} ===\n`);
    console.log(JSON.stringify(product, null, 2));
  });
})();
