// inspect-amrod-api-response.js
// Examine actual Amrod API response structure
import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs';

const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;

async function getAmrodAuthToken() {
  const response = await fetch('https://identity.amrod.co.za/VendorLogin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    })
  });
  const data = await response.json();
  return data.token;
}

async function main() {
  console.log('🔐 Authenticating...');
  const token = await getAmrodAuthToken();

  console.log('📦 Fetching Amrod products...');
  const response = await fetch('https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  const products = await response.json();
  console.log(`✅ Loaded ${products.length} products\n`);

  // Find products with colourImages
  const productsWithColorImages = products.filter(p => p.colourImages && p.colourImages.length > 0);

  console.log(`Found ${productsWithColorImages.length} products with colourImages\n`);

  // Show first 5 products with color images in detail
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('SAMPLE PRODUCTS WITH COLOR IMAGES:\n');

  for (const product of productsWithColorImages.slice(0, 5)) {
    console.log(`\n📦 ${product.name || 'N/A'}`);
    console.log(`   simpleCode: ${product.simpleCode}`);
    console.log(`   fullCode: ${product.fullCode}`);
    console.log(`   Color Groups: ${product.colourImages.length}`);

    for (const colorGroup of product.colourImages.slice(0, 2)) {
      console.log(`\n   🎨 Color: ${colorGroup.name || 'N/A'} (code: ${colorGroup.code || 'N/A'})`);
      console.log(`      Images in group: ${colorGroup.images?.length || 0}`);

      if (colorGroup.images && colorGroup.images.length > 0) {
        console.log(`      Structure of first image:`);
        console.log(JSON.stringify(colorGroup.images[0], null, 8));
      }
    }
  }

  // Save full sample to file
  fs.writeFileSync(
    'amrod-api-sample.json',
    JSON.stringify(productsWithColorImages.slice(0, 3), null, 2)
  );

  console.log(`\n\n✅ Saved 3 sample products to amrod-api-sample.json`);
}

main().catch(console.error);
