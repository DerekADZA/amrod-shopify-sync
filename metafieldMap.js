import 'dotenv/config';
import axios from 'axios';

const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`;

const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 60000
});

(async () => {
  try {
    const res = await shopifyClient.get('/metafield_definitions.json?owner_type=product');
    // Print all metafield definitions
    console.log(JSON.stringify(res.data.metafield_definitions, null, 2));
  } catch (err) {
    console.error('❌ Error fetching metafield definitions:', err.response?.data || err.message);
  }
})();
