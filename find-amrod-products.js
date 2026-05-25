// find-amrod-products.js
// Find products that actually match Amrod format
import 'dotenv/config';
import fetch from 'node-fetch';

const {
  SHOPIFY_STORE_URL,
  SHOPIFY_ADMIN_API_TOKEN,
  SHOPIFY_API_VERSION,
  AMROD_EMAIL,
  AMROD_PASSWORD,
  AMROD_CUSTOMER_CODE
} = process.env;

const SHOPIFY_BASE = `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/${SHOPIFY_API_VERSION}`;

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

async function fetchAllShopifyProducts() {
  console.log('📦 Fetching ALL Shopify products...');

  const products = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query ($cursor: String) {
        products(first: 250, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              variants(first: 5) {
                edges {
                  node {
                    sku
                    image { id }
                  }
                }
              }
            }
          }
        }
      }
    `;

    await new Promise(resolve => setTimeout(resolve, 300));

    const res = await fetch(`${SHOPIFY_BASE}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables: cursor ? { cursor } : {} })
    });

    const { data } = await res.json();
    products.push(...data.products.edges.map(e => e.node));
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return products;
}

async function fetchAmrodProducts() {
  console.log('📦 Fetching Amrod products...');
  const token = await getAmrodAuthToken();

  const response = await fetch('https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  return await response.json();
}

async function main() {
  const shopifyProducts = await fetchAllShopifyProducts();
  const amrodProducts = await fetchAmrodProducts();

  console.log(`\n✅ ${shopifyProducts.length} Shopify products`);
  console.log(`✅ ${amrodProducts.length} Amrod products`);

  // Build Amrod map by simpleCode
  const amrodMap = new Map();
  for (const ap of amrodProducts) {
    if (ap.simpleCode) {
      amrodMap.set(ap.simpleCode.toLowerCase(), ap);
    }
  }

  // Categorize Shopify products
  const numericSKUs = [];
  const alphanumericSKUs = [];
  const noSKU = [];

  for (const sp of shopifyProducts) {
    const sku = sp.variants?.edges?.[0]?.node?.sku?.trim();

    if (!sku) {
      noSKU.push(sp);
      continue;
    }

    // Extract base SKU (before first dash)
    const baseSKU = sku.split('-')[0].trim();

    if (/^\d+$/.test(baseSKU)) {
      numericSKUs.push({ product: sp, sku, baseSKU });
    } else if (/[A-Z]/.test(baseSKU)) {
      alphanumericSKUs.push({ product: sp, sku, baseSKU });
    }
  }

  console.log(`\n📊 SKU Categorization:`);
  console.log(`   • Numeric SKUs (like 246531-Black-XS): ${numericSKUs.length}`);
  console.log(`   • Alphanumeric SKUs (like BC-HP-4-G-BL): ${alphanumericSKUs.length}`);
  console.log(`   • No SKU: ${noSKU.length}`);

  // Check alphanumeric matches
  console.log(`\n🔍 Checking alphanumeric SKUs against Amrod...`);

  let matched = 0;
  let matchedWithColors = 0;
  let needImages = 0;

  for (const { product, sku, baseSKU } of alphanumericSKUs.slice(0, 50)) {
    const amrodProduct = amrodMap.get(baseSKU.toLowerCase());

    if (amrodProduct) {
      matched++;
      const hasColors = amrodProduct.colourImages && amrodProduct.colourImages.length > 0;
      if (hasColors) matchedWithColors++;

      const variantsNeedingImages = product.variants.edges.filter(v => !v.node.image?.id).length;
      if (variantsNeedingImages > 0) needImages++;

      console.log(`\n✅ "${product.title}"`);
      console.log(`   Shopify SKU: ${sku}`);
      console.log(`   Base SKU: ${baseSKU}`);
      console.log(`   Amrod: ${amrodProduct.simpleCode}`);
      console.log(`   Color Images: ${hasColors ? `${amrodProduct.colourImages.length} groups` : 'None'}`);
      console.log(`   Variants needing images: ${variantsNeedingImages}`);
    }
  }

  console.log(`\n\n═══════════════════════════════════════`);
  console.log(`RESULTS (first 50 alphanumeric products):`);
  console.log(`  ✅ Matched to Amrod: ${matched}`);
  console.log(`  🎨 With color images: ${matchedWithColors}`);
  console.log(`  🖼️  Products with variants needing images: ${needImages}`);
}

main().catch(console.error);
