import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_CATEGORIES_URL = 'https://vendorapi.amrod.co.za/api/v1/Categories';

async function main() {
  try {
    const authResponse = await fetch(AMROD_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        UserName: process.env.AMROD_EMAIL,
        Password: process.env.AMROD_PASSWORD,
        CustomerCode: process.env.AMROD_CUSTOMER_CODE,
      }),
    });

    const authData = await authResponse.json();
    if (!authResponse.ok) throw new Error(authData.message || 'Login failed');

    const token = authData.token;
    const categoriesResponse = await fetch(AMROD_CATEGORIES_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const categories = await categoriesResponse.json();
    fs.writeFileSync('amrod_categories.json', JSON.stringify(categories, null, 2));
    console.log('✅ Categories saved to amrod_categories.json');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

main();