// show-amrod-variant-structure.js
// Show how Amrod structures variants and their fullCodes
import 'dotenv/config';
import fetch from 'node-fetch';

const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;

async function getAmrodToken() {
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
  const token = await getAmrodToken();

  console.log('📦 Fetching Amrod products...');
  const response = await fetch('https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  const products = await response.json();

  // Find a product with variants and color images
  const testProduct = products.find(p =>
    p.simpleCode === 'IDEA-61000' ||
    (p.variants && p.variants.length > 0 && p.colourImages && p.colourImages.length > 0)
  );

  if (!testProduct) {
    console.log('No suitable test product found');
    return;
  }

  console.log(`\n📦 Product: ${testProduct.productName || testProduct.name || 'N/A'}`);
  console.log(`   simpleCode: ${testProduct.simpleCode}`);
  console.log(`   fullCode: ${testProduct.fullCode}`);
  console.log(`   Variants: ${testProduct.variants?.length || 0}`);
  console.log(`   Color Groups: ${testProduct.colourImages?.length || 0}`);

  console.log(`\n🎨 Color Images:`);
  for (const colorGroup of (testProduct.colourImages || []).slice(0, 3)) {
    console.log(`   • ${colorGroup.name} (${colorGroup.code}) - ${colorGroup.images?.length || 0} images`);
  }

  console.log(`\n📋 Variants (first 5):`);
  for (const variant of (testProduct.variants || []).slice(0, 5)) {
    console.log(`\n   Variant:`);
    console.log(`     fullCode: ${variant.fullCode}`);
    console.log(`     colour: ${variant.colour}`);
    console.log(`     colourCode: ${variant.colourCode}`);
    console.log(`     size: ${variant.size || 'N/A'}`);
  }

  console.log(`\n\n💡 KEY INSIGHT:`);
  console.log(`   Product simpleCode: ${testProduct.simpleCode}`);
  console.log(`   Variant fullCode format: ${testProduct.variants?.[0]?.fullCode || 'N/A'}`);
  console.log(`   \n   sync-v2.js uses variant.fullCode as Shopify SKU`);
  console.log(`   So to match: compare Shopify SKU directly to Amrod variant.fullCode!`);
}

main().catch(console.error);
