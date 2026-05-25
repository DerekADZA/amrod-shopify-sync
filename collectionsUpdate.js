import 'dotenv/config';
import axios from 'axios';

// ---- SLUGIFY FUNCTION ----
function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-+/g, '-');
}

// --- Setup
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}`;
const ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers: {
    'X-Shopify-Access-Token': ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

// ---- Fetch all Shopify collections using since_id paging ----
async function fetchAllCollections() {
  let collections = [];
  let since_id = 0;
  while (true) {
    const res = await shopifyClient.get(`/custom_collections.json?limit=250${since_id ? `&since_id=${since_id}` : ''}`);
    const batch = res.data.custom_collections;
    collections = collections.concat(batch);
    if (batch.length < 250) break;
    since_id = batch[batch.length - 1].id;
  }
  return collections.map(c => ({
    id: c.id,
    handle: c.handle,
    title: c.title
  }));
}

// ---- Fetch all Shopify products using since_id paging ----
async function fetchAllProducts() {
  let products = [];
  let since_id = 0;
  while (true) {
    const res = await shopifyClient.get(`/products.json?limit=250${since_id ? `&since_id=${since_id}` : ''}`);
    const batch = res.data.products;
    products = products.concat(batch);
    if (batch.length < 250) break;
    since_id = batch[batch.length - 1].id;
  }
  return products;
}

// ---- Fetch all collects for a product (i.e. its collection membership) ----
async function fetchCollectsForProduct(productId) {
  let collects = [];
  let page_info = null;
  while (true) {
    const url = `/collects.json?limit=250&product_id=${productId}${page_info ? `&page_info=${page_info}` : ''}`;
    const res = await shopifyClient.get(url);
    const batch = res.data.collects;
    collects = collects.concat(batch);
    if (batch.length < 250) break;
    // Shopify REST API for collects doesn't support since_id, so normally just one page.
    // If using GraphQL, would be a different approach.
    break;
  }
  return collects;
}

// ---- Add product to collection ----
async function addProductToCollection(productId, collectionId) {
  try {
    await shopifyClient.post('/collects.json', {
      collect: {
        product_id: productId,
        collection_id: collectionId
      }
    });
    console.log(`✅ Added product ${productId} to collection ${collectionId}`);
  } catch (err) {
    if (err.response && err.response.data && err.response.data.errors && err.response.data.errors.collect && err.response.data.errors.collect[0] === 'The product is already in the collection') {
      // already in collection, ignore
    } else {
      console.warn(`❌ Failed to add product ${productId} to collection ${collectionId}:`, err.response?.data || err.message);
    }
  }
}

// ---- Remove product from collection ----
async function removeProductFromCollection(collectId) {
  try {
    await shopifyClient.delete(`/collects/${collectId}.json`);
    console.log(`❌ Removed collect ${collectId}`);
  } catch (err) {
    console.warn(`❌ Failed to remove collect ${collectId}:`, err.response?.data || err.message);
  }
}

// ---- Main sync logic ----
(async () => {
  // 1. Authenticate with Amrod and fetch product data
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  const amrodAuthRes = await axios.post(AMROD_AUTH_URL, {
    UserName: AMROD_EMAIL,
    Password: AMROD_PASSWORD,
    CustomerCode: AMROD_CUSTOMER_CODE
  });
  const amrodToken = amrodAuthRes.data.token || amrodAuthRes.data.access_token;

  const amrodRes = await axios.get(`${AMROD_BASE_URL}/Products/GetProductsAndBranding`, {
    headers: { Authorization: `Bearer ${amrodToken}` }
  });
  const amrodProducts = Array.isArray(amrodRes.data) ? amrodRes.data : amrodRes.data.Products || [];

  // 2. Fetch all Shopify collections and products
  const collections = await fetchAllCollections();
  const products = await fetchAllProducts();
  const collectionHandleMap = new Map(collections.map(c => [c.handle, c]));

  // 3. Build a product handle -> product object map
  const shopifyHandleMap = new Map();
  for (const p of products) {
    shopifyHandleMap.set(p.handle, p);
  }

  // 4. For each Amrod product, set collections
  for (const product of amrodProducts) {
    const handle = slugify(product.productName || product.description || product.simpleCode || product.simplecode);
    const shopifyProduct = shopifyHandleMap.get(handle);
    if (!shopifyProduct) {
      console.log(`❌ Product not found in Shopify: ${handle}`);
      continue;
    }

    // --- Extract source collections from Amrod product ---
    // *Assumes* product.categories is an array of objects, each with .name or .path; adjust if needed
    let sourceHandles = [];
    if (Array.isArray(product.categories)) {
      for (const cat of product.categories) {
        if (cat.path) {
          const segments = cat.path.split('/').map(s => slugify(s.trim())).filter(Boolean);
          sourceHandles = sourceHandles.concat(segments);
        }
      }
    }
    // Only keep unique handles that match a real collection in Shopify
    sourceHandles = Array.from(new Set(sourceHandles.filter(h => collectionHandleMap.has(h))));

    // --- Get existing collections (collects) for product
    const collects = await fetchCollectsForProduct(shopifyProduct.id);
    const currentCollectionIds = collects.map(c => c.collection_id);

    // --- Calculate collections to add and remove
    const desiredCollectionIds = sourceHandles.map(h => collectionHandleMap.get(h).id);
    const addIds = desiredCollectionIds.filter(id => !currentCollectionIds.includes(id));
    const removeCollects = collects.filter(c => !desiredCollectionIds.includes(c.collection_id));

    // --- Add missing collections
    for (const colId of addIds) {
      await addProductToCollection(shopifyProduct.id, colId);
      await new Promise(r => setTimeout(r, 200));
    }

    // --- Remove extra collections
    for (const c of removeCollects) {
      await removeProductFromCollection(c.id);
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Synced collections for: ${handle} | Now in ${desiredCollectionIds.length} collections`);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n🎉 Product collections sync complete');
})();
