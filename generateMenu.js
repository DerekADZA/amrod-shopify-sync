import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const SHOPIFY_GRAPHQL_URL = process.env.SHOPIFY_GRAPHQL_URL;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

const headers = {
  'Content-Type': 'application/json',
  'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
};

// ✅ UPDATED: Now reads from amrod_menu_2.json
const menuData = JSON.parse(fs.readFileSync('./amrod_menu_2.json', 'utf-8'));

if (!menuData.title || !menuData.handle || !Array.isArray(menuData.items)) {
  console.error('❌ Invalid JSON structure. Must include title, handle, and items array.');
  process.exit(1);
}

const mutation = `
mutation CreateMenu($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
  menuCreate(title: $title, handle: $handle, items: $items) {
    menu {
      id
      handle
      items {
        id
        title
        items {
          id
          title
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

const variables = {
  title: menuData.title,
  handle: menuData.handle,
  items: menuData.items
};

const payload = {
  query: mutation,
  variables,
};

async function uploadMenu() {
  try {
    const response = await fetch(SHOPIFY_GRAPHQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (data.errors || data.data.menuCreate.userErrors.length > 0) {
      console.error('❌ Failed to create menu:', JSON.stringify(data.errors || data.data.menuCreate.userErrors, null, 2));
    } else {
      console.log('✅ Menu created successfully:', data.data.menuCreate.menu);
    }
  } catch (err) {
    console.error('❌ Error creating menu:', err);
  }
}

uploadMenu();
