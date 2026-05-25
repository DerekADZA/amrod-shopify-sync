// assign-variant-images.js
  // Assign Color-Specific Images to Product Variants
  // Version: 1.1

  import 'dotenv/config';
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
  const REASSIGN_EXISTING = process.env.REASSIGN_EXISTING === 'true' || process.argv.includes('--reassign') ||
  process.argv.includes('--force');

  // Log paths
  const LOG_DIR = path.resolve('logs');
  const LOGS = {
  ACTIONS: path.join(LOG_DIR, 'variant-image-assignment-actions.log'),
  ERRORS: path.join(LOG_DIR, 'variant-image-assignment-errors.log'),
  SUMMARY: path.join(LOG_DIR, 'variant-image-assignment-summary.json')
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

function normalizeSkuKey(value) {
  return (value || '')
    .toString()
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function stripTrailingZeroSegments(code) {
  const normalized = normalizeSkuKey(code);
  if (!normalized) return '';
  const segments = normalized.split('-');
  while (segments.length > 1 && /^0+$/.test(segments[segments.length - 1])) {
    segments.pop();
  }
  return segments.join('-');
}

function normalizeSizeStr(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function addVariantKey(map, key, entry) {
  const normalized = normalizeSkuKey(key);
  if (!normalized) return;
  if (!map.has(normalized)) {
    map.set(normalized, [entry]);
    return;
  }
  const arr = map.get(normalized);
  if (!arr.includes(entry)) {
    arr.push(entry);
  }
}

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
    console.warn(`⚠️ Failed to write log entry to ${filePath}: ${err.message}`);
  }
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
        reassignExisting: REASSIGN_EXISTING,
        stats: STATS
      };

      try {
        fs.writeFileSync(LOGS.SUMMARY, JSON.stringify(summary, null, 2));
      } catch (err) {
        console.warn(`⚠️ Failed to write summary log: ${err.message}`);
      }
      return summary;
  }
  };

  // ——— FETCH WITH TIMEOUT (Node 18+ global fetch) ———
  async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
      return await fetch(url, { ...options, signal: controller.signal });
  } finally {
      clearTimeout(id);
  }
  }

  // ——— SHOPIFY GRAPHQL REQUEST WITH BACKOFF ———
  async function shopifyGraphql(query, variables = {}, { maxRetries = 5, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
      attempt++;
      try {
        const res = await fetchWithTimeout(`${SHOPIFY_BASE}/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query, variables })
        }, 120000);

        // Handle HTTP throttling
        if (res.status === 429) {
          const retryAfter = parseFloat(res.headers.get('Retry-After') || '0') || 2;
          const waitMs = Math.min(10000, retryAfter * 1000 * attempt);
          console.log(`  ⏳ Throttled (HTTP 429). Waiting ${Math.round(waitMs)}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
          if (attempt <= maxRetries) continue;
        }

        if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

        const json = await res.json();

        // GraphQL-level errors
        if (json.errors) {
          const msg = JSON.stringify(json.errors);
          if (/throttl/i.test(msg) && attempt <= maxRetries) {
            const waitMs = Math.min(10000, baseDelayMs * attempt);
            console.log(`  ⏳ GraphQL throttle hint. Waiting ${waitMs}ms...`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          throw new Error(`GraphQL errors: ${msg}`);
        }

        // Soft pacing if cost is low
        const throttle = json.extensions?.cost?.throttleStatus;
        if (throttle) {
          const { currentlyAvailable, restoreRate } = throttle;
          if (currentlyAvailable < 50 && restoreRate) {
            const waitMs = Math.min(1500, ((50 - currentlyAvailable) / restoreRate) * 1000);
            if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
          }
        }

        return json.data;
      } catch (e) {
        if (attempt >= maxRetries) throw e;
        const waitMs = Math.min(8000, baseDelayMs * 2 ** (attempt - 1));
        console.log(`  ⏳ Retry ${attempt}/${maxRetries} after error: ${e.message}. Waiting ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
  }
  }

  // ——— AMROD API - AUTHENTICATION ———
  let AMROD_TOKEN = null;
  let AMROD_TOKEN_EXPIRY = null;

  async function getAmrodAuthToken() {
  if (AMROD_TOKEN && AMROD_TOKEN_EXPIRY && Date.now() < AMROD_TOKEN_EXPIRY) {
      return AMROD_TOKEN;
  }

  console.log('🔐 Authenticating with Amrod API...');

  const authUrl = 'https://identity.amrod.co.za/VendorLogin';
  const response = await fetchWithTimeout(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        UserName: AMROD_EMAIL,
        Password: AMROD_PASSWORD,
        CustomerCode: AMROD_CUSTOMER_CODE
      })
  }, 120000);

  if (!response.ok) {
      throw new Error(`Amrod auth failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  AMROD_TOKEN = data.token;
  AMROD_TOKEN_EXPIRY = Date.now() + (50 * 60 * 1000); // 50 minutes

  console.log('  ✅ Authenticated successfully');
  return AMROD_TOKEN;
  }

  // ——— AMROD API - FETCH PRODUCTS AND BUILD VARIANT MAP ———
  async function fetchAmrodProducts() {
  console.log('\n📦 Fetching products from Amrod API...');

  const token = await getAmrodAuthToken();
  const url = 'https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding';

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  📡 Attempt ${attempt}/3...`);

        const response = await fetchWithTimeout(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }, 120000);

        if (!response.ok) {
          throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
        }

        const products = await response.json();

        const index = {
          byKey: new Map(),
          totalVariants: 0
        };

        for (const product of products) {
          const colourImages = Array.isArray(product.colourImages) ? product.colourImages : [];
          const variants = Array.isArray(product.variants) ? product.variants : [];
          if (variants.length === 0 || colourImages.length === 0) continue;

          for (const variant of variants) {
            if (!variant) continue;
            const entry = buildAmrodVariantEntry(product, variant, colourImages);
            if (!entry) continue;

            addVariantKey(index.byKey, variant.fullCode, entry);

            const normalizedFull = normalizeSkuKey(variant.fullCode);
            const strippedFull = stripTrailingZeroSegments(normalizedFull);
            if (strippedFull && strippedFull !== normalizedFull) {
              addVariantKey(index.byKey, strippedFull, entry);
            }

            addVariantKey(index.byKey, variant.simpleCode, entry);

            const normalizedSimple = normalizeSkuKey(variant.simpleCode);
            const strippedSimple = stripTrailingZeroSegments(normalizedSimple);
            if (strippedSimple && strippedSimple !== normalizedSimple) {
              addVariantKey(index.byKey, strippedSimple, entry);
            }

            addVariantKey(index.byKey, product.simpleCode, entry);
            addVariantKey(index.byKey, product.productCode, entry);
            addVariantKey(index.byKey, product.fullCode, entry);

            index.totalVariants++;
          }
        }

        console.log(`  ✅ Indexed ${index.totalVariants} Amrod variants across ${index.byKey.size} lookup keys`);
        return index;

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

  // ——— SHOPIFY - FETCH PRODUCTS WITH VARIANTS AND IMAGES ———
  async function fetchShopifyProducts() {
  console.log('\n🛍️  Fetching products from Shopify...');

  const products = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
      const query = `
        query ($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                media(first: 250) {
                  pageInfo { hasNextPage endCursor }
                  edges {
                    node {
                      ... on MediaImage { id image { id url } }
                    }
                  }
                }
                images(first: 250) {
                  pageInfo { hasNextPage endCursor }
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
                      selectedOptions { name value }
                      image { id }
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

      const data = await shopifyGraphql(query, variables);

      products.push(...data.products.edges.map(e => e.node));
      hasNextPage = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;
  }

  console.log(`  ✅ Loaded ${products.length} products from Shopify`);
  return products;
  }

  // Fetch all media for a single product if it exceeds first page (rare; 250 limit)
  async function fetchAllMediaForProduct(productId, initialMedia) {
  const edges = [...(initialMedia?.edges || [])];
  const pageInfo = initialMedia?.pageInfo;
  if (!pageInfo?.hasNextPage) return edges;

  let after = pageInfo.endCursor;
  while (true) {
      const query = `
        query($id: ID!, $after: String) {
          product(id: $id) {
            id
            media(first: 250, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges { node { ... on MediaImage { id image { id url } } } }
            }
          }
        }
      `;
      const variables = { id: productId, after };
      const data = await shopifyGraphql(query, variables);
      const media = data.product.media;
      edges.push(...media.edges);
      if (!media.pageInfo.hasNextPage) break;
      after = media.pageInfo.endCursor;
      await new Promise(r => setTimeout(r, 300));
  }

  return edges;
  }

  async function fetchAllImagesForProduct(productId, initialImages) {
  const edges = [...(initialImages?.edges || [])];
  const pageInfo = initialImages?.pageInfo;
  if (!pageInfo?.hasNextPage) return edges;

  let after = pageInfo.endCursor;
  while (true) {
      const query = `
        query($id: ID!, $after: String) {
          product(id: $id) {
            id
            images(first: 250, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges { node { id url } }
            }
          }
        }
      `;
      const variables = { id: productId, after };
      const data = await shopifyGraphql(query, variables);
      const images = data.product.images;
      edges.push(...images.edges);
      if (!images.pageInfo.hasNextPage) break;
      after = images.pageInfo.endCursor;
      await new Promise(r => setTimeout(r, 300));
  }

  return edges;
  }

  function basenameWithoutExtAndSize(filename) {
  const base = filename.split('?')[0].toLowerCase();
  const noExt = base.replace(/.(jpg|jpeg|png|gif|webp)$/i, '');
  return noExt.replace(/([_-])\d{2,4}x\d{2,4}$/, '');
  }

function normalizeColorStr(str) {
  return (str || '')
      .toString()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
}

function addColorToken(set, value) {
  if (value == null) return;
  const normalized = normalizeColorStr(value);
  if (normalized) set.add(normalized);
  const upper = normalizeSkuKey(value);
  if (upper) set.add(upper);
}

function addSizeToken(set, value) {
  if (value == null) return;
  const raw = value.toString().trim();
  if (!raw) return;
  set.add(raw.toUpperCase());
  const normalized = normalizeSizeStr(raw);
  if (normalized) set.add(normalized);
}

function buildShopifyImageCatalog(mediaEdges = [], imageEdges = []) {
  const byBase = new Map();

  const normalizeBaseFromUrl = (url) => {
    if (!url) return '';
    const file = url.split('/').pop() || '';
    return basenameWithoutExtAndSize(file);
  };

  const ensureEntry = (base) => {
    if (!base) return null;
    if (!byBase.has(base)) {
      byBase.set(base, {
        base,
        productImageId: null,
        mediaImageId: null,
        urls: new Set()
      });
    }
    return byBase.get(base);
  };

  for (const edge of imageEdges) {
    const node = edge?.node;
    if (!node?.url) continue;
    const base = normalizeBaseFromUrl(node.url);
    const entry = ensureEntry(base);
    if (!entry) continue;
    entry.productImageId = entry.productImageId || node.id;
    entry.urls.add(node.url);
  }

  for (const edge of mediaEdges) {
    const node = edge?.node;
    const url = node?.image?.url || node?.previewImage?.url;
    const base = normalizeBaseFromUrl(url);
    const entry = ensureEntry(base);
    if (!entry) continue;
    entry.mediaImageId = entry.mediaImageId || node.id;
    if (url) entry.urls.add(url);
  }

  return Array.from(byBase.values()).map(entry => ({
    base: entry.base,
    productImageId: entry.productImageId,
    mediaImageId: entry.mediaImageId,
    url: entry.urls.values().next().value || null
  }));
}

function buildAmrodVariantEntry(product, variant, colourImages) {
  const productName = product?.productName || product?.name || product?.title || '';
  const imagesArray = Array.isArray(colourImages) ? colourImages : [];

  const colorTokens = new Set();
  const sizeTokens = new Set();

  const variantColourCode = normalizeSkuKey(variant?.colourCode);
  const variantColourName = variant?.colourCodeName;
  addColorToken(colorTokens, variantColourCode);
  addColorToken(colorTokens, variantColourName);

  const variantSizeCode = variant?.codeSize;
  const variantSizeName = variant?.codeSizeName;
  addSizeToken(sizeTokens, variantSizeCode);
  addSizeToken(sizeTokens, variantSizeName);

  let matchedColourGroup = null;
  if (variantColourCode) {
    matchedColourGroup = imagesArray.find(group => normalizeSkuKey(group?.code) === variantColourCode) || null;
  }

  if (!matchedColourGroup && variantColourName) {
    const target = normalizeColorStr(variantColourName);
    matchedColourGroup = imagesArray.find(group => normalizeColorStr(group?.description || group?.name) === target) || null;
  }

  if (!matchedColourGroup) {
    const variantFull = normalizeSkuKey(variant?.fullCode);
    matchedColourGroup = imagesArray.find(group => {
      const codeMatch = normalizeSkuKey(group?.code);
      if (codeMatch && variantFull.includes(`-${codeMatch}`)) return true;
      const nameMatch = normalizeColorStr(group?.name);
      if (nameMatch && variantFull.includes(`-${nameMatch.toUpperCase()}`)) return true;
      return false;
    }) || null;
  }

  if (matchedColourGroup) {
    addColorToken(colorTokens, matchedColourGroup.code);
    addColorToken(colorTokens, matchedColourGroup.name);
    addColorToken(colorTokens, matchedColourGroup.description);
  }

  return {
    variant,
    colourImages: imagesArray,
    productName,
    colorTokens,
    sizeTokens,
    availableColourCodes: imagesArray
      .map(group => group?.code)
      .filter(code => typeof code === 'string' && code.trim().length > 0)
  };
}

function extractShopifyVariantOptions(selectedOptions = []) {
  const result = {
    colorRaw: null,
    colorNorm: null,
    sizeRaw: null,
    sizeNorm: null
  };

  for (const option of selectedOptions) {
    const name = option?.name || '';
    const value = option?.value;
    if (value == null) continue;

    if (/colou?r|colour|color/i.test(name)) {
      result.colorRaw = value;
      result.colorNorm = normalizeColorStr(value);
    } else if (/size|waist|length/i.test(name)) {
      result.sizeRaw = value;
      result.sizeNorm = normalizeSizeStr(value);
    }
  }

  return result;
}

function scoreAmrodCandidate(entry, context) {
  const skuKey = context.skuKey;
  const options = context.options;
  let score = 0;

  const fullCode = normalizeSkuKey(entry?.variant?.fullCode);
  const simpleCode = normalizeSkuKey(entry?.variant?.simpleCode);

  if (skuKey && fullCode === skuKey) score += 8;
  if (skuKey && stripTrailingZeroSegments(fullCode) === skuKey) score += 6;
  if (skuKey && simpleCode === skuKey) score += 5;

  if (options.colorNorm && entry.colorTokens.has(options.colorNorm)) score += 4;
  const colorUpper = options.colorRaw ? normalizeSkuKey(options.colorRaw) : '';
  if (colorUpper && entry.colorTokens.has(colorUpper)) score += 2;

  if (options.sizeNorm && entry.sizeTokens.has(options.sizeNorm)) score += 2;
  const sizeUpper = options.sizeRaw ? options.sizeRaw.toString().trim().toUpperCase() : '';
  if (sizeUpper && entry.sizeTokens.has(sizeUpper)) score += 1;

  return score;
}

function prepareAmrodCandidates(shopifyVariant, amrodIndex) {
  const skuKey = normalizeSkuKey(shopifyVariant?.sku);
  const options = extractShopifyVariantOptions(shopifyVariant?.selectedOptions || []);

  const candidates = [];
  const seen = new Set();

  const addEntriesForKey = (key) => {
    const normalized = normalizeSkuKey(key);
    if (!normalized) return;
    const entries = amrodIndex.byKey.get(normalized);
    if (!entries) return;
    for (const entry of entries) {
      if (!seen.has(entry)) {
        seen.add(entry);
        candidates.push(entry);
      }
    }
  };

  addEntriesForKey(skuKey);
  const stripped = stripTrailingZeroSegments(skuKey);
  if (stripped && stripped !== skuKey) {
    addEntriesForKey(stripped);
  }

  if (!candidates.length && skuKey.includes('-')) {
    const segments = skuKey.split('-');
    while (segments.length > 1) {
      segments.pop();
      addEntriesForKey(segments.join('-'));
      if (candidates.length) break;
    }
  }

  const scored = candidates
    .map(entry => ({
      entry,
      score: scoreAmrodCandidate(entry, { skuKey, options })
    }))
    .sort((a, b) => b.score - a.score);

  return {
    candidates: scored.map(item => item.entry),
    options
  };
}

// ——— MATCH VARIANT TO COLOR IMAGE ———
function matchVariantToColorImage(shopifyVariant, amrodVariant, colourImages, imageCatalog) {
  const catalog = Array.isArray(imageCatalog) ? imageCatalog : [];

  const fullCode = (amrodVariant.fullCode || '').trim();
  const segments = fullCode.split('-');
  const colorCodeFromSKU = segments[segments.length - 1];
  const variantColorCode = (amrodVariant.colourCode || colorCodeFromSKU || '').toUpperCase().trim();
  if (!variantColorCode) return null;

  // Prefer a direct match on colourImages code
  let matchedColorImages = null;
  for (const colorGroup of colourImages) {
      const code = (colorGroup.code || '').toUpperCase().trim();
      if (code && code === variantColorCode) {
        matchedColorImages = colorGroup.images;
        break;
      }
  }

  const findShopifyImageByAmrodUrl = (amrodUrl) => {
      if (!amrodUrl) return null;
      const amrodFile = amrodUrl.split('/').pop() || '';
      const amrodBase = basenameWithoutExtAndSize(amrodFile);

      return catalog.find(entry => {
        if (!entry?.base) return false;
        return entry.base.includes(amrodBase) || amrodBase.includes(entry.base);
      }) || null;
  };

  // If we have a matched color group, try its first image
  if (matchedColorImages && matchedColorImages.length > 0) {
      const amrodImageUrl = matchedColorImages[0]?.urls?.[0]?.url || null;
      const entry = findShopifyImageByAmrodUrl(amrodImageUrl);
      if (entry && (entry.productImageId || entry.mediaImageId)) return entry;
  }

  // Fallback 1: try matching by fullCode in the Shopify filenames
  if (fullCode) {
      const fullCodeLower = fullCode.toLowerCase();
      const entry = catalog.find(img => img.base && img.base.includes(fullCodeLower));
      if (entry && (entry.productImageId || entry.mediaImageId)) return entry;
  }

  // Fallback 2: attempt to match by color name from variant selected options
  const colorOption = shopifyVariant.selectedOptions?.find(o => /colou?r/i.test(o.name || ''));
  if (colorOption?.value) {
      const vColorNorm = normalizeColorStr(colorOption.value);
      for (const colorGroup of colourImages) {
        const codeNorm = normalizeColorStr(colorGroup.code);
        const nameNorm = normalizeColorStr(colorGroup.description || colorGroup.name || '');
        if ((codeNorm && codeNorm === vColorNorm) || (nameNorm && nameNorm === vColorNorm)) {
          const url = colorGroup?.images?.[0]?.urls?.[0]?.url;
          const entry = findShopifyImageByAmrodUrl(url);
          if (entry && (entry.productImageId || entry.mediaImageId)) return entry;
        }
      }
  }

  // Fallback 3: scan all colour groups for the first Amrod image that exists in Shopify
  for (const colorGroup of colourImages) {
      const amrodUrl = colorGroup?.images?.[0]?.urls?.[0]?.url;
      const entry = findShopifyImageByAmrodUrl(amrodUrl);
      if (entry && (entry.productImageId || entry.mediaImageId)) return entry;
  }

  return null;
  }

function extractNumericIdFromGid(gid) {
  if (!gid) return null;
  const match = gid.toString().match(/\/(\d+)(?:\?.*)?$/);
  return match ? match[1] : null;
}

async function assignVariantImageViaRest(variantGid, productImageGid) {
  const variantIdNumeric = extractNumericIdFromGid(variantGid);
  const imageIdNumeric = extractNumericIdFromGid(productImageGid);
  if (!variantIdNumeric || !imageIdNumeric) {
    throw new Error(`Unable to extract numeric IDs for REST assignment (variant=${variantGid}, image=${productImageGid})`);
  }

  const url = `${SHOPIFY_BASE}/variants/${variantIdNumeric}.json`;
  const payload = {
    variant: {
      id: Number(variantIdNumeric),
      image_id: Number(imageIdNumeric)
    }
  };

  const res = await fetchWithTimeout(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, 120000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST variant update failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return true;
}

// ——— ASSIGN IMAGE TO VARIANT ———
  async function assignImageToVariant(productId, variantId, imageMatch, variantDisplayName, productTitle) {
  const productImageId = imageMatch?.productImageId || null;
  const resolvedUrl = imageMatch?.url || null;

  if (productImageId) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would assign product image (REST) to "${variantDisplayName}" of "${productTitle}" (${resolvedUrl || 'no URL'})`);
        return true;
      }

      try {
        await assignVariantImageViaRest(variantId, productImageId);
        console.log(`  ✅ Assigned product image (REST) to "${variantDisplayName}" in "${productTitle}"`);
        return true;
      } catch (err) {
        console.log(`  ⚠️  Failed to assign image to "${variantDisplayName}": ${err.message}`);
        throw err;
      }
  }

  if (imageMatch?.mediaImageId) {
      console.log(`  ⏭️  Skipping "${variantDisplayName}" - matched MediaImage but Shopify API version ${SHOPIFY_API_VERSION} lacks productVariantMediaAssign support`);
      return false;
  }

  throw new Error('No valid Shopify image reference found for assignment');
  }

  // ——— MAIN EXECUTION ———
  async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ASSIGN VARIANT IMAGES (Amrod Color Images → Shopify)    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Mode: ${DRY_RUN ? '🧪 DRY RUN' : '🚀 LIVE'} | Reassign existing: ${REASSIGN_EXISTING ? 'ON' : 'OFF'}`);
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  try {
      ensureLogDirectories();

      // Step 1: Fetch Amrod variants and build lookup index
      const amrodIndex = await fetchAmrodProducts();

      // Step 2: Fetch Shopify products with variants and images
      const shopifyProducts = await fetchShopifyProducts();

      STATS.totalProducts = shopifyProducts.length;

      // Step 3: Process each Shopify variant
      console.log('\n🔄 Processing products...\n');

      for (const shopifyProduct of shopifyProducts) {
        // Ensure we have all media if there are multiple pages (rare)
        const productMedia = await fetchAllMediaForProduct(shopifyProduct.id, shopifyProduct.media);
        const productImageEdges = await fetchAllImagesForProduct(shopifyProduct.id, shopifyProduct.images);
        const imageCatalog = buildShopifyImageCatalog(productMedia, productImageEdges);
        const variants = shopifyProduct.variants?.edges || [];

        let productProcessed = false;

        // Process each variant
        for (const variantEdge of variants) {
          const variant = variantEdge.node;
          const sku = variant.sku?.trim().toUpperCase();

          // Skip variants without SKU
          if (!sku) continue;

          // Skip variants with existing image unless reassign is enabled
          if (variant.image?.id && !REASSIGN_EXISTING) {
            STATS.variantsSkipped++;
            continue;
          }

          const { candidates, options } = prepareAmrodCandidates(variant, amrodIndex);

          if (!candidates.length) {
            STATS.variantsSkipped++;
            console.log(`  ⏭️  Skipping "${variant.displayName}" - no Amrod variant candidates for SKU=${sku}`);
            if (options.colorRaw || options.sizeRaw) {
              console.log(`     Shopify colour=${options.colorRaw || '(none)'} | Shopify size=${options.sizeRaw || '(none)'}\n`);
            }
            continue;
          }

          if (!productProcessed) {
            console.log(`\n📦 Processing "${shopifyProduct.title}"`);
            console.log(`   ${variants.length} variants, ${imageCatalog.length} matched images`);
            STATS.productsProcessed++;
            productProcessed = true;
          }

          let chosenEntry = null;
          let imageMatch = null;

          for (const candidate of candidates) {
            const matchedImage = matchVariantToColorImage(
              variant,
              candidate.variant,
              candidate.colourImages,
              imageCatalog
            );

            if (matchedImage) {
              chosenEntry = candidate;
              imageMatch = matchedImage;
              break;
            }
          }

          if (!chosenEntry || !imageMatch || (!imageMatch.productImageId && !imageMatch.mediaImageId)) {
            STATS.variantsSkipped++;
            console.log(`  ⏭️  Skipping "${variant.displayName}" - no matching color image found`);
            console.log(`     SKU=${sku} | Shopify colour=${options.colorRaw || '(none)'} | Shopify size=${options.sizeRaw || '(none)'}`);
            const firstCandidate = candidates[0];
            if (firstCandidate?.availableColourCodes?.length) {
              console.log(`     Available Amrod colour codes: ${firstCandidate.availableColourCodes.join(', ')}\n`);
            } else {
              console.log('');
            }
            continue;
          }

          // Assign image to variant
          try {
            const assigned = await assignImageToVariant(
              shopifyProduct.id,
              variant.id,
              imageMatch,
              variant.displayName,
              shopifyProduct.title
            );

            if (assigned) {
              STATS.variantsUpdated++;
              log.action({
                action: (variant.image?.id && REASSIGN_EXISTING) ? 'reassignVariantImage' :
    'assignVariantImage',
                sku,
                productId: shopifyProduct.id,
                productTitle: shopifyProduct.title,
                variantId: variant.id,
                variantName: variant.displayName,
                imageId: imageMatch.productImageId,
                imageSourceType: 'ProductImageREST',
                amrodFullCode: chosenEntry?.variant?.fullCode,
                amrodColourCode: chosenEntry?.variant?.colourCode,
                amrodColourName: chosenEntry?.variant?.colourCodeName
              });
            } else {
              STATS.variantsSkipped++;
            }

          } catch (err) {
            STATS.variantsFailed++;
            log.error(sku, err, {
              productId: shopifyProduct.id,
              productTitle: shopifyProduct.title,
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
