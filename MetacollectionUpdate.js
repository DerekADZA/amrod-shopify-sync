import 'dotenv/config';
import axios from 'axios';

// --- CONFIG ---
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}`;

// --- METAFIELD TYPE MAP ---
const METAFIELD_TYPE_MAP = {
  minimum: 'number_integer',
  maximum: 'number_integer',
  incrementedby: 'number_integer',
  fullbrandingguide: 'single_line_text_field', // Or 'url' if you use Shopify's url type
  logo24brandingguide: 'single_line_text_field', // Or 'url'
  relatedcodes: 'json',
  images: 'json',
  brandingtemplates: 'json',
  brandings: 'json',
  categories: 'json',
  categorisedattribute: 'json',
  colourimages: 'json',
  inclusivebranding: 'json',
  variants: 'json',
  nocobrandingpositions: 'json',
  requiredbrandingpositions: 'json',
  madetoorder: 'multi_line_text_field',
  madetoordermessage: 'multi_line_text_field',
  description: 'multi_line_text_field',
  islogo24: 'boolean', // PATCH: now using Shopify's boolean type
  decoupled: 'boolean', // PATCH: now using Shopify's boolean type
  // Add decimal or url types if/when you need them
  // e.g. weight: 'number_decimal'
};

const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 60000
});

function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-+/g, '-');
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
  let prod = null;
  // 1. Try by variant SKU
  try {
    let page = 1, found = false;
    while (!found) {
      const res = await shopifyClient.get('/products.json', {
        params: { limit: 250, page, fields: 'id,title,handle,variants,metafields' }
      });
      const products = res.data.products || [];
      if (products.length === 0) break;
      for (let p of products) {
        if (p.variants.some(v => (v.sku || '').toLowerCase() === (simpleCode || '').toLowerCase())) {
          prod = p; found = true; break;
        }
      }
      page++;
      if (found) break;
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

// --- LOOKUP SHOPIFY HANDLE BY SKU ---
async function lookupHandleBySKU(sku) {
  try {
    let page = 1, found = false, handle = null;
    while (!found) {
      const res = await shopifyClient.get('/products.json', {
        params: { limit: 250, page, fields: 'handle,variants' }
      });
      const products = res.data.products || [];
      if (products.length === 0) break;
      for (let p of products) {
        if (p.variants.some(v => (v.sku || '').toLowerCase() === (sku || '').toLowerCase())) {
          handle = p.handle; found = true; break;
        }
      }
      page++;
      if (found) return handle;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// --- SET METAFIELD ---
async function setMetafield(productId, namespace, key, value, valueType = 'single_line_text_field') {
  try {
    await shopifyClient.post(`/products/${productId}/metafields.json`, {
      metafield: {
        namespace,
        key,
        value,
        type: valueType
      }
    });
    console.log(`  ✅ Set metafield: ${namespace}.${key}`);
  } catch (err) {
    console.error(
      `  ❌ Failed to set metafield: ${namespace}.${key}\n     Reason: ${JSON.stringify(err.response?.data || err.message, null, 2)}`
    );
  }
  await sleep(120); // Pause for rate limiting
}

// --- MAIN SYNC ---
(async () => {
  const token = await getAmrodToken();
  const amrodProducts = await fetchAmrodProducts(token);
  let updatedCount = 0;

  for (let amrod of amrodProducts) {
    const simpleCode = amrod.simpleCode || amrod.simplecode || '';
    const productName = amrod.productName || '';
    const shopifyProduct = await findShopifyProductBySKUorHandle(simpleCode, productName);

    if (!shopifyProduct) {
      console.log(`❌ Shopify product NOT FOUND for Amrod [SKU=${simpleCode}] [Name="${productName}"]`);
      continue;
    }

    console.log(`\n--- UPDATING: Shopify "${shopifyProduct.title}" (ID: ${shopifyProduct.id}, Handle: ${shopifyProduct.handle}) ---`);

    let metafieldsToSet = {};

    for (let [key, value] of Object.entries(amrod)) {
      if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;

      // --- relatedCodes: convert SKUs to handles ---
      if (key === 'relatedCodes' && Array.isArray(value)) {
        let handles = [];
        for (let codeObj of value) {
          let sku = typeof codeObj === 'string' ? codeObj : codeObj?.simpleCode || codeObj?.fullCode || '';
          if (!sku) continue;
          const handle = await lookupHandleBySKU(sku);
          if (handle) handles.push(handle);
          else console.log(`  ⚠️ Related SKU not found in Shopify: ${JSON.stringify(codeObj)}`);
        }
        if (handles.length > 0) {
          metafieldsToSet['relatedcodes'] = { value: JSON.stringify(handles), type: 'json' };
        }
        continue;
      }

      // --- robust type mapping ---
      const keyLower = key.toLowerCase();
      let type = METAFIELD_TYPE_MAP[keyLower] || 'single_line_text_field';
      let v = value;

      // PATCH: format booleans for Shopify boolean metafields
      if (type === 'boolean') v = Boolean(v);
      else if (type === 'single_line_text_field' && typeof v === 'boolean') v = v ? 'true' : 'false';
      // Format numbers
      if (type === 'number_integer' || type === 'number_decimal') v = Number(v);
      // Format JSON
      if (type === 'json' && typeof v !== 'string') v = JSON.stringify(v);

      metafieldsToSet[keyLower] = { value: v, type };
    }

    if (Object.keys(metafieldsToSet).length === 0) {
      console.log('  ⚠️ No metafields to update (all empty/null)');
      continue;
    }

    // Actually update metafields in Shopify
    for (let [key, obj] of Object.entries(metafieldsToSet)) {
      await setMetafield(shopifyProduct.id, 'amrod', key, obj.value, obj.type);
    }

    updatedCount++;
  }

  console.log(`\n🎉 Full metafield sync complete. Updated ${updatedCount} products out of ${amrodProducts.length}.`);
})();
