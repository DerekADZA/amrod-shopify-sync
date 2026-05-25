// sync.js - PATCHED VERSION

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
const ACTION_LOGPATH = path.resolve('logs', 'sync-actions.log');
const ERROR_LOGPATH  = path.resolve('logs', 'sync-errors.log');
const DRY_RUN        = false;   // ← set to false for real writes
const MARKUP         = 0.43;   // 43% markup

// Ensure log directories exist
for (const p of [ACTION_LOGPATH, ERROR_LOGPATH]) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Log helpers
const logAction = entry => {
  fs.appendFileSync(ACTION_LOGPATH, `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`);
};
const logError = entry => {
  fs.appendFileSync(ERROR_LOGPATH, `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`);
};

// ✅ NEW: Live console logging helpers
const logLive = {
  skip: (reason, title, sku) => {
    console.log(`⏭️  SKIP: ${reason} - "${title}" (SKU: ${sku || 'N/A'})`);
  },
  create: (title, sku, variantCount, metafieldCount) => {
    console.log(`🆕 CREATE: "${title}" (SKU: ${sku || 'N/A'}) - ${variantCount} variants, ${metafieldCount} metafields`);
  },
  update: (title, sku, matchMethod, variantCount, metafieldCount, optionSwap = false) => {
    const swapText = optionSwap ? ' [OPTIONS SWAPPED]' : '';
    console.log(`🔄 UPDATE: "${title}" (SKU: ${sku || 'N/A'}) via ${matchMethod} - ${variantCount} variants, ${metafieldCount} metafields${swapText}`);
  },
  error: (title, sku, error) => {
    console.log(`❌ ERROR: "${title}" (SKU: ${sku || 'N/A'}) - ${error}`);
  },
  progress: (current, total, successful, failed, skipped) => {
    const percentage = Math.round((current / total) * 100);
    console.log(`📊 Progress: ${current}/${total} (${percentage}%) - ✅${successful} 🔁${successful} ❌${failed} ⏭️${skipped}`);
  },
  inventory: (productId, variantCount, successCount) => {
    if (successCount === variantCount) {
      console.log(`📦 INVENTORY: Product ${productId} - All ${variantCount} variants updated`);
    } else {
      console.log(`⚠️  INVENTORY: Product ${productId} - ${successCount}/${variantCount} variants updated`);
    }
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
// ——— STOCK FETCH (TYPE 2 VARIANT ONLY) ———
//
async function fetchAllStock() {
  const token = await getAmrodToken();
  const url   = `${AMROD_BASE}/Stock/`;
  console.log(`🔍 Fetching stock (Type 2) from ${url}`);
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

  // Filter to only Type 2 and entries with a fullCode
  const variantStock = items.filter(s =>
    Number(s.stockType) === 2 && s.fullCode != null
  );

  // Map [ fullCode → stock ] pairs
  return variantStock.map(s => [
    String(s.fullCode).toUpperCase(),
    Number(s.stock)
  ]);
}

//
// ——— SHOPIFY EXISTING LOOKUPS ———
//
async function fetchExistingMaps() {
  console.log('🔍 Loading existing Shopify SKUs, handles & option orders…');
  const skuMap    = new Map();
  const handleMap = new Map();
  const optionOrderMap = new Map(); // ✅ NEW: Track existing option orders

  // Build SKU map & option order map
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
      if (v.sku) skuMap.set(v.sku.toUpperCase(), v.product_id);
    }
    const link = vRes.headers.get('link');
    const m = link?.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/);
    pageInfo = m?.[1] || null;
    if (pageInfo) vParams.set('page_info', pageInfo);
  } while (pageInfo);
  console.log(`  • Loaded ${skuMap.size} SKUs`);

  // Build handle map & collect option orders
  pageInfo = null;
  const pParams = new URLSearchParams({ limit: '250', fields: 'id,handle,options' });
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
      
      // ✅ NEW: Track existing option orders
      if (p.options && p.options.length >= 2) {
        const firstOption = p.options[0]?.name?.toLowerCase();
        const secondOption = p.options[1]?.name?.toLowerCase();
        if (firstOption && secondOption) {
          optionOrderMap.set(p.id, { 
            first: firstOption, 
            second: secondOption,
            needsSwap: firstOption.includes('size') && secondOption.includes('colour')
          });
        }
      }
    }
    const link = pRes.headers.get('link');
    const m = link?.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/);
    pageInfo = m?.[1] || null;
    if (pageInfo) pParams.set('page_info', pageInfo);
  } while (pageInfo);
  console.log(`  • Loaded ${handleMap.size} handles`);
  
  const needsSwap = Array.from(optionOrderMap.values()).filter(o => o.needsSwap).length;
  if (needsSwap > 0) {
    console.log(`  • Found ${needsSwap} products with Size→Colour order that need swapping`);
  }

  return { skuMap, handleMap, optionOrderMap };
}

//
// ——— IMPROVED TRANSFORM WITH OPTION ORDER HANDLING ———
//
function transformProduct(amrod, stockMap) {
  // ✅ NEW: Early validation and skip logging
  if (!amrod.productName) {
    logLive.skip('No product name', 'Unknown Product', amrod.productCode);
    return null;
  }
  
  if (!amrod.variants || amrod.variants.length === 0) {
    logLive.skip('No variants', amrod.productName, amrod.productCode);
    return null;
  }

  const product = {
    title:           amrod.productName,
    body_html:       amrod.description,
    vendor:          amrod.brand?.name || '',
    product_type:    amrod.type || '',
    tags:            amrod.categories?.map(c => c.name) || [],
    template_suffix: 'amrod-products',
    options:         [
      { name: 'Colour', position: 1 },
      { name: 'Size', position: 2 }
    ], // ✅ FIXED: Shopify expects array of objects, not strings
    images:          (amrod.images || []).map(i => ({ src: i.url }))
  };

  // ✅ FIXED: Ensure variants match the Colour→Size option order
  const variants = (amrod.variants || []).map(v => {
    const code  = v.fullCode.toUpperCase();
    const stock = stockMap.get(code) ?? v.stock;
    
    // ✅ FIXED: Handle invalid prices and ensure proper string formatting
    const rawPrice = v.price || 0;
    const calculatedPrice = calculatePrice(rawPrice);
    const costPrice = Number(rawPrice) || 0;
    
    return {
      sku:                  v.fullCode,
      option1:              v.colour,    // Colour = option1
      option2:              v.size,      // Size = option2  
      price:                calculatedPrice.toFixed(2),     // ✅ FIXED: Always string with 2 decimals
      cost:                 costPrice.toFixed(2),           // ✅ FIXED: Always string with 2 decimals
      inventory_management: 'shopify',
      inventory_quantity:   stock
    };
  });

  // ✅ IMPROVED: Better metafield filtering and prioritization
  const skip = new Set([
    'productName','description','brand',
    'type','categories','variants','images'
  ]);
  
  // Prioritize important fields first
  const priorityFields = ['productCode', 'weight', 'dimensions', 'material', 'brand'];
  const typeMap = {
    string: 'single_line_text_field',
    number: 'number_integer', 
    boolean: 'boolean',
    object: 'json'
  };

  const metafields = [];
  
  // Add priority fields first
  priorityFields.forEach(key => {
    if (amrod[key] != null && !skip.has(key)) {
      const val = amrod[key];
      const rawType = (val !== null && typeof val === 'object') ? 'object' : typeof val;
      metafields.push({
        namespace: 'amrod',
        key: key.toLowerCase(),
        type: typeMap[rawType] || 'single_line_text_field',
        value: rawType === 'object' ? JSON.stringify(val) : String(val)
      });
    }
  });

  // Add remaining fields (limit to prevent API overload)
  Object.entries(amrod).forEach(([key, val]) => {
    if (!skip.has(key) && !priorityFields.includes(key) && metafields.length < 15) {
      const rawType = (val !== null && typeof val === 'object') ? 'object' : typeof val;
      metafields.push({
        namespace: 'amrod',
        key: key.toLowerCase(),
        type: typeMap[rawType] || 'single_line_text_field',
        value: rawType === 'object' ? JSON.stringify(val) : String(val)
      });
    }
  });

  return { product, variants, metafields };
}

//
// ——— GRAPHQL UPSERT VERSION (MORE EFFICIENT) ———
//
async function upsertToShopifyGraphQL(payload, maps) {
  const { skuMap, handleMap, optionOrderMap } = maps;
  const { product, variants, metafields } = payload;
  const primarySku = variants[0]?.sku.toUpperCase();

  let existingId = primarySku ? skuMap.get(primarySku) : null;
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

  // Check option order swap
  let needsOptionSwap = false;
  if (existingId && optionOrderMap.has(existingId)) {
    const existing = optionOrderMap.get(existingId);
    needsOptionSwap = existing.needsSwap;
    if (needsOptionSwap) {
      console.log(`🔄 Detected Size→Colour order in "${product.title}", will swap to Colour→Size`);
      variants.forEach(v => {
        const temp = v.option1;
        v.option1 = v.option2;
        v.option2 = temp;
      });
    }
  }

  const isUpdate = !!existingId;
  
  // Live logging
  if (isUpdate) {
    logLive.update(product.title, primarySku, matchMethod, variants.length, metafields.length, needsOptionSwap);
  } else {
    logLive.create(product.title, primarySku, variants.length, metafields.length);
  }

  if (DRY_RUN) {
    const actionType = isUpdate ? 'UPDATE' : 'CREATE';
    console.log(`[DRY RUN] Would ${actionType} "${product.title}"`);
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
      // GraphQL Product Update Mutation
      const updateMutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              title
              variants(first: 250) {
                edges {
                  node {
                    id
                    sku
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // ✅ FIXED: Better metafield handling - only use simple text fields
      const graphqlMetafields = metafields.map(mf => ({
        namespace: mf.namespace,
        key: mf.key,
        type: 'single_line_text_field', // ✅ Always use text to avoid conflicts
        value: typeof mf.value === 'object' ? JSON.stringify(mf.value) : String(mf.value)
      }));

      // Convert variants to GraphQL format  
      const graphqlVariants = variants.map(v => ({
        sku: v.sku,
        option1: v.option1,
        option2: v.option2,
        price: v.price,
        cost: v.cost,
        inventoryManagement: 'SHOPIFY',
        inventoryQuantities: [{
          locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`,
          availableQuantity: v.inventory_quantity
        }]
      }));

      const updateInput = {
        id: `gid://shopify/Product/${existingId}`,
        title: product.title,
        descriptionHtml: product.body_html,
        vendor: product.vendor,
        productType: product.product_type,
        tags: product.tags,
        templateSuffix: product.template_suffix,
        options: product.options.map((opt, index) => ({
          name: opt.name,
          position: index + 1
        })),
        variants: graphqlVariants,
        metafields: graphqlMetafields
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
        throw new Error(`Product update errors: ${result.userErrors.map(e => e.message).join(', ')}`);
      }

      shopProduct = result.product;

    } else {
      // GraphQL Product Create Mutation  
      const createMutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product {
              id
              title
              variants(first: 250) {
                edges {
                  node {
                    id
                    sku
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const graphqlMetafields = metafields.map(mf => ({
        namespace: mf.namespace,
        key: mf.key,
        type: 'single_line_text_field', // ✅ Always use text to avoid conflicts
        value: typeof mf.value === 'object' ? JSON.stringify(mf.value) : String(mf.value)
      }));

      const graphqlVariants = variants.map(v => ({
        sku: v.sku,
        option1: v.option1,
        option2: v.option2,
        price: v.price,
        cost: v.cost,
        inventoryManagement: 'SHOPIFY',
        inventoryQuantities: [{
          locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`,
          availableQuantity: v.inventory_quantity
        }]
      }));

      const createInput = {
        title: product.title,
        descriptionHtml: product.body_html,
        vendor: product.vendor,
        productType: product.product_type,
        tags: product.tags,
        templateSuffix: product.template_suffix,
        options: product.options.map((opt, index) => ({
          name: opt.name,
          position: index + 1
        })),
        variants: graphqlVariants,
        metafields: graphqlMetafields
      };

      const response = await client.post('/graphql.json', {
        query: createMutation,
        variables: { input: createInput }
      });

      if (response.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      const result = response.data.data.productCreate;
      if (result.userErrors.length > 0) {
        throw new Error(`Product create errors: ${result.userErrors.map(e => e.message).join(', ')}`);
      }

      shopProduct = result.product;
    }

    // Success logging
    const actionType = isUpdate ? 'UPDATED' : 'CREATED';
    const swapNote = needsOptionSwap ? ' [OPTIONS SWAPPED]' : '';
    console.log(`✅ ${actionType}: "${product.title}" (ID: ${shopProduct.id.replace('gid://shopify/Product/', '')})${swapNote}`);
    
    logAction({
      action: isUpdate ? 'updateProduct' : 'createProduct',
      id: shopProduct.id.replace('gid://shopify/Product/', ''),
      sku: primarySku,
      title: product.title,
      metafieldsCount: metafields.length,
      variantsCount: variants.length,
      optionSwapped: needsOptionSwap,
      matchMethod: matchMethod,
      method: 'GraphQL'
    });

    // Convert GraphQL response to REST-like format for inventory updates
    const restLikeProduct = {
      id: shopProduct.id.replace('gid://shopify/Product/', ''),
      variants: shopProduct.variants.edges.map(edge => ({
        id: edge.node.id.replace('gid://shopify/ProductVariant/', ''),
        sku: edge.node.sku,
        inventory_item_id: edge.node.inventoryItem.id.replace('gid://shopify/InventoryItem/', ''),
        inventory_quantity: variants.find(v => v.sku === edge.node.sku)?.inventory_quantity || 0
      }))
    };

    return restLikeProduct;

  } catch (err) {
    logLive.error(product.title, primarySku, err.message);
    logError({
      action: 'syncError',
      sku: primarySku,
      title: product.title,
      error: err.message,
      metafieldsCount: metafields.length,
      method: 'GraphQL'
    });
    return null;
  }
}

//
// ——— IMPROVED UPSERT WITH METAFIELDS & OPTION ORDER CHECKING ———
//
async function upsertToShopify(payload, maps) {
  const { skuMap, handleMap, optionOrderMap } = maps;
  const { product, variants, metafields } = payload;
  const primarySku = variants[0]?.sku.toUpperCase();

  let existingId  = primarySku ? skuMap.get(primarySku) : null;
  let matchMethod = existingId ? 'SKU' : null;

  // Fallback by handle
  if (!existingId) {
    const handle = product.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (handleMap.has(handle)) {
      existingId  = handleMap.get(handle);
      matchMethod = 'handle';
    }
  }

  // ✅ NEW: Check if existing product needs option order swap
  let needsOptionSwap = false;
  if (existingId && optionOrderMap.has(existingId)) {
    const existing = optionOrderMap.get(existingId);
    needsOptionSwap = existing.needsSwap;
    if (needsOptionSwap) {
      console.log(`🔄 Detected Size→Colour order in "${product.title}", will swap to Colour→Size`);
      // Swap variant option values to match new order
      variants.forEach(v => {
        const temp = v.option1;
        v.option1 = v.option2;  // Size becomes option1 temporarily
        v.option2 = temp;       // Colour becomes option2 temporarily
        // But we want Colour→Size, so swap back:
        const finalTemp = v.option1;
        v.option1 = v.option2;  // Colour = option1 ✅
        v.option2 = finalTemp;  // Size = option2 ✅
      });
    }
  }

  const isUpdate = !!existingId;
  
  // ✅ NEW: Live logging before action
  if (isUpdate) {
    logLive.update(product.title, primarySku, matchMethod, variants.length, metafields.length, needsOptionSwap);
  } else {
    logLive.create(product.title, primarySku, variants.length, metafields.length);
  }

  if (DRY_RUN) {
    const actionType = isUpdate ? 'UPDATE' : 'CREATE';
    const swapNote = needsOptionSwap ? ' + option swap' : '';
    console.log(`[DRY RUN] Would ${actionType} "${product.title}"${swapNote}`);
    logAction({ 
      action: `dryRun${actionType}`, 
      sku: primarySku, 
      title: product.title, 
      metafieldsCount: metafields.length,
      optionSwapped: needsOptionSwap
    });
    return { id: 'dry-run', variants: variants.map(v => ({ ...v, inventory_item_id: 'dry-run' })) };
  }

  try {
    let shopProduct;
    let res;

    // ✅ IMPROVED: Include metafields in main product request (more efficient)
    const productWithMetafields = {
      ...product,
      variants,
      metafields: metafields  // Include all metafields in single request
    };

    if (existingId) {
      res = await fetch(`${SHOPIFY_BASE}/products/${existingId}.json`, {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          product: { 
            id: existingId, 
            ...productWithMetafields 
          } 
        })
      });
    } else {
      res = await fetch(`${SHOPIFY_BASE}/products.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ product: productWithMetafields })
      });
    }

    // ✅ FIXED: Proper error checking
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Shopify API error ${res.status}: ${errorText}`);
    }

    const responseData = await res.json();
    
    // ✅ FIXED: Validate response structure
    if (!responseData || !responseData.product) {
      throw new Error(`Invalid Shopify response: ${JSON.stringify(responseData)}`);
    }
    
    shopProduct = responseData.product;

    // ✅ NEW: Success confirmation
    const actionType = isUpdate ? 'UPDATED' : 'CREATED';
    const swapNote = needsOptionSwap ? ' [OPTIONS SWAPPED]' : '';
    console.log(`✅ ${actionType}: "${product.title}" (ID: ${shopProduct.id})${swapNote}`);
    
    logAction({
      action: isUpdate ? 'updateProduct' : 'createProduct',
      id: shopProduct.id,
      sku: primarySku,
      title: product.title,
      metafieldsCount: metafields.length,
      variantsCount: variants.length,
      optionSwapped: needsOptionSwap,
      matchMethod: matchMethod
    });

    return shopProduct;
  } catch (err) {
    logLive.error(product.title, primarySku, err.message);
    logError({
      action: 'syncError',
      sku: primarySku,
      title: product.title,
      error: err.message,
      metafieldsCount: metafields.length
    });
    return null;
  }
}

//
// ——— INVENTORY LEVEL UPDATE WITH LOGGING ———
//
async function updateInventoryLevels(shopProduct) {
  if (!shopProduct.variants || shopProduct.variants.length === 0) {
    console.log(`⚠️  No variants found for product ${shopProduct.id}`);
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const variant of shopProduct.variants) {
    if (!variant.inventory_item_id) {
      console.log(`⚠️  No inventory_item_id for variant ${variant.id || variant.sku}`);
      failureCount++;
      continue;
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
        const errorText = await res.text();
        console.log(`⚠️  Inventory update failed for variant ${variant.sku}: ${errorText}`);
        failureCount++;
      } else {
        successCount++;
      }
    } catch (err) {
      console.log(`⚠️  Inventory error for variant ${variant.sku}: ${err.message}`);
      failureCount++;
    }
  }

  // Live inventory update logging
  logLive.inventory(shopProduct.id, shopProduct.variants.length, successCount);
  
  if (failureCount > 0) {
    logError({
      action: 'inventoryErrors',
      productId: shopProduct.id,
      successCount: successCount,
      failureCount: failureCount
    });
  }
}

//
// ——— MAIN RUNNER ———
//
(async () => {
  try {
    console.log('🚀 Starting Amrod → Shopify sync...\n');
    
    const [allAmrod, stockEntries, existingMaps] = await Promise.all([
      fetchAllAmrod(),
      fetchAllStock(), 
      fetchExistingMaps()
    ]);
    const stockMap = new Map(stockEntries);

    if (!Array.isArray(allAmrod)) {
      console.error('❌ fetchAllAmrod() did not return an array:', allAmrod);
      return;
    }

    console.log(`\n📋 SYNC SUMMARY:`);
    console.log(`   • Products to process: ${allAmrod.length}`);
    console.log(`   • Stock entries loaded: ${stockEntries.length}`);
    console.log(`   • Existing SKUs in Shopify: ${existingMaps.skuMap.size}`);
    console.log(`   • Existing handles in Shopify: ${existingMaps.handleMap.size}`);
    console.log(`   • DRY RUN: ${DRY_RUN ? '✅ ENABLED (no changes will be made)' : '❌ DISABLED (changes will be made)'}`);
    console.log(`\n${'='.repeat(80)}`);
    console.log('🏃 PROCESSING PRODUCTS:\n');

    let processed = 0;
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of allAmrod) {
      console.log(`\n[${processed + 1}/${allAmrod.length}] Processing: "${item.productName || 'Unnamed Product'}"`);
      
      const payload = transformProduct(item, stockMap);
      
      // Handle skipped products
      if (!payload) {
        skipped++;
        processed++;
        continue;
      }
      
      // ✅ CHANGED: Use GraphQL version instead of REST
      const shopProduct = await upsertToShopifyGraphQL(payload, existingMaps);
      
      if (shopProduct) {
        // GraphQL version handles inventory in the same call, but let's keep this for safety
        await updateInventoryLevels(shopProduct);
        successful++;
      } else {
        failed++;
      }
      
      processed++;
      
      // Show progress every 25 products or at the end
      if (processed % 25 === 0 || processed === allAmrod.length) {
        console.log(`\n${'─'.repeat(50)}`);
        logLive.progress(processed, allAmrod.length, successful, failed, skipped);
        console.log(`${'─'.repeat(50)}`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('🎯 FINAL RESULTS:');
    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📊 Total Processed: ${processed}/${allAmrod.length}`);
    
    const successRate = Math.round((successful / (processed - skipped)) * 100);
    console.log(`   🎯 Success Rate: ${successRate}% (excluding skipped)`);
    
    if (DRY_RUN) {
      console.log('\n🧪 DRY_RUN was ENABLED - No actual changes were made to Shopify');
      console.log('   Set DRY_RUN = false to perform real sync');
    } else {
      console.log('\n✅ LIVE SYNC COMPLETED - Changes have been made to Shopify');
    }
    
    console.log(`\n📄 Check logs for details:`);
    console.log(`   • Actions: ${ACTION_LOGPATH}`);
    console.log(`   • Errors: ${ERROR_LOGPATH}`);
    console.log(`${'='.repeat(80)}\n`);
    
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
    console.error('Stack trace:', err.stack);
    logError({ action: 'fatal', error: err.message, stack: err.stack });
  }
})();