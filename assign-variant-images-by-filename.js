// assign-variant-images-by-filename.js
// Assign Images to Variants by Matching Color in Filename
// Version: 1.0
// For products where images are named like "Product-Name-Black.jpg", "Product-Name-Navy.jpg", etc.

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
  SHOPIFY_API_VERSION
} = process.env;

if (!SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_API_VERSION) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const SHOPIFY_BASE = `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/${SHOPIFY_API_VERSION}`;
const DRY_RUN = process.env.DRY_RUN === 'true';

// Log paths
const LOG_DIR = path.resolve('logs');
const LOGS = {
  ACTIONS: path.join(LOG_DIR, 'variant-image-filename-assignment-actions.log'),
  ERRORS: path.join(LOG_DIR, 'variant-image-filename-assignment-errors.log'),
  SUMMARY: path.join(LOG_DIR, 'variant-image-filename-assignment-summary.json')
};

// Runtime stats
const STATS = {
  totalProducts: 0,
  productsProcessed: 0,
  variantsUpdated: 0,
  variantsSkipped: 0,
  variantsFailed: 0,
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

  error: (productTitle, error, context = {}) => {
    logToFile(LOGS.ERRORS, {
      timestamp: new Date().toISOString(),
      productTitle,
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
// ——— SHOPIFY - FETCH PRODUCTS WITH VARIANTS AND IMAGES ———
//
async function fetchShopifyProducts() {
  console.log('\n🛍️  Fetching products from Shopify...');

  const products = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query ($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              images(first: 50) {
                edges {
                  node {
                    id
                    url
                  }
                }
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    sku
                    displayName
                    selectedOptions {
                      name
                      value
                    }
                    image {
                      id
                    }
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
// ——— EXTRACT FILENAME FROM URL ———
//
function getFilenameFromUrl(url) {
  if (!url) return '';
  // Get filename without query params
  const urlWithoutParams = url.split('?')[0];
  const parts = urlWithoutParams.split('/');
  return parts[parts.length - 1];
}

//
// ——— MATCH VARIANT TO IMAGE BY COLOR IN FILENAME ———
//
function matchVariantToImageByFilename(variant, productImages) {
  // Get variant's color from selectedOptions
  let variantColor = null;
  for (const option of variant.selectedOptions) {
    if (option.name.toLowerCase() === 'colour' || option.name.toLowerCase() === 'color') {
      variantColor = option.value.trim();
      break;
    }
  }

  if (!variantColor) {
    return null; // No color option found
  }

  // Normalize color for matching (lowercase, no spaces, no special chars)
  const normalizeColor = (str) => {
    return str.toLowerCase()
      .replace(/\s+/g, '-')  // Replace spaces with hyphens
      .replace(/[^a-z0-9-]/g, '');  // Remove special chars
  };

  const normalizedVariantColor = normalizeColor(variantColor);

  // Find image where filename contains the color
  for (const imageEdge of productImages) {
    const imageUrl = imageEdge.node?.url || '';
    const filename = getFilenameFromUrl(imageUrl);
    const normalizedFilename = normalizeColor(filename);

    // Check if filename contains the color
    // Examples:
    // - "FWRD-Quarter-Zip-Sweater-Black.jpg" matches color "Black"
    // - "Matrix-Trucker-Navy-Foc.jpg" matches color "Navy"
    // - "Premium-Headwear-Grey-Melange.jpg" matches color "Grey Melange"
    if (normalizedFilename.includes(normalizedVariantColor)) {
      return imageEdge.node.id;
    }
  }

  return null; // No matching image found
}

//
// ——— ASSIGN IMAGE TO VARIANT ———
//
async function assignImageToVariant(variantId, imageId, variantDisplayName, productTitle) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would assign image to variant "${variantDisplayName}" of "${productTitle}"`);
    return true;
  }

  try {
    // Extract numeric ID from GraphQL GID
    const variantNumericId = variantId.split('/').pop();
    const imageNumericId = imageId.split('/').pop();

    await new Promise(resolve => setTimeout(resolve, 300));

    // Use REST API to update variant image
    const res = await fetch(`${SHOPIFY_BASE}/variants/${variantNumericId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        variant: {
          id: parseInt(variantNumericId),
          image_id: parseInt(imageNumericId)
        }
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`REST API request failed: ${res.status} - ${errorText}`);
    }

    console.log(`  ✅ Assigned image to "${variantDisplayName}" in "${productTitle}"`);
    return true;

  } catch (err) {
    console.log(`  ⚠️  Failed to assign image to "${variantDisplayName}": ${err.message}`);
    throw err;
  }
}

//
// ——— MAIN EXECUTION ———
//
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ASSIGN VARIANT IMAGES BY FILENAME MATCHING               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Mode: ${DRY_RUN ? '🧪 DRY RUN' : '🚀 LIVE'}`);
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  try {
    ensureLogDirectories();

    // Fetch Shopify products with variants and images
    const shopifyProducts = await fetchShopifyProducts();

    STATS.totalProducts = shopifyProducts.length;

    // Process each Shopify product
    console.log('\n🔄 Processing products...\n');

    for (const shopifyProduct of shopifyProducts) {
      const productImages = shopifyProduct.images?.edges || [];
      const variants = shopifyProduct.variants?.edges || [];

      // Skip products with no images or no variants
      if (productImages.length === 0 || variants.length === 0) {
        continue;
      }

      // Skip products where all variants already have images
      const variantsWithoutImages = variants.filter(v => !v.node.image?.id);
      if (variantsWithoutImages.length === 0) {
        continue;
      }

      console.log(`\n📦 Processing "${shopifyProduct.title}"`);
      console.log(`   ${variants.length} variants, ${productImages.length} images, ${variantsWithoutImages.length} need images`);

      STATS.productsProcessed++;

      // Process each variant
      for (const variantEdge of variants) {
        const variant = variantEdge.node;

        // Skip if variant already has an image assigned
        if (variant.image?.id) {
          STATS.variantsSkipped++;
          continue;
        }

        // Try to match variant to an image by filename
        const imageId = matchVariantToImageByFilename(variant, productImages);

        if (!imageId) {
          console.log(`  ⏭️  Skipping "${variant.displayName}" - no matching image found`);
          STATS.variantsSkipped++;
          continue;
        }

        // Assign image to variant
        try {
          await assignImageToVariant(
            variant.id,
            imageId,
            variant.displayName,
            shopifyProduct.title
          );

          STATS.variantsUpdated++;
          log.action({
            action: 'assignVariantImage',
            productTitle: shopifyProduct.title,
            variantId: variant.id,
            variantName: variant.displayName,
            imageId
          });

        } catch (err) {
          STATS.variantsFailed++;
          log.error(shopifyProduct.title, err, {
            variantName: variant.displayName
          });
        }
      }
    }

    // Final summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  ASSIGNMENT COMPLETED                                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const summary = log.summary();
    console.log(`📊 Summary:`);
    console.log(`   • Total products: ${STATS.totalProducts}`);
    console.log(`   • Products processed: ${STATS.productsProcessed}`);
    console.log(`   • Variants updated: ${STATS.variantsUpdated}`);
    console.log(`   • Variants skipped: ${STATS.variantsSkipped}`);
    console.log(`   • Variants failed: ${STATS.variantsFailed}`);
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
