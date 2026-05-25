import 'dotenv/config';
import axios from 'axios';

// Config
const AMROD_AUTH_URL   = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL   = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}`;
const PRICE_MARKUP     = 1.43;
const SLEEP_MS         = 200;

// HTTP clients
const amrodClient = axios.create({
  baseURL: AMROD_BASE_URL,
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
});
const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 60000
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Amrod token
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

// Amrod prices
async function fetchPrices(token) {
  const endpoints = ['/Prices', '/Prices/'];
  let res = null;
  for (const ep of endpoints) {
    try {
      res = await amrodClient.get(ep, {
        headers: { Authorization: `Bearer ${token}` }
      });
      break;
    } catch (err) {
      if (err.response?.status === 404) continue;
      else throw err;
    }
  }
  if (!res) {
    console.error('❌ Unable to fetch prices');
    return [];
  }
  return Array.isArray(res.data) ? res.data : res.data.Prices || [];
}

// Fetch Shopify products page by page
async function* shopifyProductGenerator() {
  let lastId = null;
  let page = 0;
  while (true) {
    const params = { limit: 50 };
    if (lastId) params.since_id = lastId;
    let res;
    try {
      res = await shopifyClient.get('/products.json', { params });
    } catch (err) {
      console.error('❌ Failed to fetch products page:', err.response?.data || err.message);
      return;
    }
    const products = res.data.products || [];
    if (!products.length) break;
    yield products;
    lastId = products[products.length - 1].id;
    page++;
    await sleep(SLEEP_MS);
  }
}

(async () => {
  console.log('▶ Starting price/cost sync');

  // 1. Get Amrod cost data, build costMap
  const token = await getAmrodToken();
  const amrodPrices = await fetchPrices(token);
  const costMap = new Map();
  amrodPrices.forEach(p => {
    const sku = (p.fullCode || p.FullCode || '').toLowerCase();
    if (sku) costMap.set(sku, parseFloat(p.price) || 0);
  });

  let totalProducts = 0, totalVariants = 0, updated = 0, skipped = 0, errors = 0;
  let startTime = Date.now();

  // 2. Process Shopify products page by page
  for await (const products of shopifyProductGenerator()) {
    for (const prod of products) {
      totalProducts++;
      console.log(`\n--- Product #${totalProducts}: "${prod.title}" (id=${prod.id}) ---`);

      if (!prod.variants || !prod.variants.length) {
        console.log('  No variants, skipping.');
        skipped++;
        continue;
      }

      for (const variant of prod.variants) {
        totalVariants++;
        const sku = (variant.sku || '').toLowerCase();
        if (!sku) {
          console.log(`  [${variant.id}] Variant has no SKU, skipping`);
          skipped++;
          continue;
        }
        const amrodCost = costMap.get(sku);
        if (!amrodCost || isNaN(amrodCost) || amrodCost === 0) {
          console.log(`  [${variant.id}] SKU=${sku} | No cost found, skipping`);
          skipped++;
          continue;
        }
        const sellingPrice = (amrodCost * PRICE_MARKUP).toFixed(2);
        process.stdout.write(`  [${variant.id}] SKU=${sku} | Cost: ${amrodCost} | Price: ${sellingPrice} ... `);

        // Update price
        let priceOK = false;
        try {
          await shopifyClient.put(`/variants/${variant.id}.json`, {
            variant: { id: variant.id, price: sellingPrice }
          });
          priceOK = true;
        } catch (err) {
          console.log('❌ price update failed');
          console.error(`    Price update error: ${err.response?.data?.errors || err.message}`);
          errors++;
        }

        // Update cost
        let costOK = false;
        try {
          await shopifyClient.put(`/inventory_items/${variant.inventory_item_id}.json`, {
            inventory_item: { id: variant.inventory_item_id, cost: amrodCost }
          });
          costOK = true;
        } catch (err) {
          console.log('❌ cost update failed');
          console.error(`    Cost update error: ${err.response?.data?.errors || err.message}`);
          errors++;
        }

        if (priceOK && costOK) {
          console.log('✅ updated');
          updated++;
        } else {
          skipped++;
        }
        await sleep(SLEEP_MS);
      }
    }
    const now = Date.now();
    const elapsed = ((now - startTime) / 1000).toFixed(1);
    console.log(`\n--- Processed ${totalProducts} products (${totalVariants} variants) so far in ${elapsed} sec ---`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 Price+Cost sync done. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}, Time: ${totalTime}s`);
})();
