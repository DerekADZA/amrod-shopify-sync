// map-amrod-to-shopify.js  (supports --k=v and --k v)
// 1:1 mapping of Shopify variants to Amrod VARIANT (full) codes for a single product.

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

/* ---------- CLI (robust) ---------- */
function parseArgs(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > -1) {
      const k = a.slice(2, eq);
      const v = a.slice(eq + 1);
      out.set(k, v);
    } else {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.set(k, next);
        i++; // consume value
      } else {
        out.set(k, true);
      }
    }
  }
  return out;
}
const ARGV = parseArgs(process.argv.slice(2));
const getArg = (k, d='') => (ARGV.has(k) ? String(ARGV.get(k)) : d);
const APPLY = ARGV.has('apply');

const CODE   = getArg('code', '').trim();            // e.g., JC-SL-133-A (base works too)
const HANDLE = getArg('shopify-handle', '').trim();
const PRODID = getArg('shopify-id', '').trim();

/* ---------- ENV ---------- */
const SHOP_URL   = process.env.SHOPIFY_STORE_URL;
const SHOP_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VER    = '2025-07';

const AMROD_AUTH_URL     = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL     = 'https://vendorapi.amrod.co.za';
const AMROD_API_VERSION  = '1';
const EP_WITH_BRANDING   = `${AMROD_BASE_URL}/api/v${AMROD_API_VERSION}/Products/GetProductsAndBranding`;

/* ---------- Helpers ---------- */
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
const escCSV = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
};
const normBasic = (s) => String(s || '').toLowerCase().trim();
const normCode  = (s) => normBasic(s).replace(/[-_\s]/g,''); // for code comparisons
const normVal   = (s) => normBasic(s).replace(/[-_\s]/g,''); // for colour/size comparisons
const normaliseColour = (s) => normVal(s).replace(/\bgrey\b/g,'gray'); // unify grey/gray a bit
const isLikelySkuVal = (v) => /^[A-Za-z0-9._/-]{2,64}$/.test(String(v || '').trim());

/* ---------- Amrod auth + fetch ---------- */
async function getAmrodToken() {
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  if (!AMROD_EMAIL || !AMROD_PASSWORD || !AMROD_CUSTOMER_CODE) {
    throw new Error('Missing AMROD_EMAIL / AMROD_PASSWORD / AMROD_CUSTOMER_CODE in .env');
  }
  const { data } = await axios.post(AMROD_AUTH_URL, {
    UserName: AMROD_EMAIL, Password: AMROD_PASSWORD, CustomerCode: AMROD_CUSTOMER_CODE
  });
  const token = data?.token || data?.access_token;
  if (!token) throw new Error('Amrod auth returned no token');
  return token;
}

async function fetchAmrodProductsWithBranding(token) {
  const { data } = await axios.get(EP_WITH_BRANDING, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 300000
  });
  return Array.isArray(data) ? data : [];
}

/* ---------- Deep find target product ---------- */
function extractCanonical(obj = {}) {
  return (
    obj.simpleCode ?? obj.SimpleCode ??
    obj.fullCode   ?? obj.FullCode   ??
    obj.code       ?? obj.Code       ??
    obj.sku        ?? obj.SKU        ?? ''
  );
}

function productMatchesCodeDeep(product, rawCode) {
  const target = normCode(rawCode);
  if (!target) return false;
  let hit = false;
  const visit = (n) => {
    if (hit || n == null) return;
    if (typeof n === 'string') {
      const v = normCode(n);
      if (v === target || v.startsWith(target)) hit = true;
    } else if (Array.isArray(n)) {
      for (const c of n) { visit(c); if (hit) break; }
    } else if (typeof n === 'object') {
      for (const v of Object.values(n)) { visit(v); if (hit) break; }
    }
  };
  visit(product);
  return hit;
}

function findAmrodProductDeep(products, code) {
  const target = normCode(code);
  // prefer canonical equality first
  const exact = products.find(p => {
    const fields = [extractCanonical(p), ...(Array.isArray(p.variants)?p.variants.map(extractCanonical):[])];
    return fields.map(normCode).some(n => n === target);
  });
  if (exact) return exact;
  // otherwise deep contains/prefix
  return products.find(p => productMatchesCodeDeep(p, code));
}

/* ---------- Flatten variant-like rows ---------- */
const CODE_KEY_RE = /(?:^|_)(sku|code)$/i;
const EXCLUDE_KEY_RE = /(barcode|ean|gtin)/i;
const COLOR_KEYS = ['colour','color','colourName','colour_name','colourCode','colorCode','colour_code','swatch','pantone'];
const SIZE_KEYS  = ['size','sizeName','size_name','sizeCode','size_code'];

function collectVariantRows(product) {
  const rows = [];
  const visit = (node, path=[]) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((c,i)=>visit(c, path.concat(`[${i}]`))); return; }

    // collect code-like fields at this node
    const codes = {};
    const hints = {};
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        if (CODE_KEY_RE.test(k) && !EXCLUDE_KEY_RE.test(k) && isLikelySkuVal(v)) codes[k] = v;
        if (COLOR_KEYS.includes(k)) hints.colour = hints.colour || v;
        if (SIZE_KEYS.includes(k))  hints.size   = hints.size   || v;
      } else if (typeof v === 'number') {
        if (SIZE_KEYS.includes(k)) hints.size = String(v);
      }
    }

    const canonical = extractCanonical(node);

    // If we have any code field OR a canonical here, register a row
    if (Object.keys(codes).length || canonical) {
      // choose "full" code preference if present among code fields
      const fullPrefKey = Object.keys(codes).find(k => /fullcode/i.test(k)) || Object.keys(codes).find(k => /code|sku/i.test(k));
      const full = (fullPrefKey ? codes[fullPrefKey] : '') || canonical;
      rows.push({
        path: path.join('.'),
        canonical,
        fullCode: full || '',
        colour: hints.colour || '',
        size: hints.size || ''
      });
    }

    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') visit(v, path.concat(k));
    }
  };
  visit(product, ['product']);
  // de-dup by (fullCode, colour, size)
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = [r.fullCode, r.colour, r.size].map(x => normVal(x)).join('|');
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  }
  return out.filter(r => r.fullCode); // must have a usable code
}

/* ---------- Shopify ---------- */
const shopify = axios.create({
  baseURL: `${SHOP_URL}/admin/api/${API_VER}`,
  headers: {
    'X-Shopify-Access-Token': SHOP_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 60000
});

async function gql(query, variables = {}, attempt = 1) {
  try {
    const { data } = await shopify.post('/graphql.json', { query, variables });
    if (data?.errors) throw new Error(JSON.stringify(data.errors));
    return data.data;
  } catch (err) {
    const status = err.response?.status;
    const retryAfter = Number(err.response?.headers?.['retry-after']) || 0;
    if (status === 429 && attempt <= 6) {
      const backoff = Math.max(500 * attempt, retryAfter * 1000);
      await sleep(backoff);
      return gql(query, variables, attempt + 1);
    }
    throw err;
  }
}

async function fetchShopifyProduct({ handle, id }) {
  if (!handle && !id) throw new Error('Provide --shopify-handle or --shopify-id');
  if (handle) {
    const q = `
      query ($q:String!) {
        products(first:1, query:$q){
          edges{ node{
            id title handle
            variants(first:250){ edges{ node{
              id title sku
              inventoryItem{ id sku }
              selectedOptions{ name value }
            } } }
          } }
        }
      }
    `;
    const d = await gql(q, { q: `handle:${handle}` });
    return d?.products?.edges?.[0]?.node || null;
  }
  const q = `
    query ($id:ID!){
      product(id:$id){
        id title handle
        variants(first:250){ edges{ node{
          id title sku
          inventoryItem{ id sku }
          selectedOptions{ name value }
        } } }
      }
    }
  `;
  const d = await gql(q, { id });
  return d?.product || null;
}

async function updateInventoryItemSku(inventoryItemId, newSku) {
  const mutation = `
    mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem{ id sku }
        userErrors{ field message }
      }
    }
  `;
  const data = await gql(mutation, { id: inventoryItemId, input: { sku: newSku } });
  const errs = data?.inventoryItemUpdate?.userErrors || [];
  if (errs.length) throw new Error(errs.map(e=>e.message).join(' | '));
  return data?.inventoryItemUpdate?.inventoryItem?.sku || newSku;
}

/* ---------- Matching ---------- */
function pickOptionValue(selectedOptions, names) {
  const map = new Map(selectedOptions.map(o => [normBasic(o.name), o.value]));
  for (const n of names) {
    const v = map.get(normBasic(n));
    if (v) return v;
  }
  return '';
}
function buildAmrodIndex(rows) {
  const idx = new Map(); // key: colour||size -> row list
  for (const r of rows) {
    const c = normaliseColour(r.colour);
    const s = normVal(r.size);
    const key = `${c}|${s}`;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(r);
  }
  return idx;
}

function bestMatchForVariant(amIndex, sv) {
  const colour = pickOptionValue(sv.selectedOptions, ['Colour','Color','colour','color']);
  const size   = pickOptionValue(sv.selectedOptions, ['Size','SIZE','size']);
  const cN = normaliseColour(colour);
  const sN = normVal(size);
  const key = `${cN}|${sN}`;
  const candidates = amIndex.get(key) || [];
  if (candidates.length === 1) return { status: 'exact', colour, size, amrod: candidates[0] };
  if (candidates.length > 1)  return { status: 'ambiguous', colour, size, amrodList: candidates };
  return { status: 'missing', colour, size, amrodList: [] };
}

/* ---------- CSV ---------- */
function writeCSV(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => escCSV(r[h])).join(','));
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`📝 Wrote ${file} (${rows.length} rows)`);
}

/* ---------- MAIN ---------- */
async function main() {
  if (!CODE) throw new Error('Provide --code "JC-SL-133-A" (base code also ok)');
  if (!SHOP_URL || !SHOP_TOKEN) throw new Error('Missing Shopify env in .env');

  console.log('🔐 Amrod auth…');
  const token = await getAmrodToken();

  console.log('📦 Fetching Amrod products (with branding)…');
  const products = await fetchAmrodProductsWithBranding(token);
  console.log(`   Count: ${products.length}`);

  const amProduct = findAmrodProductDeep(products, CODE);
  if (!amProduct) throw new Error(`Amrod product not found for code: ${CODE}`);
  console.log(`✅ Amrod product: ${amProduct.productName || amProduct.ProductName || extractCanonical(amProduct)}`);

  const amRows = collectVariantRows(amProduct);
  // Keep only likely "variant" rows: where fullCode differs from base canonical or has colour/size
  const baseCanon = normCode(extractCanonical(amProduct));
  const amVariantRows = amRows.filter(r => normCode(r.fullCode) !== baseCanon || r.colour || r.size);
  console.log(`   Amrod variant-like rows: ${amVariantRows.length}`);

  console.log('🛍️ Fetching Shopify product…');
  const shProduct = await fetchShopifyProduct({ handle: HANDLE, id: PRODID });
  if (!shProduct) throw new Error('Shopify product not found (check --shopify-handle or --shopify-id)');
  console.log(`✅ Shopify: ${shProduct.title} (${shProduct.handle})`);

  const sv = (shProduct.variants?.edges || []).map(e => e.node);
  console.log(`   Shopify variants: ${sv.length}`);

  // Build Amrod index by (colour,size)
  const amIndex = buildAmrodIndex(amVariantRows);

  // Build mapping rows
  const plan = [];
  for (const v of sv) {
    const m = bestMatchForVariant(amIndex, v);
    if (m.status === 'exact') {
      plan.push({
        status: 'exact',
        reason: '',
        shopify_variant_id: v.id,
        inventory_item_id: v.inventoryItem?.id || '',
        shopify_colour: m.colour,
        shopify_size: m.size,
        shopify_sku_current: v.inventoryItem?.sku || v.sku || '',
        amrod_full_code: m.amrod.fullCode,
        amrod_colour: m.amrod.colour,
        amrod_size: m.amrod.size
      });
    } else {
      plan.push({
        status: m.status,
        reason: m.status === 'ambiguous' ? `Found ${m.amrodList.length} candidates` : 'No colour/size match in Amrod',
        shopify_variant_id: v.id,
        inventory_item_id: v.inventoryItem?.id || '',
        shopify_colour: m.colour,
        shopify_size: m.size,
        shopify_sku_current: v.inventoryItem?.sku || v.sku || '',
        amrod_full_code: '',
        amrod_colour: '',
        amrod_size: ''
      });
    }
  }

  const OUT = path.resolve(process.cwd(), 'amrod_to_shopify_variant_map.csv');
  writeCSV(OUT, [
    'status','reason',
    'shopify_variant_id','inventory_item_id',
    'shopify_colour','shopify_size','shopify_sku_current',
    'amrod_full_code','amrod_colour','amrod_size'
  ], plan);

  // Apply (only exact)
  if (APPLY) {
    let ok=0, skip=0, fail=0;
    for (const r of plan) {
      if (r.status !== 'exact' || !r.inventory_item_id || !r.amrod_full_code) { skip++; continue; }
      try {
        const newSku = await updateInventoryItemSku(r.inventory_item_id, r.amrod_full_code);
        console.log(`✅ ${r.inventory_item_id}: ${r.shopify_sku_current} → ${newSku} (${r.shopify_colour}/${r.shopify_size})`);
        ok++;
      } catch (e) {
        console.warn(`❌ ${r.inventory_item_id}: ${r.shopify_sku_current} -> ${r.amrod_full_code} :: ${e.message}`);
        fail++;
      }
      await sleep(200);
    }
    console.log(`\nApply summary: ✅ ${ok}  ⏭️ ${skip}  ❌ ${fail}`);
  } else {
    console.log('\nDRY RUN (no updates). Add --apply to update inventoryItem.sku for exact matches.');
  }
}

main().catch(err => { console.error('💥 Fatal:', err.message); process.exit(1); });
