// collections-sync.js - Sync Amrod Categories to Shopify Collections
// Version: 1.0

import 'dotenv/config';
import fetch from 'node-fetch';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

//
// ——— CONFIG & ENV CHECK ———
//
const {
  SHOPIFY_STORE_URL,
  SHOPIFY_ADMIN_API_TOKEN,
  SHOPIFY_API_VERSION,
  AMROD_EMAIL,
  AMROD_PASSWORD,
  AMROD_CUSTOMER_CODE
} = process.env;

if (!SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_API_VERSION) {
  console.error('❌ Missing Shopify credentials in .env');
  process.exit(1);
}
if (!AMROD_EMAIL || !AMROD_PASSWORD || !AMROD_CUSTOMER_CODE) {
  console.error('❌ Missing Amrod credentials in .env');
  process.exit(1);
}

const SHOPIFY_BASE   = `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/${SHOPIFY_API_VERSION}`;
const AMROD_BASE     = 'https://vendorapi.amrod.co.za/api/v1';
const DRY_RUN        = process.env.DRY_RUN === 'true';
const TEST_LIMIT     = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;

// Log paths
const LOG_DIR = path.resolve('logs');
const LOGS = {
  ACTIONS: path.join(LOG_DIR, 'collections-sync-actions.log'),
  ERRORS: path.join(LOG_DIR, 'collections-sync-errors.log'),
  SUMMARY: path.join(LOG_DIR, 'collections-sync-summary.json')
};

// Runtime stats
const STATS = {
  total: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  productsAssigned: 0,
  startTime: Date.now()
};

//
// ——— LOGGING SYSTEM ———
//
function ensureLogDirectories() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function logToFile(filePath, entry) {
  const timestamp = new Date().toISOString();
  const logEntry = typeof entry === 'object'
    ? `[${timestamp}] ${JSON.stringify(entry)}\n`
    : `[${timestamp}] ${entry}\n`;

  fs.appendFileSync(filePath, logEntry);
}

const log = {
  action: (data) => {
    logToFile(LOGS.ACTIONS, {
      ...data,
      timestamp: new Date().toISOString()
    });
  },

  error: (name, error, context = {}) => {
    logToFile(LOGS.ERRORS, {
      timestamp: new Date().toISOString(),
      action: 'syncError',
      name,
      error: error.message || error,
      context,
      stack: error.stack
    });
  }
};

//
// ——— HELPER FUNCTIONS ———
//
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s/-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'missing-handle';
}

function collectImageURLs(obj, set, visited = new Set()) {
  if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
  visited.add(obj);

  for (const val of Object.values(obj)) {
    if (
      typeof val === 'string' &&
      val.includes('http') &&
      val.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/i) &&
      !val.includes('_default_upload_bucket')
    ) {
      set.add(encodeURI(val.replace(/\u00A0/g, ' ')));
    } else if (typeof val === 'object') {
      collectImageURLs(val, set, visited);
    }
  }
}

//
// ——— AMROD AUTH & FETCH ———
//
async function getAmrodToken() {
  const res = await fetch('https://identity.amrod.co.za/VendorLogin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName:     AMROD_EMAIL,
      Password:     AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Amrod auth failed: ${res.status} — ${err}`);
  }
  const body = await res.json();
  return body.token || body.access_token;
}

async function fetchAmrodCategories() {
  const token = await getAmrodToken();
  const url   = `${AMROD_BASE}/Categories/`;
  console.log(`🔍 Fetching Amrod categories from ${url}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
      'Content-Type':'application/json'
    },
    timeout: 120_000
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Amrod categories fetch failed: ${res.status} — ${body}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Expected array, got ${typeof data}`);
  console.log(`✅ Retrieved ${data.length} categories`);
  return data;
}

async function fetchAmrodProducts() {
  const token = await getAmrodToken();
  const url   = `${AMROD_BASE}/Products/GetProductsAndBranding`;
  console.log(`🔍 Fetching Amrod products for category images...`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
      'Content-Type':'application/json'
    },
    timeout: 120_000
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Amrod products fetch failed: ${res.status} — ${body}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Expected array, got ${typeof data}`);
  console.log(`✅ Retrieved ${data.length} products`);
  return data;
}

//
// ——— SHOPIFY EXISTING LOOKUPS ———
//
async function fetchExistingCollections() {
  console.log('🔍 Loading existing Shopify collections...');
  const handleMap = new Map();

  let pageInfo = null;
  const params = new URLSearchParams({ limit: '250' });

  do {
    const url = new URL(`${SHOPIFY_BASE}/custom_collections.json`);
    url.search = params.toString();
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }
    });
    if (!res.ok) throw new Error(`Failed fetching collections: ${res.status}`);
    const { custom_collections } = await res.json();

    for (const c of custom_collections) {
      handleMap.set(c.handle, {
        id: c.id,
        title: c.title,
        image: c.image,
        body_html: c.body_html
      });
    }

    const link = res.headers.get('link');
    const m = link?.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/);
    pageInfo = m?.[1] || null;
    if (pageInfo) params.set('page_info', pageInfo);
  } while (pageInfo);

  console.log(`  • Loaded ${handleMap.size} existing collections`);
  return handleMap;
}

async function fetchShopifyProducts() {
  console.log('🔍 Loading Shopify products for collection assignment...');
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
              tags
            }
          }
        }
      }
    `;

    const variables = cursor ? { cursor } : {};

    await new Promise(resolve => setTimeout(resolve, 300));

    const res = await fetch(`${SHOPIFY_BASE.replace('/admin/api/', '/admin/api/')}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    if (!res.ok) throw new Error(`Failed fetching products: ${res.status}`);

    const { data, errors } = await res.json();
    if (errors) throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);

    products.push(...data.products.edges.map(e => e.node));

    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  console.log(`  • Loaded ${products.length} products with tags`);
  return products;
}

//
// ——— BUILD CATEGORY MAP FROM PRODUCTS ———
//
function buildCategoryMap(products) {
  const categoryMap = new Map(); // name → { parent, image }

  for (const product of products) {
    const images = new Set();
    [product.Images, product.colourImages, product.BrandingImages, product.components].forEach(source => {
      if (Array.isArray(source)) source.forEach(obj => collectImageURLs(obj, images, new Set()));
      else if (typeof source === 'object') collectImageURLs(source, images, new Set());
    });
    collectImageURLs(product, images, new Set());

    const imageArr = Array.from(images);
    const image = imageArr.length > 0 ? imageArr[0] : null;

    if (Array.isArray(product.categories)) {
      for (const cat of product.categories) {
        const segments = cat?.path?.split('/')?.map(s => s.trim()).filter(Boolean) || [];
        for (let i = 0; i < segments.length; i++) {
          const name = segments[i];
          const parent = i > 0 ? segments[i - 1] : null;
          if (!categoryMap.has(name)) {
            categoryMap.set(name, { parent, image });
          }
        }
      }
    }
  }

  return categoryMap;
}

//
// ——— BUILD TAG → PRODUCT IDS MAP ———
//
function buildTagToProductMap(shopifyProducts) {
  console.log('🔍 Building category tag → product IDs map...');
  const tagMap = new Map(); // lowercase tag → array of product IDs

  for (const product of shopifyProducts) {
    const tags = Array.isArray(product.tags) ? product.tags : [];
    for (const tag of tags) {
      const lowerTag = tag.toLowerCase().trim();
      if (!tagMap.has(lowerTag)) {
        tagMap.set(lowerTag, []);
      }
      tagMap.get(lowerTag).push(product.id);
    }
  }

  console.log(`  • Built map with ${tagMap.size} unique tags`);
  return tagMap;
}

//
// ——— COLLECTION UPSERT (REST API) ———
//
async function upsertCollection(name, meta, existingCollections) {
  const handle = slugify(name);
  const existing = existingCollections.get(handle);

  if (DRY_RUN) {
    if (existing) {
      console.log(`[DRY RUN] Would update collection: "${name}" (Handle: ${handle})`);
      log.action({ action: 'dryRunUpdate', name, handle });
    } else {
      console.log(`[DRY RUN] Would create collection: "${name}" (Handle: ${handle})`);
      log.action({ action: 'dryRunCreate', name, handle });
    }
    return { id: 'dry-run', created: !existing };
  }

  try {
    if (existing) {
      // Update existing collection
      const updates = {};
      if (!existing.image && meta.image) updates.image = { src: meta.image };
      if (!existing.body_html) updates.body_html = `Products related to ${name}`;

      if (Object.keys(updates).length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetch(`${SHOPIFY_BASE}/custom_collections/${existing.id}.json`, {
          method: 'PUT',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ custom_collection: { id: existing.id, ...updates } })
        });
        console.log(`✅ UPDATED: "${name}" (Handle: ${handle})`);
        log.action({ action: 'updateCollection', name, handle, id: existing.id });
        STATS.updated++;
      } else {
        console.log(`⏭️  SKIP: "${name}" already up to date`);
        STATS.skipped++;
      }

      return { id: existing.id, created: false };
    } else {
      // Create new collection
      const collectionData = {
        title: name,
        handle: handle,
        published: true,
        body_html: `Products related to ${name}`
      };
      if (meta.image) {
        collectionData.image = { src: meta.image };
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      const res = await fetch(`${SHOPIFY_BASE}/custom_collections.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ custom_collection: collectionData })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(`Failed to create collection: ${JSON.stringify(errorData)}`);
      }

      const { custom_collection } = await res.json();
      console.log(`✅ CREATED: "${name}" (Handle: ${handle})`);
      log.action({ action: 'createCollection', name, handle, id: custom_collection.id });
      STATS.created++;

      return { id: custom_collection.id, created: true };
    }
  } catch (err) {
    console.log(`❌ ERROR: "${name}" - ${err.message}`);
    log.error(name, err, { handle, hasImage: !!meta.image });
    STATS.failed++;
    return null;
  }
}

//
// ——— SET BREADCRUMB METAFIELD ———
//
async function setBreadcrumbMetafield(collectionId, parentName) {
  if (!collectionId || !parentName || DRY_RUN) return;

  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    await fetch(`${SHOPIFY_BASE}/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        metafield: {
          namespace: 'breadcrumbs',
          key: 'parent',
          value: parentName,
          type: 'single_line_text_field',
          owner_id: collectionId,
          owner_resource: 'collection'
        }
      })
    });
    console.log(`🔗 Set breadcrumb parent: "${parentName}" for collection ID: ${collectionId}`);
  } catch (err) {
    console.log(`⚠️  Failed to set breadcrumb metafield: ${err.message}`);
  }
}

//
// ——— ASSIGN PRODUCTS TO COLLECTION ———
//
async function assignProductsToCollection(collectionName, collectionId, tagMap) {
  // Match products by category tag (case-insensitive exact match)
  const lowerName = collectionName.toLowerCase().trim();
  const productIds = tagMap.get(lowerName) || [];

  if (productIds.length === 0) {
    console.log(`  ℹ️  No products found with tag "${collectionName}"`);
    return 0;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would assign ${productIds.length} products to collection "${collectionName}"`);
    return productIds.length;
  }

  try {
    // Convert REST ID to GraphQL ID format
    const graphqlCollectionId = `gid://shopify/Collection/${collectionId}`;

    // Batch products (max 250 per mutation)
    const batches = [];
    for (let i = 0; i < productIds.length; i += 250) {
      batches.push(productIds.slice(i, i + 250));
    }

    let totalAssigned = 0;
    let totalSkipped = 0;

    for (const batch of batches) {
      const mutation = `
        mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
          collectionAddProducts(id: $id, productIds: $productIds) {
            collection {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        id: graphqlCollectionId,
        productIds: batch
      };

      await new Promise(resolve => setTimeout(resolve, 500));

      const res = await fetch(`${SHOPIFY_BASE.replace('/admin/api/', '/admin/api/')}/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: mutation, variables })
      });

      if (!res.ok) {
        throw new Error(`GraphQL request failed: ${res.status}`);
      }

      const { data, errors } = await res.json();

      if (errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
      }

      // Check for user errors - if products are already in collection, just skip them
      if (data.collectionAddProducts.userErrors.length > 0) {
        const errorMsg = data.collectionAddProducts.userErrors[0].message || '';

        // If error is about products already in collection, that's OK - skip silently
        if (errorMsg.includes('Error adding') || errorMsg.includes('already')) {
          totalSkipped += batch.length;
          continue;
        }

        // Otherwise it's a real error
        throw new Error(`User errors: ${JSON.stringify(data.collectionAddProducts.userErrors)}`);
      }

      totalAssigned += batch.length;
    }

    if (totalAssigned > 0) {
      console.log(`  📦 Assigned ${totalAssigned} products to collection "${collectionName}"`);
    }
    if (totalSkipped > 0) {
      console.log(`  ↩️  Skipped ${totalSkipped} products (already in collection)`);
    }

    log.action({
      action: 'assignProducts',
      collectionName,
      collectionId,
      productsAssigned: totalAssigned,
      productsSkipped: totalSkipped
    });

    STATS.productsAssigned += totalAssigned;
    return totalAssigned;

  } catch (err) {
    console.log(`  ⚠️  Failed to assign products: ${err.message}`);
    log.error(collectionName, err, { action: 'assignProducts', collectionId });
    return 0;
  }
}

//
// ——— GENERATE SUMMARY REPORT ———
//
function generateSummaryReport() {
  const duration = Date.now() - STATS.startTime;
  const durationMin = Math.floor(duration / 60000);
  const durationSec = Math.floor((duration % 60000) / 1000);

  const summary = {
    syncDate: new Date().toISOString(),
    duration: `${durationMin}m ${durationSec}s`,
    stats: {
      total: STATS.total,
      created: STATS.created,
      updated: STATS.updated,
      skipped: STATS.skipped,
      failed: STATS.failed,
      productsAssigned: STATS.productsAssigned
    },
    dryRun: DRY_RUN
  };

  fs.writeFileSync(LOGS.SUMMARY, JSON.stringify(summary, null, 2));

  // Console summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎯 COLLECTIONS SYNC RESULTS:');
  console.log(`   ✅ Successful: ${STATS.created + STATS.updated}`);
  console.log(`   🆕 Created: ${STATS.created}`);
  console.log(`   🔄 Updated: ${STATS.updated}`);
  console.log(`   ❌ Failed: ${STATS.failed}`);
  console.log(`   ⏭️  Skipped: ${STATS.skipped}`);
  console.log(`   📦 Products Assigned: ${STATS.productsAssigned}`);
  console.log(`   📊 Total Processed: ${STATS.total}`);

  const successRate = STATS.total > 0
    ? Math.round(((STATS.created + STATS.updated) / STATS.total) * 100)
    : 0;
  console.log(`\n🎯 Success Rate: ${successRate}%`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY_RUN was ENABLED - No actual changes were made to Shopify');
  } else {
    console.log('\n✅ SYNC COMPLETED - Changes have been made to Shopify');
  }

  console.log(`\n📄 Detailed logs:`);
  console.log(`   • Actions: ${LOGS.ACTIONS}`);
  console.log(`   • Errors: ${LOGS.ERRORS}`);
  console.log(`   • Summary: ${LOGS.SUMMARY}`);
  console.log(`${'='.repeat(80)}\n`);
}

//
// ——— MAIN RUNNER ———
//
(async () => {
  try {
    console.log('🚀 Starting Amrod Categories → Shopify Collections Sync...\n');

    ensureLogDirectories();

    // Fetch Shopify data first (doesn't require Amrod auth)
    const existingCollections = await fetchExistingCollections();

    // Fetch Amrod products (requires auth - do sequentially to avoid auth conflicts)
    const products = await fetchAmrodProducts();

    // Fetch Shopify products for tag mapping (needed for product assignment)
    const shopifyProducts = await fetchShopifyProducts();
    const tagMap = buildTagToProductMap(shopifyProducts);

    // Build category map from products
    const categoryMap = buildCategoryMap(products);
    const allCategories = Array.from(categoryMap.entries());

    // Apply test limit if set
    const categoriesToProcess = TEST_LIMIT
      ? allCategories.slice(0, TEST_LIMIT)
      : allCategories;
    STATS.total = categoriesToProcess.length;

    console.log(`\n📋 SYNC SUMMARY:`);
    console.log(`   • Total categories found: ${allCategories.length}`);
    if (TEST_LIMIT) {
      console.log(`   • 🧪 TEST MODE: Processing only ${TEST_LIMIT} categories`);
    }
    console.log(`   • Categories to process: ${categoriesToProcess.length}`);
    console.log(`   • Existing collections: ${existingCollections.size}`);
    console.log(`   • Shopify products loaded: ${shopifyProducts.length}`);
    console.log(`   • DRY RUN: ${DRY_RUN ? '✅ ENABLED (no changes will be made)' : '❌ DISABLED (changes will be made)'}`);
    console.log(`\n${'='.repeat(80)}`);
    console.log('🏃 PROCESSING CATEGORIES:\n');

    let processed = 0;

    for (const [name, meta] of categoriesToProcess) {
      console.log(`\n[${processed + 1}/${categoriesToProcess.length}] Processing: "${name}"`);

      const result = await upsertCollection(name, meta, existingCollections);

      if (result && result.id) {
        // Set breadcrumb metafield if collection has parent
        if (meta.parent) {
          await setBreadcrumbMetafield(result.id, meta.parent);
        }

        // Assign products to collection based on category tag
        await assignProductsToCollection(name, result.id, tagMap);
      }

      processed++;

      // Progress update every 10 categories
      if (processed % 10 === 0 || processed === categoriesToProcess.length) {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📊 Progress: ${processed}/${categoriesToProcess.length} (${Math.round((processed / categoriesToProcess.length) * 100)}%) - ✅${STATS.created + STATS.updated} ❌${STATS.failed} ⏭️${STATS.skipped} 📦${STATS.productsAssigned}`);
        console.log(`${'─'.repeat(50)}`);
      }

      // Batch delay (5 items every second)
      if (processed % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    generateSummaryReport();

  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
    console.error('Stack trace:', err.stack);
    log.error('FATAL', err, { fatal: true });
  }
})();
