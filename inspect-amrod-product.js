// inspect-amrod-product.js (v2)
// Deep, normalized search for an Amrod product by code; flattens variant-like nodes.
// Optional Shopify side-by-side dump (handle or product id).

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const ARGV = new Map(
  process.argv.slice(2).flatMap(arg => {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) return [[arg, true]];
    return [[m[1], m[2] ?? true]];
  })
);
const getArg = (k, d = '') => (ARGV.get(k) ?? d).toString();

const SHOP_URL   = process.env.SHOPIFY_STORE_URL;
const SHOP_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VER    = '2025-07';

const AMROD_AUTH_URL     = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL     = 'https://vendorapi.amrod.co.za';
const AMROD_API_VERSION  = '1';
const AMROD_PRODUCTS_URL = `${AMROD_BASE_URL}/api/v${AMROD_API_VERSION}/Products/GetProductsAndBranding`;

const SEARCH_CODE   = getArg('code', '').trim();    // e.g., "JC-SL-133-A"
const SEARCH_TEXT   = getArg('search', '').trim();  // fallback: name contains
const SH_HANDLE     = getArg('shopify-handle', '').trim();
const SH_PRODUCT_ID = getArg('shopify-id', '').trim();

if (!process.env.AMROD_EMAIL || !process.env.AMROD_PASSWORD || !process.env.AMROD_CUSTOMER_CODE) {
  console.error('❌ Missing Amrod credentials in .env (AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE)');
  process.exit(1);
}

/* ---------- utils ---------- */
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
const escCSV = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
};
// normalize for matching: lowercase and strip hyphen/underscore/space
const norm = (s) => String(s || '').toLowerCase().replace(/[-_\s]/g,'');

// likely-SKU value heuristic
const isLikelySkuVal = (v) => {
  const s = String(v || '').trim();
  if (!s) return false;
  if (s.length < 2 || s.length > 64) return false;
  return /^[A-Za-z0-9._/-]+$/.test(s);
};

const CODE_KEY_RE = /(?:^|_)(sku|code)$/i;
const EXCLUDE_KEY_RE = /(barcode|ean|gtin)/i;

const COLOR_KEYS = ['colour','color','colourName','colour_name','colourCode','colorCode','colour_code','swatch','pantone'];
const SIZE_KEYS  = ['size','sizeName','size_name','sizeCode','size_code'];

/* ---------- Amrod ---------- */
async function getAmrodToken() {
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  const res = await axios.post(AMROD_AUTH_URL, {
    UserName: AMROD_EMAIL, Password: AMROD_PASSWORD, CustomerCode: AMROD_CUSTOMER_CODE
  });
  const token = res.data?.token || res.data?.access_token;
  if (!token) throw new Error('Amrod auth: no token returned');
  return token;
}

async function fetchAmrodProducts() {
  const token = await getAmrodToken();
  console.log('🔍 Fetching Amrod products…');
  const res = await axios.get(AMROD_PRODUCTS_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 300000
  });
  const arr = Array.isArray(res.data) ? res.data : [];
  console.log(`✅ Amrod products fetched: ${arr.length}`);
  return arr;
}

/* ---------- deep code search ---------- */
function extractCanonical(obj = {}) {
  return (
    obj.simpleCode ?? obj.SimpleCode ??
    obj.fullCode   ?? obj.FullCode   ??
    obj.code       ?? obj.Code       ??
    obj.sku        ?? obj.SKU        ?? ''
  );
}

// returns true if any string field in product matches code (exact or prefix) after normalization
function productMatchesCodeDeep(product, rawCode) {
  const target = norm(rawCode);
  if (!target) return false;

  let hit = false;
  const visit = (node) => {
    if (hit || node == null) return;
    if (Array.isArray(node)) { for (const c of node) visit(c); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (hit) break;
        if (typeof v === 'string') {
          const nv = norm(v);
          // exact or prefix (so JC-SL-133 matches JC-SL-133-A)
          if (nv === target || nv.startsWith(target)) { hit = true; break; }
        } else if (typeof v === 'object' && v) {
          visit(v);
        }
      }
    }
  };
  visit(product);
  return hit;
}

function findAmrodProductDeep(products, { code, search }) {
  if (code) {
    // prioritize exact canonical matches first
    const target = norm(code);
    const exact = products.find(p => {
      const fields = [extractCanonical(p), ...(Array.isArray(p.variants)?p.variants.map(extractCanonical):[])];
      return fields.map(norm).some(n => n === target);
    });
    if (exact) return { product: exact, how: `canonical:${code}` };

    // then deep match anywhere in the object
    const deep = products.find(p => productMatchesCodeDeep(p, code));
    if (deep) return { product: deep, how: `deep:${code}` };
  }

  if (search) {
    const needle = norm(search);
    const byName = products.find(p => norm(p.productName || '').includes(needle));
    if (byName) return { product: byName, how: `name~${search}` };
  }

  return { product: null, how: '' };
}

/* ---------- flatten variant-like rows ---------- */
function isLikelyCodeKey(k) { return CODE_KEY_RE.test(k) && !EXCLUDE_KEY_RE.test(k); }

function collectVariantRows(product) {
  const rows = [];
  const visit = (node, path=[]) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((c,i)=>visit(c, path.concat(`[${i}]`))); return; }

    const codes = {};
    const extras = {};
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        if (isLikelyCodeKey(k) && isLikelySkuVal(v)) codes[k] = v;
        if (COLOR_KEYS.includes(k)) extras[k] = v;
        if (SIZE_KEYS.includes(k))  extras[k] = v;
      } else if (typeof v === 'number') {
        if (SIZE_KEYS.includes(k)) extras[k] = String(v);
      }
    }

    const canonical = extractCanonical(node);

    if (Object.keys(codes).length || canonical) {
      rows.push({
        path: path.join('.'),
        productName: product.productName || '',
        ...codes,
        canonical,
        colour: extras.colour ?? extras.color ?? extras.colourName ?? extras.colour_name ?? extras.colourCode ?? extras.colorCode ?? '',
        size:   extras.size ?? extras.sizeName ?? extras.size_name ?? extras.sizeCode ?? '',
      });
    }

    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') visit(v, path.concat(k));
    }
  };

  visit(product, ['product']);
  return rows;
}

/* ---------- Shopify (optional) ---------- */
const shopify = axios.create({
  baseURL: `${SHOP_URL}/admin/api/${API_VER}`,
  headers: { 'X-Shopify-Access-Token': SHOP_TOKEN, 'Content-Type': 'application/json', 'Accept': 'application/json' },
  timeout: 60000
});

async function gql(query, variables = {}, attempt = 1) {
  try {
    const res = await shopify.post('/graphql.json', { query, variables });
    if (res.data?.errors) throw new Error(JSON.stringify(res.data.errors));
    return res.data?.data;
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

async function fetchShopifyByHandle(handle) {
  const query = `
    query ($query:String!) {
      products(first: 1, query: $query) {
        edges { node {
          id title handle options { name values }
          variants(first: 250) {
            edges { node { id title sku inventoryItem { id sku } selectedOptions { name value } } }
          }
        } }
      }
    }
  `;
  const data = await gql(query, { query: `handle:${handle}` });
  return data?.products?.edges?.[0]?.node || null;
}

async function fetchShopifyById(productId) {
  const query = `
    query ($id: ID!) {
      product(id: $id) {
        id title handle options { name values }
        variants(first: 250) {
          edges { node { id title sku inventoryItem { id sku } selectedOptions { name value } } }
        }
      }
    }
  `;
  const data = await gql(query, { id: productId });
  return data?.product || null;
}

function writeCSV(file, headers, rows) {
  const headerLine = headers.join(',');
  const body = rows.map(r => headers.map(h => escCSV(r[h])).join(',')).join('\n');
  fs.writeFileSync(file, `${headerLine}\n${body}`, 'utf8');
  console.log(`📝 Wrote ${file} (${rows.length} rows)`);
}

/* ---------- main ---------- */
async function main() {
  if (!SEARCH_CODE && !SEARCH_TEXT) {
    console.error('❌ Provide --code "JC-SL-133-A" or --search "keyword"');
    process.exit(1);
  }

  const amrodProducts = await fetchAmrodProducts();
  const { product, how } = findAmrodProductDeep(amrodProducts, { code: SEARCH_CODE, search: SEARCH_TEXT });
  if (!product) {
    console.error('❌ No Amrod product found for your filter.');
    // quick debugging aid: show a few candidates whose canonical starts with the base
    const base = SEARCH_CODE.split('-').slice(0,3).join('-'); // e.g., JC-SL-133
    const baseN = norm(base);
    const hints = amrodProducts
      .map(p => ({ p, c: norm(extractCanonical(p)) }))
      .filter(x => x.c.startsWith(baseN))
      .slice(0,5)
      .map(x => x.p.productName || extractCanonical(x.p));
    if (hints.length) console.log('🔎 Hints (canonical starts with base):', hints);
    process.exit(1);
  }
  console.log(`✅ Matched Amrod product via ${how}: ${product.productName}`);

  const keySafe = (SEARCH_CODE || product.productName || 'product').replace(/[^\w.-]+/g, '_');
  const outJson = path.resolve(process.cwd(), `amrod_product_${keySafe}.json`);
  fs.writeFileSync(outJson, JSON.stringify(product, null, 2), 'utf8');
  console.log(`💾 Saved raw product JSON: ${outJson}`);

  const rows = collectVariantRows(product);
  const codeCols = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => { if (/code|sku/i.test(k) || k === 'canonical') codeCols.add(k); }));
  const headers = ['path','productName','colour','size', ...Array.from(codeCols)];
  const outCsv = path.resolve(process.cwd(), `amrod_variant_matrix_${keySafe}.csv`);
  writeCSV(outCsv, headers, rows);

  // Optional Shopify side
  if (SHOP_URL && SHOP_TOKEN && (SH_HANDLE || SH_PRODUCT_ID)) {
    let sProd = null;
    if (SH_HANDLE) sProd = await fetchShopifyByHandle(SH_HANDLE);
    else if (SH_PRODUCT_ID) sProd = await fetchShopifyById(SH_PRODUCT_ID);

    if (!sProd) {
      console.warn('⚠️ Shopify product not found with the provided handle/id.');
    } else {
      const sv = (sProd.variants?.edges || []).map(e => e.node);
      const svRows = sv.map(v => {
        const opts = Object.fromEntries((v.selectedOptions || []).map(o => [o.name, o.value]));
        return {
          productTitle: sProd.title, handle: sProd.handle, variantId: v.id,
          variantTitle: v.title, variantSku: v.sku || '', inventoryItemSku: v.inventoryItem?.sku || '',
          optionJSON: JSON.stringify(opts)
        };
      });
      const shCsv = path.resolve(process.cwd(), `shopify_variants_${sProd.handle || keySafe}.csv`);
      writeCSV(shCsv, ['productTitle','handle','variantId','variantTitle','variantSku','inventoryItemSku','optionJSON'], svRows);
    }
  }

  console.log('\n✅ Done. Review the CSV(s) to see the variant-level codes Amrod exposes for this product.');
}

main().catch(err => { console.error('💥 Fatal:', err.message); process.exit(1); });
