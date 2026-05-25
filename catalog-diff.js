// catalog-diff.js
// v3 — Robust diff: deep Amrod scan + inventoryItem SKUs + family prefix matching
//
// Output: catalog_diff.csv, catalog_diff.json
//
// CLI (PowerShell):
//   node .\catalog-diff.js
//   node .\catalog-diff.js --vendor "Amrod"
//
// Required .env:
//   SHOPIFY_STORE_URL=https://your-store.myshopify.com
//   SHOPIFY_ADMIN_API_TOKEN=shpat_xxx
//   AMROD_EMAIL=...
//   AMROD_PASSWORD=...
//   AMROD_CUSTOMER_CODE=...
//
// Optional .env:
//   VENDOR_FILTER=Amrod
//   NORMALIZE_STRIP_PUNCT=1
//   AMROD_MAX_SCAN_DEPTH=6
//   AMROD_INCLUDE_REGEX=(?:^|_)(sku|code)$
//   AMROD_EXCLUDE_REGEX=(barcode|ean|gtin)
//   FAMILY_ENABLE_PREFIX=1
//   FAMILY_MAX_SUFFIX_TOKENS=2
//   FAMILY_SHORT_TOKEN_MAXLEN=3

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

/* ---------- CLI args ---------- */
const ARGV = new Map(
  process.argv.slice(2).flatMap(arg => {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) return [[arg, true]];
    return [[m[1], m[2] ?? true]];
  })
);
const hasFlag = (k) => ARGV.has(k) && ARGV.get(k) !== 'false';

/* ---------- Config ---------- */
// Shopify
const SHOP_URL   = process.env.SHOPIFY_STORE_URL;
const SHOP_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VER    = '2025-07';

// Amrod
const AMROD_AUTH_URL     = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL     = 'https://vendorapi.amrod.co.za';
const AMROD_API_VERSION  = '1';
const AMROD_PRODUCTS_URL = `${AMROD_BASE_URL}/api/v${AMROD_API_VERSION}/Products/GetProductsAndBranding`;

// Behavior
const VENDOR_FILTER          = (ARGV.get('vendor') ?? process.env.VENDOR_FILTER ?? '').toString();
const NORMALIZE_STRIP_PUNCT  = (process.env.NORMALIZE_STRIP_PUNCT ?? '1') === '1';

// Deep scan
const AMROD_MAX_SCAN_DEPTH = Number(process.env.AMROD_MAX_SCAN_DEPTH ?? 6);
const AMROD_INCLUDE_REGEX  = new RegExp(process.env.AMROD_INCLUDE_REGEX ?? '(?:^|_)(sku|code)$', 'i');
const AMROD_EXCLUDE_REGEX  = new RegExp(process.env.AMROD_EXCLUDE_REGEX ?? '(barcode|ean|gtin)', 'i');

// Family matching
const FAMILY_ENABLE_PREFIX       = (process.env.FAMILY_ENABLE_PREFIX ?? '1') === '1';
const FAMILY_MAX_SUFFIX_TOKENS   = Number(process.env.FAMILY_MAX_SUFFIX_TOKENS ?? 2);
const FAMILY_SHORT_TOKEN_MAXLEN  = Number(process.env.FAMILY_SHORT_TOKEN_MAXLEN ?? 3);

// Output
const OUT_CSV = path.resolve(process.cwd(), 'catalog_diff.csv');
const OUT_JSON = path.resolve(process.cwd(), 'catalog_diff.json');

/* ---------- Safety ---------- */
if (!SHOP_URL || !SHOP_TOKEN) {
  console.error('❌ Missing Shopify env: SHOPIFY_STORE_URL and/or SHOPIFY_ADMIN_API_TOKEN');
  process.exit(1);
}
['AMROD_EMAIL','AMROD_PASSWORD','AMROD_CUSTOMER_CODE'].forEach(k=>{
  if (!process.env[k]) { console.error(`❌ Missing env ${k}`); process.exit(1); }
});

/* ---------- Helpers ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const escCSV = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
};
const norm = (s) => {
  if (!s) return '';
  let t = String(s).toLowerCase().trim();
  if (NORMALIZE_STRIP_PUNCT) t = t.replace(/[-\s]/g,'');
  return t;
};

// Prefer exact Amrod field ordering (verbatim)
const canonicalFromAmrod = (row={}) =>
  row.simpleCode ?? row.SimpleCode ??
  row.fullCode   ?? row.FullCode   ??
  row.code       ?? row.Code       ??
  row.sku        ?? row.SKU        ?? '';

/* ---------- Shopify GraphQL client ---------- */
const shopify = axios.create({
  baseURL: `${SHOP_URL}/admin/api/${API_VER}`,
  headers: {
    'X-Shopify-Access-Token': SHOP_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  },
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
      console.warn(`⏳ 429 rate limit. Backing off ${backoff}ms (attempt ${attempt})…`);
      await sleep(backoff);
      return gql(query, variables, attempt + 1);
    }
    console.error('❌ GraphQL request failed:', status || '', err.message);
    if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
    throw err;
  }
}

/* ---------- Amrod fetch ---------- */
async function getAmrodToken() {
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  const res = await axios.post(AMROD_AUTH_URL, {
    UserName: AMROD_EMAIL,
    Password: AMROD_PASSWORD,
    CustomerCode: AMROD_CUSTOMER_CODE
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

/* ---------- Amrod deep scan ---------- */
function isLikelySku(v) {
  const s = String(v).trim();
  if (s.length < 2 || s.length > 64) return false;
  return /^[A-Za-z0-9._/-]+$/.test(s);
}
function harvestCodesFromObject(obj) {
  const out = [];
  if (typeof obj !== 'object' || !obj) return out;
  const canonical = canonicalFromAmrod(obj);
  if (canonical && isLikelySku(canonical)) out.push(String(canonical));

  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string') continue;
    if (!AMROD_INCLUDE_REGEX.test(k) || AMROD_EXCLUDE_REGEX.test(k)) continue;
    if (!isLikelySku(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
function buildAmrodSkuMapDeep(amrodProducts) {
  const map = new Map(); // normSKU -> { canonical, productName, raw, path[] }
  let count = 0;

  const push = (sku, ctx) => {
    const canonical = String(sku).trim();
    const key = norm(canonical);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        canonical,
        productName: ctx.productName || '',
        raw: ctx.raw,
        path: ctx.path?.slice?.() || []
      });
      count++;
    }
  };

  const traverse = (node, ctx, depth, path=[]) => {
    if (depth > AMROD_MAX_SCAN_DEPTH) return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => traverse(child, ctx, depth + 1, path.concat(`[${i}]`)));
      return;
    }
    if (typeof node !== 'object' || !node) return;

    const productName = node.productName || ctx.productName;

    const codes = harvestCodesFromObject(node);
    for (const code of codes) push(code, { productName, raw: node, path });

    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') {
        traverse(v, { productName }, depth + 1, path.concat(k));
      }
    }
  };

  amrodProducts.forEach((p, idx) => {
    traverse(p, { productName: p.productName || '' }, 0, [`product[${idx}]`]);
  });

  console.log(`📦 Amrod canonical+variant SKUs (deep): ${count}`);
  return map;
}

/* ---------- Shopify: page ALL variants with inventoryItem ---------- */
async function fetchAllShopifyVariants() {
  console.log('🔍 Fetching ALL Shopify variants via productVariants (250/page)…');
  const query = `
    query AllVariants($first:Int!, $after:String){
      productVariants(first:$first, after:$after){
        pageInfo{ hasNextPage endCursor }
        edges{
          node{
            id
            sku
            title
            price
            inventoryItem { id sku }
            product{ id title handle vendor productType }
          }
        }
      }
    }
  `;
  const first = 250;
  let after = null, page = 0, list = [];
  while (true) {
    page++;
    const data = await gql(query, { first, after });
    const conn = data?.productVariants;
    const edges = conn?.edges || [];
    for (const e of edges) {
      const n = e.node;
      if (VENDOR_FILTER && (n.product?.vendor || '') !== VENDOR_FILTER) continue;
      list.push({
        // inventoryItem.sku is authoritative
        sku: n.inventoryItem?.sku || n.sku || '',
        variantSku: n.sku || '',
        inventoryItemSku: n.inventoryItem?.sku || '',
        inventoryItemId: n.inventoryItem?.id || '',
        variantId: n.id,
        variantTitle: n.title,
        price: n.price,
        productId: n.product?.id,
        productTitle: n.product?.title,
        handle: n.product?.handle,
        vendor: n.product?.vendor || '',
        productType: n.product?.productType || ''
      });
    }
    console.log(`   ✅ Page ${page}: +${edges.length} (total ${list.length})`);
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
    await sleep(200);
  }
  console.log(`✅ Shopify variants fetched: ${list.length}${VENDOR_FILTER ? ` (vendor=${VENDOR_FILTER})` : ''}`);
  return list;
}

/* ---------- Family prefix index ---------- */
// Build an index so any Shopify SKU contributes prefixes (parent candidates).
// Example: "af-am-7-d-0-0" contributes "af-am-7-d" (drop 1), and possibly "af-am-7" (drop 2 if short).
function shortToken(t) {
  return t.length <= FAMILY_SHORT_TOKEN_MAXLEN || /^\d{1,4}$/i.test(t);
}
function familyBasesForShopifySku(sku) {
  const bases = new Set();
  const raw = (sku || '').trim();
  if (!raw) return [];
  const base0 = raw.replace(/-0(?:-\d+)*$/i, ''); // drop trailing -0-0 stacks
  if (base0 !== raw) bases.add(base0);

  const parts = raw.split('-');
  if (parts.length >= 2) {
    bases.add(parts.slice(0, -1).join('-'));
  }
  if (FAMILY_MAX_SUFFIX_TOKENS >= 2 && parts.length >= 3 && shortToken(parts[parts.length-1]) && shortToken(parts[parts.length-2])) {
    bases.add(parts.slice(0, -2).join('-'));
  }
  return Array.from(bases);
}

function indexShopify(variants) {
  const exact = new Map();   // normSKU -> [rows]
  const family = new Map();  // normPrefix -> [rows]

  for (const v of variants) {
    const sku = (v.sku || '').trim();
    const varSku = (v.variantSku || '').trim();

    // exact index on inventoryItem.sku
    if (sku) {
      const n = norm(sku);
      if (!exact.has(n)) exact.set(n, []);
      exact.get(n).push(v);

      if (FAMILY_ENABLE_PREFIX) {
        for (const base of familyBasesForShopifySku(sku)) {
          const nb = norm(base);
          if (!family.has(nb)) family.set(nb, []);
          family.get(nb).push(v);
        }
      }
    }

    // also index variant.sku for normalized matches (without adding family prefixes a second time)
    if (varSku) {
      const nv = norm(varSku);
      if (!exact.has(nv)) exact.set(nv, []);
      exact.get(nv).push(v);
    }
  }

  return { exact, family };
}

/* ---------- Diff ---------- */
function buildDiff(amrodMap, shopifyVariants) {
  const rows = [];
  const idx = indexShopify(shopifyVariants);

  // 1) Amrod → Shopify matches
  for (const [amrodNorm, a] of amrodMap.entries()) {
    // exact/normalized match (inventoryItem or variant sku)
    const exactHits = idx.exact.get(amrodNorm);
    if (exactHits && exactHits.length) {
      for (const s of exactHits) {
        const hitType =
          norm(s.sku || '') === amrodNorm ? 'matched_exact' :
          'matched_variant_sku';
        rows.push({
          status: hitType,
          match_reason: hitType === 'matched_exact' ? 'inventoryItemSku_norm_equal' : 'variantSku_norm_equal',
          sku: s.sku || s.variantSku,
          amrod_productName: a.productName,
          shopify_productTitle: s.productTitle,
          shopify_handle: s.handle,
          shopify_vendor: s.vendor,
          shopify_productId: s.productId,
          shopify_variantId: s.variantId,
          shopify_variantTitle: s.variantTitle,
          shopify_price: s.price
        });
      }
      continue;
    }

    // family prefix coverage (Shopify child extends Amrod parent)
    const famHits = idx.family.get(amrodNorm);
    if (FAMILY_ENABLE_PREFIX && famHits && famHits.length) {
      const s = famHits[0];
      rows.push({
        status: 'covered_by_child',
        match_reason: 'family_prefix',
        sku: a.canonical,
        amrod_productName: a.productName,
        shopify_productTitle: s.productTitle,
        shopify_handle: s.handle,
        shopify_vendor: s.vendor,
        shopify_productId: s.productId,
        shopify_variantId: s.variantId,
        shopify_variantTitle: s.variantTitle,
        shopify_price: s.price
      });
      continue;
    }

    // missing
    rows.push({
      status: 'missing_in_shopify',
      match_reason: 'no_match',
      sku: a.canonical,
      amrod_productName: a.productName
    });
  }

  // 2) Orphans: Shopify that Amrod doesn’t have (exclude anything already matched via exact index)
  const amrodKeys = new Set(amrodMap.keys());
  for (const v of shopifyVariants) {
    const s = (v.sku || '').trim();
    const n = norm(s);
    if (!s) continue;
    if (amrodKeys.has(n)) continue; // exact matched

    // If Amrod has the family parent, we don’t call it orphan
    const parts = s.split('-');
    let coveredByParent = false;
    for (let drop = 1; drop <= Math.min(FAMILY_MAX_SUFFIX_TOKENS, parts.length - 1); drop++) {
      const parent = parts.slice(0, parts.length - drop).join('-');
      const np = norm(parent);
      if (amrodKeys.has(np)) { coveredByParent = true; break; }
    }
    if (coveredByParent) continue;

    rows.push({
      status: 'orphan_in_shopify',
      match_reason: 'not_in_amrod',
      sku: s,
      shopify_productTitle: v.productTitle,
      shopify_handle: v.handle,
      shopify_vendor: v.vendor,
      shopify_productId: v.productId,
      shopify_variantId: v.variantId,
      shopify_variantTitle: v.variantTitle,
      shopify_price: v.price
    });
  }

  return rows;
}

/* ---------- Output ---------- */
function toCSV(rows) {
  const headers = [
    'status',
    'match_reason',
    'sku',
    'amrod_productName',
    'shopify_productTitle',
    'shopify_handle',
    'shopify_vendor',
    'shopify_productId',
    'shopify_variantId',
    'shopify_variantTitle',
    'shopify_price'
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.status,
      r.match_reason || '',
      r.sku || '',
      r.amrod_productName || '',
      r.shopify_productTitle || '',
      r.shopify_handle || '',
      r.shopify_vendor || '',
      r.shopify_productId || '',
      r.shopify_variantId || '',
      r.shopify_variantTitle || '',
      r.shopify_price ?? ''
    ].map(escCSV).join(','));
  }
  return lines.join('\n');
}

/* ---------- Main ---------- */
async function main() {
  console.log('🧮 Catalog Diff: Amrod ↔ Shopify (v3, robust)');
  if (VENDOR_FILTER) console.log(`Vendor filter: ${VENDOR_FILTER}`);
  console.log(`Family prefix matching: ${FAMILY_ENABLE_PREFIX ? 'ON' : 'OFF'} (maxSuffixTokens=${FAMILY_MAX_SUFFIX_TOKENS}, shortTokenMaxLen=${FAMILY_SHORT_TOKEN_MAXLEN})`);

  const [amrodProducts, shopifyVariants] = await Promise.all([
    fetchAmrodProducts(),
    fetchAllShopifyVariants()
  ]);

  const amrodMap = buildAmrodSkuMapDeep(amrodProducts);
  const rows = buildDiff(amrodMap, shopifyVariants);

  fs.writeFileSync(OUT_CSV, toCSV(rows), 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify(rows, null, 2), 'utf8');

  const summary = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log('✅ Done.');
  console.log('   Summary:', summary);
  console.log('   CSV:', OUT_CSV);
  console.log('   JSON:', OUT_JSON);
}

main().catch(err => {
  console.error('💥 Fatal:', err.message);
  process.exit(1);
});
