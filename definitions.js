// index.js (ES Module – Product Sync)
import 'dotenv/config';
import axios from 'axios';
// ... (your full sync script lives here unchanged)
// Make sure this file exports the upsert logic
export { upsertProduct };


// definitions.js (ES Module – Metafield Definitions Creator)
import 'dotenv/config';
import axiosGraph from 'axios';

const SHOPIFY_GRAPHQL_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`;
const shopifyGraphQL = axiosGraph.create({
  baseURL: SHOPIFY_GRAPHQL_URL,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json'
  }
});

// List your metafield definitions here
const definitions = [
  { namespace: 'amrod', key: 'simple-code', name: 'Simple Code', type: 'single_line_text_field', description: 'AMROD simple code' },
  { namespace: 'amrod', key: 'long-description', name: 'Long Description', type: 'multi_line_text_field', description: 'Detailed description' },
  // ...add one entry per key you need
];

async function createDefinition(def) {
  const mutation = `
    mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id namespace key }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    definition: {
      ownerType: PRODUCT,
      namespace: def.namespace,
      key: def.key,
      name: def.name,
      type: def.type,
      description: def.description,
      selectable: true,
      visibleToStorefrontApi: false
    }
  };
  const res = await shopifyGraphQL.post('', { query: mutation, variables });
  return res.data;
}

(async () => {
  for (const def of definitions) {
    try {
      const result = await createDefinition(def);
      const errs = result.data?.metafieldDefinitionCreate?.userErrors;
      if (errs?.length) console.error('❌ Definition error:', errs);
      else console.log(`✅ Created definition ${def.namespace}.${def.key}`);
    } catch (e) {
      console.error('❌ GraphQL error:', e.response?.data || e.message);
    }
  }
})();
