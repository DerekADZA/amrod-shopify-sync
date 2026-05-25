// assign-products-to-collections.js
// Assign Products to Collections Based on Amrod API Categories
// Version: 1.0

import 'dotenv/config';
import fetch from 'node-fetch';
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

if (!SHOPIFY_STORE_URL) {
  console.error('❌ Missing SHOPIFY_STORE_URL in .env');
  process.exit(1);
}
if (!SHOPIFY_ADMIN_API_TOKEN) {
  console.error('❌ Missing SHOPIFY_ADMIN_API_TOKEN in .env');
  process.exit(1);
}
if (!SHOPIFY_API_VERSION) {
  console.error('❌ Missing SHOPIFY_API_VERSION in .env');
  process.exit(1);
}
if (!AMROD_EMAIL || !AMROD_PASSWORD || !AMROD_CUSTOMER_CODE) {
  console.error('❌ Missing one of AMROD_EMAIL, AMROD_PASSWORD, or AMROD_CUSTOMER_CODE in .env');
  process.exit(1);
}

const SHOPIFY_BASE = `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/${SHOPIFY_API_VERSION}`;
const DRY_RUN = process.env.DRY_RUN === 'true';

// Log paths
const LOG_DIR = path.resolve('logs');
const LOGS = {
  ACTIONS: path.join(LOG_DIR, 'product-collection-assignment-actions.log'),
  ERRORS: path.join(LOG_DIR, 'product-collection-assignment-errors.log'),
  SUMMARY: path.join(LOG_DIR, 'product-collection-assignment-summary.json')
};

// Runtime stats
const STATS = {
  totalProducts: 0,
  productsProcessed: 0,
  collectionsAssigned: 0,
  productsSkipped: 0,
  productsFailed: 0,
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

  error: (productCode, error, context = {}) => {
    logToFile(LOGS.ERRORS, {
      timestamp: new Date().toISOString(),
      productCode,
      error: error.message,
      stack: error.stack,
      ...context
    });
  },

  summary: () => {
    const duration = ((Date.now() - STATS.startTime) / 1000 / 60).toFixed(2);
    const summary = {
      timestamp: new Date().toISOString(),
      duration: `${duration} minutes`,
      mode: DRY_RUN ? 'DRY_RUN' : 'LIVE',
      stats: STATS
    };

    fs.writeFileSync(LOGS.SUMMARY, JSON.stringify(summary, null, 2));
    return summary;
  }
};

//
// ——— AMROD API - AUTHENTICATION ———
//
let AMROD_TOKEN = null;
let AMROD_TOKEN_EXPIRY = null;

async function getAmrodAuthToken() {
  // Return cached token if still valid
  if (AMROD_TOKEN && AMROD_TOKEN_EXPIRY && Date.now() < AMROD_TOKEN_EXPIRY) {
    return AMROD_TOKEN;
  }

  console.log('🔐 Authenticating with Amrod API...');

  const authUrl = 'https://identity.amrod.co.za/VendorLogin';
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    })
  });

  if (!response.ok) {
    throw new Error(`Amrod auth failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  AMROD_TOKEN = data.token;
  AMROD_TOKEN_EXPIRY = Date.now() + (50 * 60 * 1000); // 50 minutes (token valid for 1 hour)

  console.log('  ✅ Authenticated successfully');
  return AMROD_TOKEN;
}

//
// ——— AMROD API - FETCH PRODUCTS ———
//
async function fetchAmrodProducts() {
  console.log('\n📦 Fetching products from Amrod API...');

  const token = await getAmrodAuthToken();
  const url = 'https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding';

  // Retry logic for flaky API connections
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`  📡 Attempt ${attempt}/3...`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 120000
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
      }

      const products = await response.json();

      // Build map: productCode → category name
      const productCategoryMap = new Map();

      for (const product of products) {
        const code = product.productCode;
        const category = product.category?.trim() || null;

        if (code && category) {
          productCategoryMap.set(code, category);
        }
      }

      console.log(`  ✅ Loaded ${productCategoryMap.size} products with categories`);
      return productCategoryMap;

    } catch (err) {
      lastError = err;
      console.log(`  ⚠️  Attempt ${attempt} failed: ${err.message}`);

      if (attempt < 3) {
        const waitSeconds = attempt * 2; // 2s, 4s
        console.log(`  ⏳ Waiting ${waitSeconds}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
      }
    }
  }

  throw lastError;
}

//
// ——— SHOPIFY - FETCH COLLECTIONS ———
//
async function fetchShopifyCollections() {
  console.log('\n📚 Fetching collections from Shopify...');

  const collections = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query ($cursor: String) {
        collections(first: 250, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    const variables = cursor ? { cursor } : {};
    await new Promise(resolve => setTimeout(resolve, 300));

    const res = await fetch(`${SHOPIFY_BASE}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    if (!res.ok) throw new Error(`Failed fetching collections: ${res.status}`);
    const { data, errors } = await res.json();
    if (errors) throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);

    collections.push(...data.collections.edges.map(e => e.node));
    hasNextPage = data.collections.pageInfo.hasNextPage;
    cursor = data.collections.pageInfo.endCursor;
  }

  // Build map: lowercase collection title → collection ID
  const collectionMap = new Map();
  for (const collection of collections) {
    const lowerTitle = collection.title.toLowerCase().trim();
    collectionMap.set(lowerTitle, collection.id);
  }

  console.log(`  ✅ Loaded ${collectionMap.size} collections`);
  return collectionMap;
}

//
// ——— SHOPIFY - FETCH PRODUCTS ———
//
async function fetchShopifyProducts() {
  console.log('\n🛍️  Fetching products from Shopify...');

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
              tags
              variants(first: 1) {
                edges {
                  node {
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    const variables = cursor ? { cursor } : {};
    await new Promise(resolve => setTimeout(resolve, 300));

    const res = await fetch(`${SHOPIFY_BASE}/graphql.json`, {
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

  console.log(`  ✅ Loaded ${products.length} products from Shopify`);
  return products;
}

//
// ——— PRODUCT CODE EXTRACTION ———
//
function extractProductCode(shopifyProduct) {
  // Products synced by sync-v2.js use Amrod fullCode as SKU
  // Example: BC-HP-4-G-OS, AF-AM-7-D-M, etc.
  if (shopifyProduct.variants?.edges?.[0]?.node?.sku) {
    const sku = shopifyProduct.variants.edges[0].node.sku.trim();

    // Check if this looks like an Amrod product code (alphanumeric with dashes)
    // Amrod codes are like: BC-HP-4-G, AF-AM-7-D, SKIN-8000, etc.
    if (/^[A-Z0-9-]+$/i.test(sku)) {
      // Remove size/color variant suffixes
      // Common patterns: -S, -M, -L, -XL, -XXL, -OS, -OSFM, -Navy, -Black, -Red, etc.
      const variantPattern = /-(S|M|L|XL|XXL|XXXL|XS|OS|OSFM|ONE|ONESIZE|\d+|Navy|Black|White|Red|Blue|Green|Grey|Gray|Pink|Purple|Orange|Yellow|Brown|Melange)$/i;
      let baseCode = sku;

      // Keep removing suffixes until we get to the base product code
      let previousCode;
      do {
        previousCode = baseCode;
        baseCode = baseCode.replace(variantPattern, '');
      } while (baseCode !== previousCode && baseCode.length > 0);

      if (baseCode && baseCode.length > 2) {
        return baseCode;
      }
    }
  }

  return null;
}

//
// ——— ASSIGN PRODUCT TO COLLECTION ———
//
async function assignProductToCollection(shopifyProductId, collectionId, productTitle, categoryName) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would assign "${productTitle}" to collection "${categoryName}"`);
    return true;
  }

  try {
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
      id: collectionId,
      productIds: [shopifyProductId]
    };

    await new Promise(resolve => setTimeout(resolve, 500));

    const res = await fetch(`${SHOPIFY_BASE}/graphql.json`, {
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

    // Check for user errors - if product already in collection, that's OK
    if (data.collectionAddProducts.userErrors.length > 0) {
      const errorMsg = data.collectionAddProducts.userErrors[0].message || '';

      // If error is about product already in collection, that's OK - skip silently
      if (errorMsg.includes('Error adding') || errorMsg.includes('already')) {
        return false; // Already assigned
      }

      // Otherwise it's a real error
      throw new Error(`User errors: ${JSON.stringify(data.collectionAddProducts.userErrors)}`);
    }

    console.log(`  ✅ Assigned "${productTitle}" to collection "${categoryName}"`);
    return true;

  } catch (err) {
    console.log(`  ⚠️  Failed to assign "${productTitle}": ${err.message}`);
    throw err;
  }
}

//
// ——— MAIN EXECUTION ———
//
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ASSIGN PRODUCTS TO COLLECTIONS (Amrod → Shopify)         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Mode: ${DRY_RUN ? '🧪 DRY RUN' : '🚀 LIVE'}`);
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  try {
    ensureLogDirectories();

    // Step 1: Fetch Amrod products with categories
    const amrodProductCategories = await fetchAmrodProducts();

    // Step 2: Fetch Shopify collections
    const shopifyCollections = await fetchShopifyCollections();

    // Step 3: Fetch Shopify products
    const shopifyProducts = await fetchShopifyProducts();

    STATS.totalProducts = shopifyProducts.length;

    // Step 4: Process each Shopify product
    console.log('\n🔄 Processing products...\n');

    for (const shopifyProduct of shopifyProducts) {
      let categoryName = null;
      let productCode = null;

      // STRATEGY 1: Try to extract product code from SKU and match to Amrod
      productCode = extractProductCode(shopifyProduct);
      if (productCode) {
        categoryName = amrodProductCategories.get(productCode);
      }

      // STRATEGY 2: If no match via SKU, check if product tags contain a collection name
      // (sync-v2.js adds category names as tags, so products should already have the tag)
      if (!categoryName) {
        const tags = Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags : [];
        for (const tag of tags) {
          const normalizedTag = tag.toLowerCase().trim();
          if (shopifyCollections.has(normalizedTag)) {
            categoryName = tag; // Use original tag casing
            break;
          }
        }
      }

      // Skip if no category found
      if (!categoryName) {
        console.log(`⏭️  Skipping "${shopifyProduct.title}" - no category found (code: ${productCode || 'none'})`);
        STATS.productsSkipped++;
        continue;
      }

      // Find collection ID
      const collectionId = shopifyCollections.get(categoryName.toLowerCase().trim());

      if (!collectionId) {
        console.log(`⏭️  Skipping "${shopifyProduct.title}" - collection "${categoryName}" not found in Shopify`);
        STATS.productsSkipped++;
        continue;
      }

      // Assign product to collection
      try {
        const wasAssigned = await assignProductToCollection(
          shopifyProduct.id,
          collectionId,
          shopifyProduct.title,
          categoryName
        );

        STATS.productsProcessed++;
        if (wasAssigned) {
          STATS.collectionsAssigned++;
          log.action({
            action: 'assignProduct',
            productCode: productCode || 'via-tag',
            productTitle: shopifyProduct.title,
            categoryName,
            collectionId
          });
        }

      } catch (err) {
        STATS.productsFailed++;
        log.error(productCode || 'unknown', err, {
          productTitle: shopifyProduct.title,
          categoryName
        });
      }
    }

    // Final summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  ASSIGNMENT COMPLETED                                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const summary = log.summary();
    console.log(`📊 Summary:`);
    console.log(`   • Total products: ${STATS.totalProducts}`);
    console.log(`   • Processed: ${STATS.productsProcessed}`);
    console.log(`   • Collections assigned: ${STATS.collectionsAssigned}`);
    console.log(`   • Skipped: ${STATS.productsSkipped}`);
    console.log(`   • Failed: ${STATS.productsFailed}`);
    console.log(`   • Duration: ${summary.duration}`);
    console.log(`\n✅ Done! Check logs/ directory for details.`);

  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run
main();
