import 'dotenv/config';
import axios from 'axios';

const AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const BASE = 'https://vendorapi.amrod.co.za/api/v1';
const EP_WITHOUT = `${BASE}/Products/`;
const EP_WITH = `${BASE}/Products/GetProductsAndBranding`;

const TARGETS = [
  'JC-SL-133-A',
  'JC-SL-133' // base, in case the API stores size/colour elsewhere
];

const norm = s => String(s || '').toLowerCase().replace(/[-_\s]/g, '');
const looksClothing = s => /(clothing|jacket|softshell|fleece|hoodie|slazenger|workwear|headwear)/i.test(String(s||''));

async function getToken() {
  const { AMROD_EMAIL: UserName, AMROD_PASSWORD: Password, AMROD_CUSTOMER_CODE: CustomerCode } = process.env;
  if (!UserName || !Password || !CustomerCode) throw new Error('Missing AMROD_EMAIL / AMROD_PASSWORD / AMROD_CUSTOMER_CODE in .env');
  const { data } = await axios.post(AUTH_URL, { UserName, Password, CustomerCode });
  const token = data?.token || data?.access_token;
  if (!token) throw new Error('Auth OK but no token returned (check creds / API access enabled)');
  return token;
}

async function fetchAll(token, url) {
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 300000
  });
  return Array.isArray(data) ? data : [];
}

function deepFind(products, codes) {
  const targets = codes.map(norm);
  const matches = [];
  const visit = (node) => {
    if (!node) return false;
    if (typeof node === 'string') {
      const n = norm(node);
      return targets.some(t => n === t || n.startsWith(t));
    }
    if (Array.isArray(node)) {
      for (const c of node) if (visit(c)) return true;
      return false;
    }
    if (typeof node === 'object') {
      for (const v of Object.values(node)) if (visit(v)) return true;
      return false;
    }
    return false;
  };

  for (const p of products) {
    if (visit(p)) {
      matches.push({
        productName: p.productName || p.ProductName || '',
        code:
          p.simpleCode ?? p.SimpleCode ??
          p.fullCode   ?? p.FullCode   ??
          p.code       ?? p.Code       ??
          p.sku        ?? p.SKU        ?? '',
      });
    }
  }
  return matches;
}

function summarize(products) {
  const brandMap = new Map();
  const catMap = new Map();
  let clothingHits = 0, slazengerHits = 0;

  for (const p of products) {
    const brand = p.brandName || p.BrandName || p.brand || '';
    if (brand) brandMap.set(brand, (brandMap.get(brand) || 0) + 1);
    if (/slazenger/i.test(brand)) slazengerHits++;

    const cats = Array.isArray(p.categories) ? p.categories : [];
    for (const c of cats) {
      const name = c?.name || c?.Name || '';
      if (name) catMap.set(name, (catMap.get(name) || 0) + 1);
      if (looksClothing(name)) clothingHits++;
    }
  }

  const top = (m, n=10) => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n);
  return { clothingHits, slazengerHits, topBrands: top(brandMap), topCats: top(catMap) };
}

async function main() {
  console.log('🔐 Getting Amrod token…');
  const token = await getToken();
  console.log('✅ Token OK');

  console.log('📥 Fetching Products WITHOUT branding…');
  const prodsNoBrand = await fetchAll(token, EP_WITHOUT);
  console.log(`   Count: ${prodsNoBrand.length}`);

  console.log('📥 Fetching Products WITH branding…');
  const prodsWithBrand = await fetchAll(token, EP_WITH);
  console.log(`   Count: ${prodsWithBrand.length}`);

  // Deep search for our targets
  const mNo = deepFind(prodsNoBrand, TARGETS);
  const mWith = deepFind(prodsWithBrand, TARGETS);

  console.log('\n🔎 Search results for:', TARGETS.join(', '));
  console.log(`   In WITHOUT branding: ${mNo.length}`);
  console.log(`   In WITH branding:    ${mWith.length}`);
  if (mNo.length) console.log('   Samples (no-brand):', mNo.slice(0,5));
  if (mWith.length) console.log('   Samples (with-brand):', mWith.slice(0,5));

  // Quick category/brand signals to confirm Clothing presence
  const sumNo = summarize(prodsNoBrand);
  const sumWith = summarize(prodsWithBrand);

  console.log('\n== Signals (WITHOUT branding) ==');
  console.log(`   Clothing-like category hits: ${sumNo.clothingHits}`);
  console.log(`   Slazenger brand hits:        ${sumNo.slazengerHits}`);
  console.log('   Top brands:', sumNo.topBrands);
  console.log('   Top categories:', sumNo.topCats);

  console.log('\n== Signals (WITH branding) ==');
  console.log(`   Clothing-like category hits: ${sumWith.clothingHits}`);
  console.log(`   Slazenger brand hits:        ${sumWith.slazengerHits}`);
  console.log('   Top brands:', sumWith.topBrands);
  console.log('   Top categories:', sumWith.topCats);

  console.log('\n✅ Done.');
}

main().catch(err => {
  console.error('💥 Fatal:', err.message);
  if (err.response?.status === 204) {
    console.error('Received 204 (No Content). If this was between 00:00–01:00 GMT+2, the API is intentionally offline. Try again later.');
  }
  process.exit(1);
});
