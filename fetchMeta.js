import 'dotenv/config';
import axios from 'axios';

const GRAPHQL_URL = process.env.SHOPIFY_GRAPHQL_URL;
const ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// GraphQL: fetch all product and variant metafield definitions
const QUERY = `
{
  productMetafields: metafieldDefinitions(first: 250, ownerType: PRODUCT) {
    edges {
      node {
        namespace
        key
        name
        type { name }
        description
      }
    }
  }
  variantMetafields: metafieldDefinitions(first: 250, ownerType: PRODUCTVARIANT) {
    edges {
      node {
        namespace
        key
        name
        type { name }
        description
      }
    }
  }
}
`;

(async () => {
  try {
    const res = await axios.post(
      GRAPHQL_URL,
      { query: QUERY },
      { headers: { 'X-Shopify-Access-Token': ADMIN_API_TOKEN } }
    );

    if (res.data.errors) throw new Error(JSON.stringify(res.data.errors));

    const products = res.data.data.productMetafields.edges.map(e => e.node);
    const variants = res.data.data.variantMetafields.edges.map(e => e.node);

    function printDefs(defs, label) {
      if (!defs.length) {
        console.log(`No metafield definitions for ${label}.`);
        return;
      }
      console.log(`\n=== ${label.toUpperCase()} METAFIELD DEFINITIONS ===`);
      defs.forEach(def => {
        console.log(
          `Namespace: ${def.namespace}\n` +
          `  Key: ${def.key}\n` +
          `  Type: ${def.type.name}\n` +
          `  Name: ${def.name}\n` +
          `  Description: ${def.description || ''}\n`
        );
      });
    }

    printDefs(products, "Product");
    printDefs(variants, "Variant");

    console.log('\n✅ Done. Metafield definitions/types listed.');
  } catch (err) {
    console.error('❌ Fatal error:', err.response?.data || err.message);
  }
})();
