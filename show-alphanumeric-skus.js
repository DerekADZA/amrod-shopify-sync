// show-alphanumeric-skus.js
import 'dotenv/config';
import fetch from 'node-fetch';

const { SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_API_VERSION } = process.env;
const SHOPIFY_BASE = `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/${SHOPIFY_API_VERSION}`;

async function main() {
  console.log('Fetching products...\n');

  const query = `
    query {
      products(first: 100, query: "vendor:Amrod") {
        edges {
          node {
            title
            vendor
            variants(first: 10) {
              edges {
                node {
                  sku
                  displayName
                  selectedOptions {
                    name
                    value
                  }
                  image { id }
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(`${SHOPIFY_BASE}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  const { data } = await res.json();
  const products = data.products.edges.map(e => e.node);

  console.log(`Found ${products.length} products with vendor "Amrod"\n`);

  for (const product of products.slice(0, 20)) {
    console.log(`\n📦 "${product.title}"`);
    console.log(`   Vendor: ${product.vendor}`);

    for (const v of product.variants.edges.slice(0, 3)) {
      const variant = v.node;
      const colorOption = variant.selectedOptions.find(o =>
        o.name.toLowerCase() === 'colour' || o.name.toLowerCase() === 'color'
      );
      const sizeOption = variant.selectedOptions.find(o =>
        o.name.toLowerCase() === 'size'
      );

      console.log(`   • SKU: ${variant.sku}`);
      console.log(`     Display: ${variant.displayName}`);
      console.log(`     Color: ${colorOption?.value || 'N/A'}, Size: ${sizeOption?.value || 'N/A'}`);
      console.log(`     Has Image: ${variant.image?.id ? 'Yes' : 'No'}`);
    }
  }
}

main().catch(console.error);
