import 'dotenv/config';
import axios from 'axios';

// Config
const AMROD_AUTH_URL   = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL   = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}`;
const PRICE_MARKUP     = parseFloat(process.env.PRICE_MARKUP) || 1.43;

// Sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms));
sleep.ms = 500;

// Text helpers
function slugify(text) {
  return String(text||'').toLowerCase().trim()
    .replace(/\s+/g,'-')
    .replace(/[^\w-]+/g,'')
    .replace(/-+/g,'-');
}
function extractSku(item) {
  // Always return fullCode (variant) if present, fallback to simpleCode
  return (
    item.fullCode   || item.FullCode   ||
    item.simpleCode || item.simplecode ||
    ''
  ).toLowerCase();
}

// PATCH: avoid infinite recursion using a visited Set
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
      set.add(encodeURI(val.replace(/\u00A0/g,' ')));
    } else if (typeof val === 'object') {
      collectImageURLs(val, set, visited);
    }
  }
}

// HTTP clients
const amrodClient = axios.create({
  baseURL: AMROD_BASE_URL,
  headers:{ 'Content-Type':'application/json','Accept':'application/json' }
});
const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers:{
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type':'application/json',
    'Accept':'application/json'
  },
  timeout:60000
});

const collectionImageMap = new Map();
const MULTI_LINE_KEYS = new Set([
  'description',
  'longDescription',
  'madeToOrderMessage'
]);

// Shopify auth
async function testAuth() {
  console.log('▶ testAuth');
  try {
    const res = await shopifyClient.get('/shop.json');
    console.log('✅ Shopify auth OK:', res.data.shop.name);
  } catch (err) {
    console.error('❌ Shopify auth failed:', err.response?.data||err.message);
    process.exit(1);
  }
}

// Amrod token
async function getAmrodToken() {
  console.log('▶ getAmrodToken');
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  if (!AMROD_EMAIL||!AMROD_PASSWORD||!AMROD_CUSTOMER_CODE) {
    console.error('❌ Missing Amrod credentials');
    process.exit(1);
  }
  try {
    const res = await axios.post(AMROD_AUTH_URL, {
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    });
    const token = res.data.token||res.data.access_token;
    if (!token) throw new Error('No token returned');
    console.log('✅ Amrod token received');
    return token;
  } catch (err) {
    console.error('❌ Amrod auth failed:', err.response?.data||err.message);
    process.exit(1);
  }
}

// Product fetchers
async function fetchProducts(token) {
  console.log('▶ fetchProducts');
  const res = await amrodClient.get('/Products/GetProductsAndBranding',{
    headers:{ Authorization:`Bearer ${token}` }
  });
  const data = Array.isArray(res.data)?res.data:res.data.Products||[];
  console.log(`✅ ${data.length} products fetched`);
  return data;
}
async function fetchStock(token) {
  console.log('▶ fetchStock');
  const res = await amrodClient.get('/Stock',{
    headers:{ Authorization:`Bearer ${token}` }
  });
  const data = Array.isArray(res.data)?res.data:res.data.Stock||[];
  console.log(`✅ ${data.length} stock items fetched`);
  return data;
}
async function fetchPrices(token) {
  console.log('▶ fetchPrices');
  const endpoints = ['/Prices', '/Prices/'];
  let res = null;
  for (const ep of endpoints) {
    try {
      res = await amrodClient.get(ep, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log(`✅ Fetched prices from ${ep}`);
      break;
    } catch (err) {
      if (err.response?.status === 404) {
        console.warn(`⚠️ ${ep} returned 404, trying next…`);
      } else {
        throw err;
      }
    }
  }
  if (!res) {
    console.error('❌ Unable to fetch prices: both /Prices and /Prices/ returned 404');
    return [];
  }
  const data = Array.isArray(res.data)
    ? res.data
    : res.data.Prices || [];
  console.log(`✅ ${data.length} prices fetched`);
  return data;
}
async function fetchInclusiveBranding(token) {
  console.log('▶ fetchInclusiveBranding');
  const res = await amrodClient.get('/InclusiveBrandings',{
    headers:{ Authorization:`Bearer ${token}` }
  });
  const data = Array.isArray(res.data)
    ? res.data
    : res.data.InclusiveBrandings||[];
  console.log(`✅ ${data.length} inclusive‐branding prices fetched`);
  return data;
}
async function fetchLocationId() {
  console.log('▶ fetchLocationId');
  const res = await shopifyClient.get('/locations.json');
  const loc = res.data.locations?.[0]?.id;
  console.log('✅ Location ID:', loc);
  return loc;
}

// Group Amrod products by simpleCode (parent code)
function groupByParent(products) {
  const grouped = new Map();
  products.forEach(prod => {
    const key = (prod.simpleCode || prod.simplecode || '').toLowerCase();
    if (!key) return;
    let variants = Array.isArray(prod.variants) && prod.variants.length > 0 ? prod.variants : [prod];
    variants.forEach(variant => {
      variant._parent = prod; // keep parent reference for later
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(variant);
    });
  });
  return grouped;
}

// Shopify helpers
async function findProductByHandle(handle) {
  // Find by handle, return product id or null
  try {
    const res = await shopifyClient.get('/products.json', {
      params: { handle }
    });
    const prod = res.data.products?.[0];
    return prod ? prod : null;
  } catch (err) {
    return null;
  }
}

// Main sync (grouped by parent)
(async()=> {
  console.log('▶ Main sync start');
  await testAuth();

  const token      = await getAmrodToken();
  const products   = await fetchProducts(token);
  const stock      = await fetchStock(token);
  const prices     = await fetchPrices(token);
  const brandings  = await fetchInclusiveBranding(token);
  const locationId = await fetchLocationId();

  // ---- BUILD priceMap using ONLY fullCode as the map key ----
  const priceMap = new Map();
  prices.forEach(p => {
    const sku        = (p.fullCode || p.FullCode || '').toLowerCase();
    if (!sku) return;
    const basePrice  = parseFloat(p.price)    || 0;
    const promoPrice = parseFloat(p.promoPrice ?? p.PromoPrice ?? 0) || 0;
    const finalPrice = promoPrice > 0 ? promoPrice : basePrice;
    priceMap.set(sku, finalPrice);
  });
  brandings.forEach(b => {
    const sku = (b.fullCode || b.FullCode || '').toLowerCase();
    const p   = parseFloat(b.price) || 0;
    if (sku && p > 0) priceMap.set(sku, p);
  });

  // build stockMap, always keyed on fullCode
  const stockMap = new Map();
  stock.forEach(s => {
    const sku = (s.fullCode || s.FullCode || '').toLowerCase();
    if (!sku) return;
    stockMap.set(sku, parseFloat(s.stock||s.Stock) || 0);
  });

  // Group all by parent product
  const grouped = groupByParent(products);

  const total = grouped.size;
  const START_IDX = 2893; // <-- Start at product 2893
  let idx = 0;
  for (const [parentCode, variants] of grouped) {
    idx++;
    if (idx < START_IDX) continue; // <-- Skip until product 2893

    const parent = variants[0]._parent;
    const handle = slugify(parent.productName || parent.description || parent.simpleCode || parent.simplecode);
    console.log(`\n▶ Processing ${idx}/${total} Parent SKU=${parentCode} (${variants.length} variants)`);

    // Build tags as before
    const tags = new Set();
    if (parent.tags)     parent.tags.split(',').map(t=>t.trim()).forEach(t=>tags.add(t));
    if (parent.keywords) parent.keywords.split(',').map(t=>t.trim()).forEach(t=>tags.add(t));
    if (Array.isArray(parent.categories)) {
      parent.categories.forEach(cat=>{
        if (cat.name) tags.add(cat.name);
        if (cat.path) cat.path.split('/').map(p=>p.trim()).forEach(t=>tags.add(t));
      });
    }
    if (!tags.size) tags.add('amrod');

    // Images: main product images
    const imagesSet = new Set();
    [parent.Images,parent.colourImages,parent.BrandingImages,parent.components]
      .forEach(src => {
        if (Array.isArray(src)) src.forEach(o=>collectImageURLs(o,imagesSet,new Set()));
        else if (typeof src==='object') collectImageURLs(src,imagesSet,new Set());
      });
    collectImageURLs(parent,imagesSet,new Set());
    const images = Array.from(imagesSet).map(src=>({ src }));

    // PATCH: Unique option values for all variants
    let hasSize = variants.some(v => v.codeSizeName || v.codeSize);
    let hasColour = variants.some(v => v.codeColourName || v.codeColour);
    let multiVariant = variants.length > 1;

    // Build variantObjs with guaranteed unique options for Shopify
    const variantObjs = variants.map((variant, idx) => {
      const sku = extractSku(variant);
      const price = priceMap.get(sku) || 0;
      const qty = stockMap.get(sku) || 0;

      let option1 = hasSize ? (variant.codeSizeName || variant.codeSize || `Option ${idx+1}`) : undefined;
      let option2 = hasColour ? (variant.codeColourName || variant.codeColour || undefined) : undefined;

      // If no size/colour and multi-variant, use unique value
      if (!hasSize && !hasColour && multiVariant) {
        option1 = sku; // Use SKU or another unique string for each
      }
      // For single variant, Shopify requires "Title"
      if (!option1) option1 = 'Default';

      return {
        sku,
        option1,
        ...(option2 ? { option2 } : {}),
        price: price.toFixed(2),
        inventory_management:'shopify',
        inventory_quantity: qty
      };
    });

    // Decide Shopify options
    let options = [];
    if (hasSize) options.push({ name: 'Size' });
    if (hasColour) options.push({ name: 'Colour' });
    if (!options.length) options.push({ name: 'Title' });

    // Remove undefined option2 if not needed
    variantObjs.forEach(v => { if (!options.find(o => o.name === 'Colour')) delete v.option2; });

    const payload = {
      product: {
        title: parent.productName || parent.description || 'Untitled',
        body_html: parent.longDescription || parent.description || '',
        vendor: 'Amrod',
        handle,
        tags: Array.from(tags),
        images,
        options,
        variants: variantObjs
      }
    };

    // Check if this product already exists in Shopify (by handle)
    const shopifyProd = await findProductByHandle(handle);
    await sleep(200);

    if (!shopifyProd) {
      // CREATE new product with all variants
      try {
        const r = await shopifyClient.post('/products.json', payload);
        console.log('✅ Product created', r.data.product.id);
        // Optionally: set inventory/cost for each variant here, or loop after create
      } catch(err) {
        console.error('❌ Create failed:', err.response?.data||err.message);
        continue;
      }
    } else {
      // UPDATE logic (variant-by-SKU sync, skip missing)
      try {
        const prodId = shopifyProd.id;
        // Update main product fields
        await shopifyClient.put(`/products/${prodId}.json`, payload);
        console.log('✅ Product updated', prodId);

        // Update each variant (price, qty, cost)
        for (const variant of shopifyProd.variants) {
          const local = variantObjs.find(v => v.sku === variant.sku);
          if (!local) {
            console.warn(`Skipping variant id=${variant.id} (SKU ${variant.sku}) -- not found in current feed`);
            continue;
          }
          try {
            await shopifyClient.put(`/variants/${variant.id}.json`, {
              variant: {
                id: variant.id,
                price: local.price,
                inventory_management: 'shopify'
              }
            });
            await sleep(100);
            await shopifyClient.post('/inventory_levels/set.json', {
              location_id: locationId,
              inventory_item_id: variant.inventory_item_id,
              available: local.inventory_quantity
            });
            // Optionally update cost here if you want
          } catch(err) {
            console.error('❌ Variant update failed:', err.response?.data||err.message);
          }
        }
      } catch(err) {
        console.error('❌ Update failed:', err.response?.data||err.message);
        continue;
      }
    }
    await sleep(sleep.ms);
  }

  console.log('\n🎉 Full sync complete');
})();
