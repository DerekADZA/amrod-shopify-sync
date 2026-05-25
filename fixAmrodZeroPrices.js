import 'dotenv/config'
import axios from 'axios'

const BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';
const ACCESS_KEY = process.env.AMROD_ACCESS_KEY; // put in your .env file

// You should already have your bearer token function from your previous code
const BEARER_TOKEN = 'YOUR_TOKEN_HERE'; // <-- replace with your actual token for testing

async function main() {
  try {
    // Step 1: Get products (first page)
    const productList = await axios.get(
      `${BASE_URL}/product/getall?pageindex=0&pagesize=5`,
      {
        headers: {
          'Authorization': `Bearer ${BEARER_TOKEN}`,
          'accesskey': ACCESS_KEY,
        },
      }
    );

    if (!productList.data.products || productList.data.products.length === 0) {
      console.log('No products returned');
      return;
    }
    console.log('Sample Products:', productList.data.products.map(p => ({
      id: p.productId,
      name: p.productName,
      sku: p.sku
    })));

    // Step 2: Get price for first product
    const firstProduct = productList.data.products[0];
    const priceRes = await axios.get(
      `${BASE_URL}/product/configurationandpricing/${firstProduct.productId}`,
      {
        headers: {
          'Authorization': `Bearer ${BEARER_TOKEN}`,
          'accesskey': ACCESS_KEY,
        },
      }
    );
    console.log('Price for first product:', priceRes.data);

  } catch (err) {
    if (err.response) {
      console.log('API error:', err.response.status, err.response.data);
    } else {
      console.log('Error:', err.message);
    }
  }
}

main();
