import 'dotenv/config';
import axios from 'axios';

// --- CONFIG ---
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}`;

// --- Shopify Axios Client ---
const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 60000
});

// --- Utils ---
function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-+/g, '-');
}

// --- Sleep Helper ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Fixer for inclusivebranding JSON ---
// Ensures each item in array has "colour" as a string, or removes "colour" if it's null/undefined
function fixInclusiveBranding(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(item => {
    if (typeof item !== 'object' || !item) return item;
    let newItem = { ...item };
    if ('colour' in newItem && (newItem.colour === null || newItem.colour === undefined)) {
      delete newItem.colour;
    }
    return newItem;
  });
}

// --- Metafield key/type map ---
const metafieldDefs = {
  minimum:            { type: 'number_integer' },
  maximum:            { type: 'number_integer' },
  incrementedby:      { type: 'number_integer' },
  fullbrandingguide:  { type: 'json' },
  decoupled:          { type: 'boolean' },
  islogo24:           { type: 'boolean' },
  categorisedattribute:{ type: 'json' },
  requiredbrandingpositions:{ type: 'json' },
  categories:         { type: 'json' },
  brand:              { type: 'json' },
  colourimages:       { type: 'json' },
  brandings:          { type: 'json' },
  inclusivebranding:  { type: 'json' },
  images:             { type: 'json' },
  relatedcodes:       { type: 'json' }, // Skipped for now as discussed
  longdescription:    { type: 'multi_line_text_field' },
  madetoorder:        { type: 'multi_line_text_field' },
  description:        { type: 'multi_line_text_field' },
  madetoordermessage: { type: 'multi_line_text_field' },
  keywords:           { type: 'single_line_text_field' },
  simplecode:         { type: 'single_line_text_field' },
  productname:        { type: 'single_line_text_field' },
  gender:             { type: 'single_line_text_field' },
  fit:                { type: 'single_line_text_field' },
  feature:            { type: 'single_line_text_field' },
  behaviour:          { type: 'single_line_text_field' },
  type:               { type: 'single_line_text_field' },
  promotion:          { type: 'single_line_text_field' },
  nocobrandingpositions: { type: 'single_line_text_field' },
  material:           { type: 'single_line_text_field' },
  matchingcodes:      { type: 'single_line_text_field' },
  logo24brandingguide:{ type: 'single_line_text_field' },
  logo24branding:     { type: 'single_line_text_field' },
  inventorytype:      { type: 'single_line_text_field' },
  groupingcodes:      { type: 'single_line_text_field' },
  fullcode:           { type: 'single_line_text_field' },
  displaycountryoforigin:{ type: 'single_line_text_field' },
  companioncodes:     { type: 'single_line_text_field' },
};

// --- AMROD AUTH ---
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

// --- FETCH AMROD PRODUCTS ---
// No more limit, fetch all
async function fetchAmrodProducts(token) {
  const res = await axios.get(
    `${AMROD_BASE_URL}/Products/GetProductsAndBranding`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = Array.isArray(res.data) ? res.data : res.data.Products || [];
  return data;
}

// --- LOOKUP SHOPIFY PRODUCT BY SKU OR HANDLE ---
async function findShopifyProductBySKUorHandle(simpleCode, productName) {
  // 1. Try by variant SKU (search all up to 250 products at a time)
  let prod = null;
  try {
    let page = 1;
    let keepGoing = true;
    while (keepGoing) {
      const res = await shopifyClient.get('/products.json', {
        params: { limit: 250, fields: 'id,title,handle,variants,metafields', page }
      });
      const products = res.data.products || [];
      for (let p of products) {
        if (p.variants.some(v => (v.sku || '').toLowerCase() === (simpleCode || '').toLowerCase())) {
          prod = p;
          keepGoing = false;
          break;
        }
      }
      if (!prod && products.length === 250) {
        page++;
      } else {
        keepGoing = false;
      }
    }
  } catch (err) {}

  // 2. Fallback: by handle (slugified name)
  if (!prod && productName) {
    const handle = slugify(productName);
    try {
      const res = await shopifyClient.get('/products.json', {
        params: { handle, limit: 1, fields: 'id,title,handle,variants,metafields' }
      });
      prod = (res.data.products && res.data.products[0]) || null;
    } catch (err) {}
  }
  return prod;
}

// --- FIELD TRANSFORMER ---
function transformValue(key, value, type) {
  if (key.toLowerCase() === 'inclusivebranding') {
    value = fixInclusiveBranding(value);
  }
  if (type === 'json') {
    // If string (like a URL), wrap as JSON string
    if (typeof value === 'string') return JSON.stringify(value);
    return JSON.stringify(value);
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true';
    return Boolean(value);
  }
  return value;
}

// --- SHOPIFY METAFIELD SETTER ---
async function setShopifyMetafield(productId, key, value, type) {
  // Namespace is always 'amrod'
  const namespace = 'amrod';
  const fullKey = key.startsWith('amrod.') ? key.split('.')[1] : key;
  const payload = {
    metafield: {
      namespace,
      key: fullKey,
      value,
      type
    }
  };
  try {
    await shopifyClient.post(`/products/${productId}/metafields.json`, payload);
  } catch (err) {
    // Try PUT (update) if POST fails with "already exists"
    if (
      err.response &&
      err.response.data &&
      JSON.stringify(err.response.data).includes('already exists')
    ) {
      // Get existing metafields, find ID
      const res = await shopifyClient.get(`/products/${productId}/metafields.json`);
      const match = (res.data.metafields || []).find(
        mf => mf.namespace === namespace && mf.key === fullKey
      );
      if (match) {
        await shopifyClient.put(
          `/metafields/${match.id}.json`,
          { metafield: { value, type } }
        );
        return;
      }
    }
    throw err;
  }
}

// --- MAIN SYNC ---
(async () => {
  const token = await getAmrodToken();
  const amrodProducts = await fetchAmrodProducts(token);
  let doneCount = 0;

  for (let amrod of amrodProducts) {
    const simpleCode = amrod.simpleCode || amrod.simplecode || '';
    const productName = amrod.productName || '';
    const shopifyProduct = await findShopifyProductBySKUorHandle(simpleCode, productName);

    doneCount++;

    if (!shopifyProduct) {
      console.log(`[${doneCount}/${amrodProducts.length}] ❌ Shopify product NOT FOUND for Amrod [SKU=${simpleCode}] [Name="${productName}"]`);
      continue;
    }

    console.log(`[${doneCount}/${amrodProducts.length}] Processing Amrod [SKU=${simpleCode}] [Name="${productName}"] ---`);

    for (let [key, value] of Object.entries(amrod)) {
      if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;

      const keyLower = key.toLowerCase();
      const def = metafieldDefs[keyLower];
      if (!def) continue;

      // Skip relatedcodes as discussed
      if (keyLower === 'relatedcodes') continue;

      let newVal = transformValue(key, value, def.type);

      try {
        await setShopifyMetafield(shopifyProduct.id, `amrod.${keyLower}`, newVal, def.type);
        console.log(`    ✅ Set metafield: amrod.${keyLower} (${def.type})`);
      } catch (err) {
        console.log(`    ❌ Failed to set metafield: amrod.${keyLower}`);
        console.log(`       Reason: ${JSON.stringify(err.response?.data || err.message)}`);
      }
      // *** Rate limiting: 2 requests/sec ***
      await sleep(600); // Add delay after each request
    }
  }

  console.log(`\n✅ Sync complete. Updated ${doneCount} products.`);
})();
