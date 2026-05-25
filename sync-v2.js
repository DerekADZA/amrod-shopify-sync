// sync-v2.js - ENHANCED VERSION with Comprehensive Logging & Status Management
// Version: 2.0

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
  AMROD_CUSTOMER_CODE,
  SHOPIFY_LOCATION_ID
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
if (!SHOPIFY_LOCATION_ID) {
  console.error('❌ Missing SHOPIFY_LOCATION_ID in .env');
  process.exit(1);
}

const SHOPIFY_BASE   = `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/${SHOPIFY_API_VERSION}`;
const AMROD_BASE     = 'https://vendorapi.amrod.co.za/api/v1';
const DRY_RUN        = process.env.DRY_RUN === 'true';
const MARKUP         = parseFloat(process.env.MARKUP) || 0.43;
const TEST_LIMIT     = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : null;

// Log paths
const LOG_DIR = path.resolve('logs');
const LOGS = {
  ACTIONS: path.join(LOG_DIR, 'sync-actions.log'),
  ERRORS: path.join(LOG_DIR, 'sync-errors.log'),
  VALIDATION: path.join(LOG_DIR, 'sync-validation.log'),
  STATUS_CHANGES: path.join(LOG_DIR, 'sync-status-changes.log'),
  PROMOTIONS: path.join(LOG_DIR, 'sync-promotions.log'),
  SUMMARY: path.join(LOG_DIR, 'sync-summary.json')
};

// Runtime stats
const STATS = {
  total: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  statusBreakdown: { active: 0, draft: 0 },
  promotions: { onPromotion: 0, newArrivals: 0, clearance: 0, featured: 0 },
  validationIssues: { noPrice: 0, noStock: 0, noImages: 0, noDescription: 0, total: 0 },
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

  try {
    fs.appendFileSync(filePath, logEntry);
  } catch (err) {
    console.warn(`⚠️  Unable to write log entry to ${filePath}: ${err.message}`);
  }
}

const log = {
  action: (data) => {
    logToFile(LOGS.ACTIONS, {
      ...data,
      timestamp: new Date().toISOString()
    });
  },

  error: (title, sku, error, context = {}) => {
    logToFile(LOGS.ERRORS, {
      timestamp: new Date().toISOString(),
      action: 'syncError',
      sku,
      title,
      error: error.message || error,
      context,
      stack: error.stack
    });
  },

  validation: (sku, title, issues) => {
    logToFile(LOGS.VALIDATION, {
      timestamp: new Date().toISOString(),
      sku,
      title,
      validationIssues: issues
    });

    // Update stats
    issues.forEach(issue => {
      if (issue.field === 'price') STATS.validationIssues.noPrice++;
      if (issue.field === 'stock') STATS.validationIssues.noStock++;
      if (issue.field === 'images') STATS.validationIssues.noImages++;
      if (issue.field === 'description') STATS.validationIssues.noDescription++;
    });
    STATS.validationIssues.total += issues.length;
  },

  statusChange: (productId, sku, title, oldStatus, newStatus, reasons) => {
    if (oldStatus !== newStatus || !oldStatus) {
      logToFile(LOGS.STATUS_CHANGES, {
        timestamp: new Date().toISOString(),
        productId,
        sku,
        title,
        oldStatus: oldStatus || 'new',
        newStatus,
        reasons
      });

      if (newStatus === 'draft' || newStatus === 'DRAFT') {
        STATS.statusBreakdown.draft++;
      } else {
        STATS.statusBreakdown.active++;
      }
    }
  },

  promotion: (type, sku, title) => {
    logToFile(LOGS.PROMOTIONS, {
      timestamp: new Date().toISOString(),
      promotionType: type,
      sku,
      title
    });

    // Update stats
    if (type === 'On Promotion') STATS.promotions.onPromotion++;
    if (type === 'New Arrival') STATS.promotions.newArrivals++;
    if (type === 'Clearance') STATS.promotions.clearance++;
    if (type === 'Featured') STATS.promotions.featured++;
  }
};

// Console logging helpers
const console2 = {
  skip: (reason, title, sku) => {
    console.log(`⏭️  SKIP: ${reason} - "${title}" (SKU: ${sku || 'N/A'})`);
  },
  create: (title, sku, variantCount, status) => {
    const statusIcon = status === 'draft' || status === 'DRAFT' ? '📝' : '🟢';
    console.log(`🆕 CREATE: "${title}" (SKU: ${sku || 'N/A'}) - ${variantCount} variants ${statusIcon} ${status.toUpperCase()}`);
  },
  update: (title, sku, matchMethod, variantCount, status) => {
    const statusIcon = status === 'draft' || status === 'DRAFT' ? '📝' : '🟢';
    console.log(`🔄 UPDATE: "${title}" (SKU: ${sku || 'N/A'}) via ${matchMethod} - ${variantCount} variants ${statusIcon} ${status.toUpperCase()}`);
  },
  error: (title, sku, error) => {
    console.log(`❌ ERROR: "${title}" (SKU: ${sku || 'N/A'}) - ${error}`);
  },
  progress: (current, total, successful, failed, skipped) => {
    const percentage = Math.round((current / total) * 100);
    console.log(`📊 Progress: ${current}/${total} (${percentage}%) - ✅${successful} ❌${failed} ⏭️${skipped}`);
  },
  statusChange: (title, oldStatus, newStatus, reason) => {
    console.log(`🔄 Status Change: "${title}" ${oldStatus || 'new'} → ${newStatus} (${reason})`);
  }
};

//
// ——— PRICE CALCULATION ———
//
function calculatePrice(cost) {
  if (!cost || cost <= 0) return 0;
  const markedUp = cost * (1 + MARKUP);
  const rounded  = Math.ceil(markedUp * 100) / 100 - 0.01;
  return Number(rounded.toFixed(2));
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

async function fetchAllAmrod() {
  const token = await getAmrodToken();
  const url   = `${AMROD_BASE}/Products/GetProductsAndBranding`;
  console.log(`🔍 Fetching full Amrod catalog from ${url}`);
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
    throw new Error(`Amrod fetch failed: ${res.status} — ${body}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Expected array, got ${typeof data}`);
  console.log(`✅ Retrieved ${data.length} products`);
  return data;
}

//
// ——— SHOPIFY METAFIELD DEFINITIONS ———
//
async function fetchMetafieldDefinitions() {
  try {
    const query = `
      query {
        metafieldDefinitions(first: 250, ownerType: PRODUCT) {
          nodes {
            key
            namespace
            type {
              name
            }
          }
        }
      }
    `;

    const res = await axios.post(
      `${SHOPIFY_BASE}/graphql.json`,
      { query },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    if (res.data.errors) {
      console.warn('⚠️  Warning: Could not fetch metafield definitions:', res.data.errors[0].message);
      return new Map();
    }

    const definitions = res.data.data.metafieldDefinitions.nodes;
    const typeMap = new Map();

    definitions.forEach(def => {
      const key = `${def.namespace}.${def.key}`;
      typeMap.set(key, def.type.name);
    });

    console.log(`✅ Loaded ${typeMap.size} metafield definitions from Shopify`);
    return typeMap;
  } catch (error) {
    console.warn('⚠️  Warning: Could not fetch metafield definitions:', error.message);
    return new Map();
  }
}

async function fetchAmrodPrices() {
  const token = await getAmrodToken();
  const url   = `${AMROD_BASE}/Prices/`;
  console.log(`💰 Fetching Amrod prices from ${url}`);
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
    throw new Error(`Amrod prices fetch failed: ${res.status} — ${body}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Expected array, got ${typeof data}`);
  console.log(`✅ Retrieved ${data.length} price records`);

  // Build pricing map for fast lookup
  const priceMap = new Map();
  for (const record of data) {
    const fullCode = record.fullCode;
    const cost = parseFloat(record.price);

    if (fullCode && cost && cost > 0) {
      // Store with multiple case variations for flexible lookup
      priceMap.set(fullCode, cost);
      priceMap.set(fullCode.toLowerCase(), cost);
      priceMap.set(fullCode.toUpperCase(), cost);
    }
  }

  console.log(`📊 Built price map with ${priceMap.size} entries`);
  return priceMap;
}

async function fetchAllStock() {
  const token = await getAmrodToken();
  const url   = `${AMROD_BASE}/Stock/`;
  console.log(`🔍 Fetching stock from ${url}`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout:  60_000
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stock fetch failed: ${res.status} — ${body}`);
  }

  const data  = await res.json();
  const items = Array.isArray(data) ? data : data.items || [];

  // Filter to only items with a valid fullCode
  const variantStock = items.filter(s => s.fullCode != null);

  console.log(`✅ Loaded ${variantStock.length} stock entries`);

  return variantStock.map(s => [
    String(s.fullCode).toUpperCase(),
    Number(s.stock)
  ]);
}

//
// ——— SHOPIFY EXISTING LOOKUPS ———
//
async function fetchExistingMaps() {
  console.log('🔍 Loading existing Shopify products...');
  const skuMap    = new Map();
  const handleMap = new Map();
  const productStatusMap = new Map(); // Track existing statuses

  // Build SKU map
  let pageInfo = null;
  const vParams = new URLSearchParams({ limit: '250' });
  do {
    const vUrl = new URL(`${SHOPIFY_BASE}/variants.json`);
    vUrl.search = vParams.toString();
    const vRes = await fetch(vUrl, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }
    });
    if (!vRes.ok) throw new Error(`Failed fetching variants: ${vRes.status}`);
    const { variants } = await vRes.json();
    for (const v of variants) {
      if (!v.sku) continue;
      skuMap.set(v.sku.toUpperCase(), {
        productId: v.product_id,
        variantId: v.id,
        inventoryItemId: v.inventory_item_id,
        imageId: v.image_id || null
      });
    }
    const link = vRes.headers.get('link');
    const m = link?.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/);
    pageInfo = m?.[1] || null;
    if (pageInfo) vParams.set('page_info', pageInfo);
  } while (pageInfo);
  console.log(`  • Loaded ${skuMap.size} SKUs`);

  // Build handle map & status map
  pageInfo = null;
  const pParams = new URLSearchParams({ limit: '250', fields: 'id,handle,status' });
  do {
    const pUrl = new URL(`${SHOPIFY_BASE}/products.json`);
    pUrl.search = pParams.toString();
    const pRes = await fetch(pUrl, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }
    });
    if (!pRes.ok) throw new Error(`Failed fetching products: ${pRes.status}`);
    const { products } = await pRes.json();
    for (const p of products) {
      if (p.handle) handleMap.set(p.handle, p.id);
      productStatusMap.set(p.id, p.status);
    }
    const link = pRes.headers.get('link');
    const m = link?.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/);
    pageInfo = m?.[1] || null;
    if (pageInfo) pParams.set('page_info', pageInfo);
  } while (pageInfo);
  console.log(`  • Loaded ${handleMap.size} handles`);

  return { skuMap, handleMap, productStatusMap };
}

//
// ——— IMAGE HANDLING HELPERS ———
//

/**
 * Build a mapping from color codes to images from Amrod colourImages data
 */
function buildColorImageMap(amrodProduct) {
  const colorImageMap = new Map();

  if (!amrodProduct.colourImages || !Array.isArray(amrodProduct.colourImages)) {
    return colorImageMap;
  }

  amrodProduct.colourImages.forEach(colorGroup => {
    const colorCode = (colorGroup.colourCode || colorGroup.colour || '').toLowerCase().trim();
    const colorName = (colorGroup.colour || colorGroup.colourName || '').toLowerCase().trim();

    if (colorCode && Array.isArray(colorGroup.images) && colorGroup.images.length > 0) {
      // Store with both code and name as keys for flexible matching
      colorImageMap.set(colorCode, colorGroup.images);
      if (colorName && colorName !== colorCode) {
        colorImageMap.set(colorName, colorGroup.images);
      }
    }
  });

  return colorImageMap;
}

/**
 * Normalize image URL for comparison
 */
function basenameWithoutExtAndSize(url) {
  if (!url) return '';
  const filename = url.split('?')[0].split('/').pop() || '';
  const lower = filename.toLowerCase();
  const withoutExt = lower.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
  return withoutExt.replace(/([_-])\d{2,4}x\d{2,4}$/, '');
}

function extractNumericIdFromGid(gid) {
  if (!gid) return null;
  const match = gid.toString().match(/(\d+)(?:\?.*)?$/);
  return match ? match[1] : null;
}

function extractAmrodImageUrl(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (image.url) return image.url;
  if (Array.isArray(image.urls)) {
    const first = image.urls.find(entry => entry?.url) || image.urls[0];
    return first?.url || null;
  }
  if (image.originalSource) return image.originalSource;
  return null;
}

function buildImageCatalogFromShopify(images = []) {
  const catalog = new Map();
  for (const image of images) {
    const src = image?.src || image?.url;
    const base = basenameWithoutExtAndSize(src || '');
    if (!base) continue;
    catalog.set(base, {
      imageId: image.id,
      src
    });
  }
  return catalog;
}

function findCatalogEntryForBase(catalog, base) {
  const normalized = (base || '').toString().toLowerCase().trim();
  if (!normalized) return null;
  if (catalog.has(normalized)) return catalog.get(normalized);
  for (const [key, value] of catalog.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return value;
    }
  }
  return null;
}

function findCatalogEntryForAmrodImage(amrodVariant, colorImageMap, catalog) {
  if (!amrodVariant) return null;

  const candidateKeys = [];
  const colourCode = (amrodVariant.codeColour || amrodVariant.colourCode || '').toLowerCase().trim();
  const colourName = (amrodVariant.codeColourName || amrodVariant.colourCodeName || '').toLowerCase().trim();

  if (colourCode) candidateKeys.push(colourCode);
  if (colourName && colourName !== colourCode) candidateKeys.push(colourName);

  for (const key of candidateKeys) {
    const images = colorImageMap.get(key);
    if (!images || images.length === 0) continue;
    for (const img of images) {
      const url = extractAmrodImageUrl(img);
      const base = basenameWithoutExtAndSize(url || '');
      if (!base) continue;
      const entry = findCatalogEntryForBase(catalog, base);
      if (entry) return entry;
    }
  }

  // Fallback to full code matching if colour lookup failed
  const fullCode = (amrodVariant.fullCode || '').toLowerCase();
  if (fullCode) {
    const fallback = findCatalogEntryForBase(catalog, fullCode);
    if (fallback) return fallback;
  }

  return null;
}

async function assignVariantImageViaRest(variantId, productImageId) {
  const variantIdNumeric = extractNumericIdFromGid(variantId);
  const imageIdNumeric = extractNumericIdFromGid(productImageId);
  if (!variantIdNumeric || !imageIdNumeric) {
    throw new Error(`Unable to resolve numeric IDs for variant (${variantId}) or image (${productImageId})`);
  }

  const res = await fetch(`${SHOPIFY_BASE}/variants/${variantIdNumeric}.json`, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      variant: {
        id: Number(variantIdNumeric),
        image_id: Number(imageIdNumeric)
      }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Variant image assignment failed: ${res.status} ${res.statusText} - ${text}`);
  }
}

async function fetchShopifyProductDetails(productGid, { attempts = 3, delayMs = 500 } = {}) {
  const productIdNumeric = extractNumericIdFromGid(productGid);
  if (!productIdNumeric) return null;

  const url = `${SHOPIFY_BASE}/products/${productIdNumeric}.json?fields=id,images,variants`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }
    });

    if (res.ok) {
      const json = await res.json();
      return json.product || null;
    }

    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      continue;
    }

    const text = await res.text();
    throw new Error(`Failed to fetch product details: ${res.status} ${res.statusText} - ${text}`);
  }
  return null;
}

async function assignVariantImagesForProduct(productDetails, colorImageMap, amrodVariants, productTitle) {
  if (!productDetails || !Array.isArray(productDetails.variants) || productDetails.variants.length === 0) return { assigned: 0, skipped: 0 };
  if (!colorImageMap || colorImageMap.size === 0) return { assigned: 0, skipped: productDetails.variants.length };

  const catalog = buildImageCatalogFromShopify(productDetails.images || []);
  if (!catalog.size) return { assigned: 0, skipped: productDetails.variants.length };

  const amrodMap = new Map(
    (amrodVariants || []).map(v => [String(v.fullCode || '').toUpperCase(), v])
  );

  let assigned = 0;
  let skipped = 0;

  for (const shopVariant of productDetails.variants) {
    const skuKey = String(shopVariant.sku || '').toUpperCase();
    if (!skuKey) {
      skipped++;
      continue;
    }
    const amrodVariant = amrodMap.get(skuKey);
    if (!amrodVariant) {
      skipped++;
      continue;
    }

    const catalogEntry = findCatalogEntryForAmrodImage(amrodVariant, colorImageMap, catalog);
    if (!catalogEntry) {
      skipped++;
      continue;
    }

    if (shopVariant.image_id && shopVariant.image_id === catalogEntry.imageId) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would assign product image ${catalogEntry.imageId} to variant ${shopVariant.id} (${productTitle})`);
      assigned++;
      continue;
    }

    try {
      await assignVariantImageViaRest(shopVariant.id, catalogEntry.imageId);
      assigned++;
    } catch (err) {
      console.log(`  ⚠️  Failed to assign image to variant ${shopVariant.id}: ${err.message}`);
      skipped++;
    }
  }

  return { assigned, skipped };
}

/**
 * Recursively collect image URLs from Amrod product data
 * Searches through entire object structure for any image URLs
 */
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

/**
 * Collect all product images (general + color-specific)
 * Uses recursive search through entire product object
 */
function collectAllProductImages(amrodProduct) {
  const imageSet = new Set();

  // Recursively search through entire product object for image URLs
  [amrodProduct.Images, amrodProduct.images, amrodProduct.colourImages, amrodProduct.BrandingImages, amrodProduct.components]
    .forEach(src => {
      if (Array.isArray(src)) src.forEach(o => collectImageURLs(o, imageSet, new Set()));
      else if (typeof src === 'object') collectImageURLs(src, imageSet, new Set());
    });

  // Also search through the entire product object recursively
  collectImageURLs(amrodProduct, imageSet, new Set());

  // Convert URLs to Shopify image format
  const images = Array.from(imageSet).map(src => ({ src }));

  return images;
}

//
// ——— BUILD TAGS FROM AMROD DATA ———
//
function buildTags(amrod) {
  const tags = [];

  // Category tags
  if (amrod.categories && Array.isArray(amrod.categories)) {
    tags.push(...amrod.categories.map(c => c.name));
  }

  // Promotion tags
  const promotionMap = {
    1: 'On Promotion',
    2: 'New Arrival',
    3: 'Clearance'
  };

  if (amrod.promotion && amrod.promotion > 0 && promotionMap[amrod.promotion]) {
    tags.push(promotionMap[amrod.promotion]);
  }

  // Behavior tags
  if (amrod.behaviour === 1) {
    tags.push('Featured');
  }

  // Decoupled tag
  if (amrod.decoupled) {
    tags.push('Decoupled', 'Special');
  }

  // Inventory type tags (from Amrod inventoryType field)
  if (amrod.inventoryType) {
    const inventoryTypeMap = {
      '1': 'In Stock',
      '2': 'Low Stock',
      '3': 'Out of Stock',
      '4': 'Pre-Order',
      '5': 'Made to Order'
    };

    const inventoryTag = inventoryTypeMap[String(amrod.inventoryType)];
    if (inventoryTag) {
      tags.push(inventoryTag);
    }
  }

  return tags;
}

//
// ——— PRODUCT VALIDATION ———
//
function validateProduct(payload, amrod) {
  const issues = [];
  const { product, variants, images } = payload;

  // Check title
  if (!product.title || product.title.trim() === '') {
    issues.push({ field: 'title', issue: 'Missing product title', severity: 'error' });
  }

  // Check variants
  if (!variants || variants.length === 0) {
    issues.push({ field: 'variants', issue: 'No variants provided', severity: 'error' });
  }

  // Check prices
  const hasValidPrice = variants.some(v => parseFloat(v.price) > 0);
  if (!hasValidPrice) {
    issues.push({ field: 'price', issue: 'All variants have zero price', severity: 'error' });
  }

  // Check stock
  const hasStock = variants.some(v => v.inventory_quantity > 0);
  if (!hasStock) {
    issues.push({ field: 'stock', issue: 'All variants out of stock', severity: 'warning' });
  }

  // Check images
  if (!images || images.length === 0) {
    issues.push({ field: 'images', issue: 'No images provided', severity: 'warning' });
  }

  // Check description
  if (!product.body_html || product.body_html.trim() === '') {
    issues.push({ field: 'description', issue: 'Missing product description', severity: 'warning' });
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues
  };
}

//
// ——— DETERMINE PRODUCT STATUS (DRAFT vs ACTIVE) ———
//
function determineProductStatus(payload, amrod) {
  const { product, variants, images } = payload;
  const reasons = [];
  let status = 'ACTIVE';

  // RULE 1: Amrod Hidden Flag (highest priority - early return)
  if (amrod.behaviour === 2) {
    status = 'DRAFT';
    reasons.push('Hidden by Amrod (behaviour flag = 2)');
    return { status, reasons };
  }

  // RULE 2: No Price or Zero Price (early return)
  const hasValidPrice = variants.some(v => parseFloat(v.price) > 0);
  if (!hasValidPrice) {
    status = 'DRAFT';
    reasons.push('No valid price (all variants have price = 0)');
    return { status, reasons };
  }

  // RULE 3: Missing Description (early return)
  if (!product.body_html || product.body_html.trim() === '') {
    status = 'DRAFT';
    reasons.push('Missing product description');
    return { status, reasons };
  }

  // RULE 4: No Images (early return)
  if (!images || images.length === 0) {
    status = 'DRAFT';
    reasons.push('No product images available');
    return { status, reasons };
  }

  // NOTE: We do NOT set products to DRAFT just because they're out of stock
  // Out-of-stock products should remain ACTIVE with inventory tags
  // Inventory type is handled via tags (In Stock, Out of Stock, Pre-Order, Made to Order)

  reasons.push('Meets all criteria for active status');
  return { status, reasons };
}

//
// ——— METAFIELD TYPE DETECTION ———
//
// EXACT metafield type mapping from Shopify store metafield definitions
// This prevents type mismatch errors during product creation/updates
const AMROD_FIELD_TYPE_MAP = {
  'simplecode': 'single_line_text_field',
  'fullcode': 'single_line_text_field',
  'productname': 'single_line_text_field',
  'inventorytype': 'single_line_text_field',
  'behaviour': 'single_line_text_field',
  'promotion': 'single_line_text_field',
  'type': 'single_line_text_field',
  'categories': 'json',
  'description': 'multi_line_text_field',
  'images': 'json',
  'decoupled': 'boolean',
  'maximum': 'single_line_text_field',  // NOTE: text, not number_integer!
  'minimum': 'single_line_text_field',  // NOTE: text, not number_integer!
  'incrementedby': 'single_line_text_field',  // NOTE: text, not number_integer!
  'islogo24': 'single_line_text_field',
  'categorisedattribute': 'json',
  'relatedcodes': 'single_line_text_field',
  'matchingcodes': 'single_line_text_field',
  'groupingcodes': 'single_line_text_field',
  'keywords': 'single_line_text_field',
  'brandings': 'json',
  'fullbrandingguide': 'single_line_text_field',
  'material': 'single_line_text_field',
  'displaycountryoforigin': 'single_line_text_field',
  'brand': 'json',
  'colourimages': 'json',
  'inclusivebranding': 'json',
  'gender': 'single_line_text_field',
  'companioncodes': 'single_line_text_field',
  'madetoorder': 'multi_line_text_field',
  'madetoordermessage': 'multi_line_text_field',
  'requiredbrandingpositions': 'json',
  'brandingtemplates': 'json',
  'logo24branding': 'json',
  'logo24brandingguide': 'single_line_text_field',
  'nocobrandingpositions': 'json',
  'fit': 'single_line_text_field',
  'feature': 'single_line_text_field',
  'tags': 'single_line_text_field'
};

function getMetafieldType(fieldName, value, metafieldDefinitions = null) {
  // PRIORITY 1: Use actual Shopify metafield definitions if available
  if (metafieldDefinitions) {
    const normalizedKey = String(fieldName).toLowerCase().replace(/\s+/g, '');
    const definitionKey = `amrod.${normalizedKey}`;
    const definedType = metafieldDefinitions.get(definitionKey);
    if (definedType) {
      return definedType;
    }
  }

  // PRIORITY 2: Use hardcoded mapping if available
  const normalizedKey = String(fieldName).toLowerCase().replace(/\s+/g, '');
  if (AMROD_FIELD_TYPE_MAP[normalizedKey]) {
    return AMROD_FIELD_TYPE_MAP[normalizedKey];
  }

  // PRIORITY 3: Fallback to safe defaults based on value type
  if (value == null) return 'single_line_text_field';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'json';

  // Default to text (safest option)
  return 'single_line_text_field';
}

// Helper to check if a value is valid for metafield
function isValidMetafieldValue(val, expectedType) {
  if (val === null || val === undefined) return false;

  if (expectedType === 'boolean') {
    return typeof val === 'boolean' || val === 'true' || val === 'false' || val === true || val === false;
  }

  if (expectedType === 'json') {
    if (typeof val === 'object') {
      // For JSON fields, ensure objects are valid and not empty
      if (Array.isArray(val)) {
        return val.length > 0;
      } else {
        return Object.keys(val).length > 0;
      }
    }
    return false;
  }

  // For text fields
  if (expectedType.includes('text_field')) {
    if (typeof val === 'object') {
      // Check if object can be safely stringified
      try {
        const stringified = JSON.stringify(val);
        return stringified !== '{}' && stringified !== '[]' && stringified !== 'null';
      } catch (err) {
        return false;
      }
    }
    return val !== '' && val !== null && val !== undefined;
  }

  if (typeof val === 'string' && val.trim() === '') return false;
  if (Array.isArray(val) && val.length === 0) return false;
  if (typeof val === 'object' && Object.keys(val).length === 0) return false;

  return true;
}

function formatMetafieldValue(value, type) {
  if (value == null) return '';

  if (type === 'json') {
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return String(value);
    return String(value === 'true' || value === '1' || value === 1);
  }

  // For text fields, if it's an object, stringify it
  if (type.includes('text_field')) {
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value).trim();
  }

  return String(value);
}

//
// ——— TRANSFORM PRODUCT (AMROD → SHOPIFY) ———
//
function transformProduct(amrod, stockMap, priceMap, metafieldDefinitions = null) {
  // Early validation
  if (!amrod.productName) {
    console2.skip('No product name', 'Unknown Product', amrod.productCode);
    return null;
  }

  if (!amrod.variants || amrod.variants.length === 0) {
    console2.skip('No variants', amrod.productName, amrod.productCode);
    return null;
  }

  // Build tags
  const tags = buildTags(amrod);

  // Build product
  const product = {
    title:           amrod.productName,
    body_html:       amrod.description || '',
    vendor:          amrod.brand?.name || '',
    product_type:    amrod.categories?.[0]?.name || amrod.type || '',
    tags:            tags,
    template_suffix: 'amrod-products'
  };

  // Detect if product has colour/size variations (using Amrod API field names)
  const hasColour = (amrod.variants || []).some(v => v.codeColourName || v.codeColour);
  const hasSize = (amrod.variants || []).some(v => v.codeSizeName || v.codeSize);

  // Build variants
  const variants = (amrod.variants || []).map(v => {
    const code  = v.fullCode?.toUpperCase();
    const stock = code ? (stockMap.get(code) ?? v.stock) : v.stock;

    // PRICE LOOKUP: Get cost price from priceMap using fullCode
    const costPrice = code ? (priceMap.get(code) || priceMap.get(v.fullCode) || 0) : 0;
    const calculatedPrice = calculatePrice(costPrice);

    // Get colour and size values from Amrod API fields
    const colourValue = v.codeColourName || v.codeColour || 'Default';
    const sizeValue = v.codeSizeName || v.codeSize || 'One Size';

    // Build optionValues for GraphQL API (2024-10+)
    const optionValues = [];
    if (hasColour) {
      optionValues.push({
        optionName: 'Colour',
        name: colourValue
      });
    }
    if (hasSize) {
      optionValues.push({
        optionName: 'Size',
        name: sizeValue
      });
    }
    // If no options, use Title (Shopify default)
    if (optionValues.length === 0) {
      optionValues.push({
        optionName: 'Title',
        name: 'Default Title'
      });
    }

    return {
      sku:                  v.fullCode,
      option1:              colourValue,
      option2:              sizeValue,
      price:                calculatedPrice.toFixed(2),
      cost:                 costPrice.toFixed(2),
      inventory_management: 'shopify',
      inventory_quantity:   stock || 0,
      optionValues:         optionValues  // For GraphQL API
    };
  });

  // Build productOptions for GraphQL product creation (2024-10+ API)
  const productOptions = [];
  if (hasColour) {
    const uniqueColours = [...new Set(
      (amrod.variants || []).map(v => v.codeColourName || v.codeColour || 'Default')
    )];
    productOptions.push({
      name: 'Colour',
      values: uniqueColours.map(name => ({ name }))
    });
  }
  if (hasSize) {
    const uniqueSizes = [...new Set(
      (amrod.variants || []).map(v => v.codeSizeName || v.codeSize || 'One Size')
    )];
    productOptions.push({
      name: 'Size',
      values: uniqueSizes.map(name => ({ name }))
    });
  }
  // If no options, Shopify creates default "Title" option automatically

  // Build metafields
  const skip = new Set([
    'productName','description','brand','type','categories','variants','images',
    'colourImages', 'branding', 'brandingGuide'
  ]);

  const priorityFields = ['productCode', 'simplecode', 'fullcode', 'decoupled', 'promotion', 'behaviour'];

  const metafields = [];

  // Add priority fields with validation
  priorityFields.forEach(key => {
    if (amrod[key] != null && !skip.has(key)) {
      const val = amrod[key];
      const type = getMetafieldType(key, val, metafieldDefinitions);

      // Validate before adding
      if (isValidMetafieldValue(val, type)) {
        metafields.push({
          namespace: 'amrod',
          key: key.toLowerCase(),
          type: type,
          value: formatMetafieldValue(val, type)
        });
      }
    }
  });

  // Add other fields with validation (limit to prevent overload)
  Object.entries(amrod).forEach(([key, val]) => {
    if (!skip.has(key) && !priorityFields.includes(key) && metafields.length < 20) {
      if (val != null && val !== '' && val !== 'null') {
        const type = getMetafieldType(key, val, metafieldDefinitions);

        // Validate before adding
        if (isValidMetafieldValue(val, type)) {
          metafields.push({
            namespace: 'amrod',
            key: key.toLowerCase(),
            type: type,
            value: formatMetafieldValue(val, type)
          });
        }
      }
    }
  });

  // Handle images - collect all product images (general + color-specific)
  const images = collectAllProductImages(amrod);

  // Build color image map for variant image assignment
  const colorImageMap = buildColorImageMap(amrod);

  return { product, variants, metafields, images, productOptions, colorImageMap, amrodData: amrod };
}

//
// ——— GRAPHQL UPSERT (FIXED VERSION) ———
//
async function upsertToShopifyGraphQL(payload, maps) {
  const { skuMap, handleMap, productStatusMap } = maps;
  const { product, variants, metafields, images, productOptions, colorImageMap, amrodData } = payload;
  const primarySku = variants[0]?.sku?.toUpperCase();

  const skuEntry = primarySku ? skuMap.get(primarySku) : null;
  let existingId = skuEntry?.productId || null;
  let matchMethod = existingId ? 'SKU' : null;

  // Fallback by handle
  if (!existingId) {
    const handle = product.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (handleMap.has(handle)) {
      existingId = handleMap.get(handle);
      matchMethod = 'handle';
    }
  }

  const isUpdate = !!existingId;
  const oldStatus = existingId ? productStatusMap.get(existingId) : null;

  // Determine status
  const statusResult = determineProductStatus(payload, amrodData);
  product.status = statusResult.status;

  // Console logging before action
  if (isUpdate) {
    console2.update(product.title, primarySku, matchMethod, variants.length, product.status);
  } else {
    console2.create(product.title, primarySku, variants.length, product.status);
  }

  // Log status change
  if (oldStatus && oldStatus.toUpperCase() !== product.status) {
    console2.statusChange(product.title, oldStatus, product.status, statusResult.reasons[0]);
    log.statusChange(existingId, primarySku, product.title, oldStatus, product.status, statusResult.reasons);
  } else if (!isUpdate) {
    log.statusChange('new', primarySku, product.title, null, product.status, statusResult.reasons);
  }

  // Log promotions
  if (product.tags.includes('On Promotion')) {
    log.promotion('On Promotion', primarySku, product.title);
  }
  if (product.tags.includes('New Arrival')) {
    log.promotion('New Arrival', primarySku, product.title);
  }
  if (product.tags.includes('Clearance')) {
    log.promotion('Clearance', primarySku, product.title);
  }
  if (product.tags.includes('Featured')) {
    log.promotion('Featured', primarySku, product.title);
  }

  if (DRY_RUN) {
    const actionType = isUpdate ? 'UPDATE' : 'CREATE';
    console.log(`[DRY RUN] Would ${actionType} "${product.title}" - Status: ${product.status}`);
    log.action({
      action: `dryRun${actionType}`,
      sku: primarySku,
      title: product.title,
      status: product.status,
      variantCount: variants.length,
      metafieldCount: metafields.length
    });
    return { id: 'dry-run', variants: variants.map(v => ({ ...v, inventory_item_id: 'dry-run' })) };
  }

  try {
    const client = axios.create({
      baseURL: `${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    let shopProduct;

    if (isUpdate) {
      // For updates: Update product data separately, then variants
      // GraphQL productUpdate doesn't support variant updates directly

      const updateMutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              title
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // IMPORTANT: Skip metafields on updates to avoid type conflicts
      // Metafield definitions may already exist with different types
      const updateInput = {
        id: `gid://shopify/Product/${existingId}`,
        title: product.title,
        descriptionHtml: product.body_html,
        vendor: product.vendor,
        productType: product.product_type,
        tags: product.tags,
        templateSuffix: product.template_suffix,
        status: product.status
        // NOTE: metafields excluded for updates - only used on product creation
      };

      const response = await client.post('/graphql.json', {
        query: updateMutation,
        variables: { input: updateInput }
      });

      if (response.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      const result = response.data.data.productUpdate;
      if (result.userErrors.length > 0) {
        throw new Error(`Product update errors: ${result.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
      }

      shopProduct = result.product;

      // Step 2 (for updates): Sync images using productCreateMedia
      // This adds/updates product images for existing products
      if (images && images.length > 0) {
        try {
          const mediaInput = images.map(img => ({
            originalSource: img.src,
            mediaContentType: 'IMAGE'
          }));

          const mediaMutation = `
            mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
              productCreateMedia(media: $media, productId: $productId) {
                media {
                  id
                  mediaContentType
                }
                mediaUserErrors {
                  field
                  message
                }
              }
            }
          `;

          const mediaResponse = await client.post('/graphql.json', {
            query: mediaMutation,
            variables: {
              productId: shopProduct.id,
              media: mediaInput
            }
          });

          if (mediaResponse.data.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
            console.log(`⚠️  Image sync warnings: ${mediaResponse.data.data.productCreateMedia.mediaUserErrors.map(e => e.message).join(', ')}`);
          }
        } catch (imageErr) {
          // Non-blocking: Log but don't fail the entire update
          console.log(`⚠️  Image sync failed (non-critical): ${imageErr.message}`);
        }
      }

      // Note: Variant updates would need separate mutation
      // For now, we'll handle via inventory updates

    } else {
      // For creates: 3-step process (required for Shopify API 2024-10+)
      // Step 1: Create product WITHOUT variants BUT WITH media/images
      const createMutation = `
        mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
          productCreate(input: $input, media: $media) {
            product {
              id
              title
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Build ProductInput for creation
      // IMPORTANT: Don't include variants in ProductInput (Shopify API 2024-10+ requirement)
      // Metafields are NOW INCLUDED with correct types from Shopify definitions
      const createInput = {
        title: product.title,
        descriptionHtml: product.body_html,
        vendor: product.vendor,
        productType: product.product_type,
        tags: product.tags,
        templateSuffix: product.template_suffix,
        status: product.status
      };

      // Add productOptions if available (for products with colour/size variants)
      if (productOptions && productOptions.length > 0) {
        createInput.productOptions = productOptions;
      }

      // Add metafields if available (with types from Shopify metafield definitions)
      if (metafields && metafields.length > 0) {
        createInput.metafields = metafields;
      }

      // Prepare media input for images (GraphQL requires separate media parameter)
      const mediaInput = images && images.length > 0
        ? images.map(img => ({
            originalSource: img.src,
            mediaContentType: 'IMAGE'
          }))
        : [];

      const createResponse = await client.post('/graphql.json', {
        query: createMutation,
        variables: {
          input: createInput,
          media: mediaInput
        }
      });

      if (createResponse.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(createResponse.data.errors)}`);
      }

      const createResult = createResponse.data.data.productCreate;
      if (createResult.userErrors.length > 0) {
        throw new Error(`Product create errors: ${createResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
      }

      shopProduct = createResult.product;

      // Step 2: Create variants using productVariantsBulkCreate
      const variantsMutation = `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
          productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
            productVariants {
              id
              sku
              inventoryItem {
                id
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variantInputs = variants.map(v => ({
        price: v.price,
        optionValues: v.optionValues,  // Required for API 2024-10+
        inventoryItem: {
          sku: v.sku,  // SKU goes inside inventoryItem, not at top level
          cost: v.cost,
          tracked: true
        },
        inventoryQuantities: [{
          locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`,
          availableQuantity: v.inventory_quantity
        }]
      }));

      const variantsResponse = await client.post('/graphql.json', {
        query: variantsMutation,
        variables: {
          productId: shopProduct.id,
          variants: variantInputs,
          strategy: 'REMOVE_STANDALONE_VARIANT'
        }
      });

      if (variantsResponse.data.errors) {
        throw new Error(`GraphQL errors creating variants: ${JSON.stringify(variantsResponse.data.errors)}`);
      }

      const variantsResult = variantsResponse.data.data.productVariantsBulkCreate;
      if (variantsResult.userErrors.length > 0) {
        throw new Error(`Variant creation errors: ${variantsResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
      }

      // Update shopProduct to include the created variants
      shopProduct.variants = {
        edges: variantsResult.productVariants.map(v => ({ node: v }))
      };
    }

    // Success logging
    const actionType = isUpdate ? 'UPDATED' : 'CREATED';
    console.log(`✅ ${actionType}: "${product.title}" (ID: ${shopProduct.id.replace('gid://shopify/Product/', '')}) - ${product.status}`);

    log.action({
      action: isUpdate ? 'updateProduct' : 'createProduct',
      id: shopProduct.id.replace('gid://shopify/Product/', ''),
      sku: primarySku,
      title: product.title,
      status: product.status,
      metafieldCount: metafields.length,
      variantsCount: variants.length,
      matchMethod: matchMethod,
      method: 'GraphQL'
    });

    // Update stats
    if (isUpdate) {
      STATS.updated++;
    } else {
      STATS.created++;
    }

    const desiredQuantities = new Map(
      variants.map(v => [String(v.sku || '').toUpperCase(), v.inventory_quantity])
    );

    let productDetails = null;
    try {
      productDetails = await fetchShopifyProductDetails(shopProduct.id);
    } catch (detailErr) {
      console.log(`  ⚠️  Failed to fetch product details for ${product.title}: ${detailErr.message}`);
    }

    if (productDetails) {
      // Refresh caches for subsequent iterations
      productStatusMap.set(productDetails.id, product.status);
      for (const variant of productDetails.variants || []) {
        if (!variant.sku) continue;
        skuMap.set(variant.sku.toUpperCase(), {
          productId: productDetails.id,
          variantId: variant.id,
          inventoryItemId: variant.inventory_item_id,
          imageId: variant.image_id || null
        });
      }

      if (colorImageMap && colorImageMap.size > 0) {
        const { assigned, skipped } = await assignVariantImagesForProduct(
          productDetails,
          colorImageMap,
          amrodData?.variants || [],
          product.title
        );
        if (assigned > 0) {
          console.log(`  🎨 Variant images assigned: ${assigned} (skipped ${skipped})`);
        }
      }
    }

    const variantPayload = productDetails && Array.isArray(productDetails.variants)
      ? productDetails.variants.map(v => ({
          id: v.id,
          sku: v.sku,
          inventory_item_id: v.inventory_item_id,
          inventory_quantity: desiredQuantities.get(String(v.sku || '').toUpperCase()) ?? v.inventory_quantity ?? 0
        }))
      : variants.map(v => {
          const skuKey = String(v.sku || '').toUpperCase();
          const cacheEntry = skuMap.get(skuKey);
          return {
            sku: v.sku,
            inventory_quantity: v.inventory_quantity,
            inventory_item_id: cacheEntry?.inventoryItemId || 'needs-lookup'
          };
        });

    const productIdReturn = productDetails?.id
      ? String(productDetails.id)
      : extractNumericIdFromGid(shopProduct.id) || existingId;

    return {
      id: productIdReturn,
      variants: variantPayload
    };

  } catch (err) {
    console2.error(product.title, primarySku, err.message);
    log.error(product.title, primarySku, err, {
      isUpdate,
      matchMethod,
      status: product.status
    });
    STATS.failed++;
    return null;
  }
}

//
// ——— INVENTORY LEVEL UPDATE ———
//
async function updateInventoryLevels(shopProduct) {
  if (!shopProduct || !shopProduct.variants || shopProduct.variants.length === 0) {
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const variant of shopProduct.variants) {
    if (!variant.inventory_item_id || variant.inventory_item_id === 'needs-lookup') {
      continue; // Skip if we don't have inventory item ID
    }

    try {
      const res = await fetch(
        `${SHOPIFY_BASE}/inventory_levels/set.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            location_id: SHOPIFY_LOCATION_ID,
            inventory_item_id: variant.inventory_item_id,
            available: variant.inventory_quantity || 0
          })
        }
      );

      if (!res.ok) {
        failureCount++;
      } else {
        successCount++;
      }
    } catch (err) {
      failureCount++;
    }
  }

  if (successCount > 0) {
    console.log(`📦 INVENTORY: Product ${shopProduct.id} - ${successCount}/${shopProduct.variants.length} variants updated`);
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
      failed: STATS.failed
    },
    statusBreakdown: STATS.statusBreakdown,
    promotions: STATS.promotions,
    validationIssues: STATS.validationIssues,
    dryRun: DRY_RUN
  };

  try {
    fs.writeFileSync(LOGS.SUMMARY, JSON.stringify(summary, null, 2));
  } catch (err) {
    console.warn(`⚠️  Unable to write summary log: ${err.message}`);
  }

  // Console summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎯 FINAL RESULTS:');
  console.log(`   ✅ Successful: ${STATS.created + STATS.updated}`);
  console.log(`   🆕 Created: ${STATS.created}`);
  console.log(`   🔄 Updated: ${STATS.updated}`);
  console.log(`   ❌ Failed: ${STATS.failed}`);
  console.log(`   ⏭️  Skipped: ${STATS.skipped}`);
  console.log(`   📊 Total Processed: ${STATS.total}`);
  console.log(`\n📊 STATUS BREAKDOWN:`);
  console.log(`   🟢 Active: ${STATS.statusBreakdown.active}`);
  console.log(`   📝 Draft: ${STATS.statusBreakdown.draft}`);
  console.log(`\n📈 PROMOTIONS:`);
  console.log(`   🏷️  On Promotion: ${STATS.promotions.onPromotion}`);
  console.log(`   ⭐ New Arrivals: ${STATS.promotions.newArrivals}`);
  console.log(`   🔥 Clearance: ${STATS.promotions.clearance}`);
  console.log(`   💎 Featured: ${STATS.promotions.featured}`);

  if (STATS.validationIssues.total > 0) {
    console.log(`\n⚠️  VALIDATION ISSUES: ${STATS.validationIssues.total}`);
    console.log(`   • No price: ${STATS.validationIssues.noPrice} products`);
    console.log(`   • No stock: ${STATS.validationIssues.noStock} products`);
    console.log(`   • Missing images: ${STATS.validationIssues.noImages} products`);
    console.log(`   • Missing description: ${STATS.validationIssues.noDescription} products`);
  }

  const successRate = STATS.total > 0
    ? Math.round(((STATS.created + STATS.updated) / STATS.total) * 100)
    : 0;
  console.log(`\n🎯 Success Rate: ${successRate}%`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY_RUN was ENABLED - No actual changes were made to Shopify');
  } else {
    console.log('\n✅ LIVE SYNC COMPLETED - Changes have been made to Shopify');
  }

  console.log(`\n📄 Detailed logs:`);
  console.log(`   • Actions: ${LOGS.ACTIONS}`);
  console.log(`   • Errors: ${LOGS.ERRORS}`);
  console.log(`   • Validation: ${LOGS.VALIDATION}`);
  console.log(`   • Status Changes: ${LOGS.STATUS_CHANGES}`);
  console.log(`   • Promotions: ${LOGS.PROMOTIONS}`);
  console.log(`   • Summary: ${LOGS.SUMMARY}`);
  console.log(`${'='.repeat(80)}\n`);
}

//
// ——— MAIN RUNNER ———
//
(async () => {
  try {
    console.log('🚀 Starting Amrod → Shopify sync v2.0...\n');

    ensureLogDirectories();

    // Fetch Shopify data in parallel (doesn't require Amrod auth)
    const [existingMaps, metafieldDefinitions] = await Promise.all([
      fetchExistingMaps(),
      fetchMetafieldDefinitions()
    ]);

    // Fetch Amrod data sequentially to avoid auth token conflicts
    const allAmrod = await fetchAllAmrod();
    const stockEntries = await fetchAllStock();
    const priceMap = await fetchAmrodPrices();
    const stockMap = new Map(stockEntries);

    if (!Array.isArray(allAmrod)) {
      console.error('❌ fetchAllAmrod() did not return an array:', allAmrod);
      return;
    }

    // Apply test limit if set (with optional offset)
    const TEST_OFFSET = process.env.TEST_OFFSET ? parseInt(process.env.TEST_OFFSET) : 0;
    const productsToProcess = TEST_LIMIT
      ? allAmrod.slice(TEST_OFFSET, TEST_OFFSET + TEST_LIMIT)
      : allAmrod;
    STATS.total = productsToProcess.length;

    console.log(`\n📋 SYNC SUMMARY:`);
    console.log(`   • Products fetched from Amrod: ${allAmrod.length}`);
    if (TEST_LIMIT) {
      console.log(`   • 🧪 TEST MODE: Processing only ${TEST_LIMIT} products`);
    }
    console.log(`   • Products to process: ${productsToProcess.length}`);
    console.log(`   • Stock entries loaded: ${stockEntries.length}`);
    console.log(`   • Price entries loaded: ${priceMap.size}`);
    console.log(`   • Existing products in Shopify: ${existingMaps.skuMap.size}`);
    console.log(`   • DRY RUN: ${DRY_RUN ? '✅ ENABLED (no changes will be made)' : '❌ DISABLED (changes will be made)'}`);
    console.log(`   • Markup: ${(MARKUP * 100).toFixed(0)}%`);
    console.log(`\n${'='.repeat(80)}`);
    console.log('🏃 PROCESSING PRODUCTS:\n');

    let processed = 0;

    for (const item of productsToProcess) {
      console.log(`\n[${processed + 1}/${productsToProcess.length}] Processing: "${item.productName || 'Unnamed Product'}"`);

      const payload = transformProduct(item, stockMap, priceMap, metafieldDefinitions);

      if (!payload) {
        STATS.skipped++;
        processed++;
        continue;
      }

      // Validate
      const validation = validateProduct(payload, item);
      if (!validation.valid) {
        log.validation(
          payload.variants[0]?.sku,
          payload.product.title,
          validation.issues
        );
        console2.skip('Failed validation', payload.product.title, payload.variants[0]?.sku);
        STATS.skipped++;
        processed++;
        continue;
      }

      // Log warnings
      if (validation.issues.length > 0) {
        log.validation(
          payload.variants[0]?.sku,
          payload.product.title,
          validation.issues
        );
      }

      // Upsert
      const shopProduct = await upsertToShopifyGraphQL(payload, existingMaps);

      if (shopProduct) {
        await updateInventoryLevels(shopProduct);
      }

      processed++;

      // Progress update every 25 products (or every 10 in test mode)
      const progressInterval = TEST_LIMIT ? 10 : 25;
      if (processed % progressInterval === 0 || processed === productsToProcess.length) {
        console.log(`\n${'─'.repeat(50)}`);
        console2.progress(processed, productsToProcess.length, STATS.created + STATS.updated, STATS.failed, STATS.skipped);
        console.log(`${'─'.repeat(50)}`);
      }
    }

    generateSummaryReport();

  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
    console.error('Stack trace:', err.stack);
    log.error('FATAL', 'N/A', err, { fatal: true });
  }
})();
