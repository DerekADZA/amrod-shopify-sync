// inspect-stock.js - See what the Stock API returns

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

async function fetchStock() {
  const token = await getAmrodToken();
  const url   = 'https://vendorapi.amrod.co.za/api/v1/Stock/';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data;
}

(async () => {
  console.log('Fetching stock data...\n');
  const stock = await fetchStock();

  const items = Array.isArray(stock) ? stock : stock.items || [];

  console.log(`Total stock entries: ${items.length}\n`);

  // Check Type 2 entries
  const type2 = items.filter(s => Number(s.stockType) === 2);
  console.log(`Type 2 (variant) entries: ${type2.length}\n`);

  if (type2.length > 0) {
    console.log('=== SAMPLE TYPE 2 STOCK ENTRY ===');
    console.log(JSON.stringify(type2[0], null, 2));

    console.log('\n=== FIELDS AVAILABLE ===');
    console.log(Object.keys(type2[0]));
  }

  // Save full sample
  fs.writeFileSync('stock_sample.json', JSON.stringify(type2.slice(0, 10), null, 2));
  console.log('\n10 stock entries saved to stock_sample.json');
})();
