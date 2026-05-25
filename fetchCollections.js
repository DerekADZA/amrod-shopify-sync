import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION;
const SHOPIFY_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/custom_collections.json`;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

async function fetchAllCollections() {
  let collections = [];
  let sinceId = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await axios.get(SHOPIFY_URL, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      params: {
        limit: 250,
        since_id: sinceId,
      },
    });

    const batch = res.data.custom_collections;
    if (batch.length === 0) {
      hasMore = false;
    } else {
      collections.push(...batch);
      sinceId = batch[batch.length - 1].id;
    }
  }

  return collections.map(col => ({
    title: col.title,
    handle: col.handle
  }));
}

(async () => {
  const allCollections = await fetchAllCollections();
  fs.writeFileSync('shopify_collections.json', JSON.stringify(allCollections, null, 2));
  console.log(`✅ Saved ${allCollections.length} collections to shopify_collections.json`);
})();
