// find-missing-products.js - Find products that need to be created
import 'dotenv/config';
import fetch from 'node-fetch';

const { SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN, AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;

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

async function fetchAmrodProducts() {
  const token = await getAmrodToken();
  const url = 'https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding';
  console.log('Fetching Amrod products...');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 120000
  });
  const data = await res.json();
  return Array.isArray(data) ? data : data.items || [];
}

async function fetchShopifyProducts() {
  console.log('Fetching Shopify products...');
  const url = `${SHOPIFY_STORE_URL}/admin/api/2025-07/products.json?limit=250&fields=id,variants`;
  let allProducts = [];
  let nextUrl = url;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
      }
    });
    const data = await res.json();
    allProducts = allProducts.concat(data.products || []);

    // Check for pagination
    const linkHeader = res.headers.get('link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = match ? match[1] : null;
    } else {
      nextUrl = null;
    }
  }

  return allProducts;
}

(async () => {
  const [amrodProducts, shopifyProducts] = await Promise.all([
    fetchAmrodProducts(),
    fetchShopifyProducts()
  ]);

  console.log(`Amrod products: ${amrodProducts.length}`);
  console.log(`Shopify products: ${shopifyProducts.length}`);

  // Build Shopify SKU set
  const shopifySkus = new Set();
  for (const product of shopifyProducts) {
    for (const variant of product.variants || []) {
      if (variant.sku) {
        shopifySkus.add(variant.sku.toUpperCase());
      }
    }
  }

  console.log(`Shopify SKUs: ${shopifySkus.size}`);

  // Find missing products
  const missing = [];
  for (const amrodProduct of amrodProducts) {
    const variants = amrodProduct.variants || [];
    if (variants.length === 0) continue;

    const primarySku = variants[0].fullCode;
    if (!primarySku) continue;

    if (!shopifySkus.has(primarySku.toUpperCase())) {
      missing.push({
        sku: primarySku,
        title: amrodProduct.productName,
        variantCount: variants.length
      });
    }
  }

  console.log(`\nMissing products: ${missing.length}\n`);
  console.log('First 20 missing products:');
  missing.slice(0, 20).forEach((p, i) => {
    console.log(`${i + 1}. ${p.sku} - ${p.title} (${p.variantCount} variants)`);
  });

  // Find which index these are at in the Amrod products array
  if (missing.length > 0) {
    const firstMissingSku = missing[0].sku;
    const index = amrodProducts.findIndex(p => p.variants?.[0]?.fullCode === firstMissingSku);
    console.log(`\nFirst missing product is at index: ${index}`);
    console.log(`Use: export START_FROM_INDEX=${index}`);
  }
})();
