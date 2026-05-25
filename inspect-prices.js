// inspect-prices.js - Investigate the Prices API endpoint

import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs';

const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;

async function getAmrodToken() {
  const res = await fetch('https://identity.amrod.co.za/VendorLogin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    })
  });
  const body = await res.json();
  return body.token || body.access_token;
}

async function fetchPrices() {
  const token = await getAmrodToken();
  const url = 'https://vendorapi.amrod.co.za/api/v1/Prices/';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data;
}

(async () => {
  console.log('Fetching price data from /api/v1/Prices/...\n');
  const prices = await fetchPrices();

  const items = Array.isArray(prices) ? prices : prices.items || [];

  console.log(`Total price entries: ${items.length}\n`);

  if (items.length > 0) {
    console.log('=== SAMPLE PRICE ENTRY ===');
    console.log(JSON.stringify(items[0], null, 2));

    console.log('\n=== FIELDS AVAILABLE ===');
    console.log(Object.keys(items[0]));

    console.log('\n=== SAMPLE PRICES (First 10) ===');
    items.slice(0, 10).forEach((item, i) => {
      console.log(`${i + 1}. ${item.fullCode || item.sku || item.code}: R${item.cost || item.price || item.unitPrice || '???'}`);
    });
  }

  // Save sample
  fs.writeFileSync('prices_sample.json', JSON.stringify(items.slice(0, 20), null, 2));
  console.log('\n✅ 20 price entries saved to prices_sample.json');
})();
