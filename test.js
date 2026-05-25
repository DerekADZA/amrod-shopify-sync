const axios = require('axios');
require('dotenv').config();

axios.get(`${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}/locations.json`, {
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN
  }
}).then(res => {
  console.log('Shopify Locations:', res.data.locations);
}).catch(err => {
  console.error('❌ Failed to fetch locations:', err.response?.data || err.message);
});
