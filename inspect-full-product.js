// inspect-full-product.js - See what's actually in a product

import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs';

const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;

async function getAmrodToken() {
  const res = await fetch('https://identity.amrod.co.za/VendorLogin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    })
  });
  const body = await res.json();
  return body.token || body.access_token;
}

async function fetchAllAmrod() {
  const token = await getAmrodToken();
  const url   = 'https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding';
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type':'application/json'
    }
  });
  const data = await res.json();
  return data;
}

(async () => {
  console.log('Fetching full product data...\n');
  const products = await fetchAllAmrod();

  // Save full product to file for inspection
  const sampleProduct = products[100]; // Get a product that might have more data

  console.log('Sample product saved to amrod_product_full.json\n');
  fs.writeFileSync('amrod_product_full.json', JSON.stringify(sampleProduct, null, 2));

  console.log('=== PRODUCT STRUCTURE ===');
  console.log('Keys at top level:');
  console.log(Object.keys(sampleProduct));

  console.log('\n=== VARIANT STRUCTURE ===');
  if (sampleProduct.variants && sampleProduct.variants[0]) {
    console.log('Keys in variant:');
    console.log(Object.keys(sampleProduct.variants[0]));
  }

  console.log('\n Full product written to amrod_product_full.json');
  console.log('Check that file to see the complete structure');
})();
