import 'dotenv/config';
import axios from 'axios';

// ---- SLUGIFY FUNCTION ----
function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-+/g, '-');
}

// --- Setup
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_GRAPHQL_URL = process.env.SHOPIFY_GRAPHQL_URL;
const ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// List of metafield definitions you want to sync (as per your last message)
const METAFIELDS_TO_SYNC = [
  { namespace: 'amrod', key: 'behaviour', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'brand', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'brandings', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'brandingtemplates', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'categories', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'categorisedattribute', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'colourimages', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'companioncodes', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'decoupled', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'description', type: 'multi_line_text_field' },
  { namespace: 'amrod', key: 'displaycountryoforigin', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'feature', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'fit', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'fullcode', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'gender', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'groupingcodes', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'inclusivebranding', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'incrementedby', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'inventorytype', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'islogo24', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'logo24branding', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'logo24brandingguide', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'madetoordermessage', type: 'multi_line_text_field' },
  { namespace: 'amrod', key: 'matchingcodes', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'material', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'maximum', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'minimum', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'nocobrandingpositions', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'productname', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'promotion', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'relatedcodes', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'requiredbrandingpositions', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'simplecode', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'type', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'keywords', type: 'single_line_text_field' },
  { namespace: 'amrod', key: 'variant', type: 'variant_reference' },
  { namespace: 'amrod', key: 'madetoorder', type: 'multi_line_text_field' },
  { namespace: 'amrod', key: 'images', type: 'json' }
];

// Shopify GraphQL
async function callShopifyGraphQL(query, variables = {}) {
  const res = await axios.post(
    SHOPIFY_GRAPHQL_URL,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': ADMIN_API_TOKEN } }
  );
  if (res.data.errors) throw new Error(JSON.stringify(res.data.errors));
  return res.data.data;
}

// Find Shopify product by handle (returns GID and ID)
async function getProductGIDByHandle(handle) {
  const query = `
    query($handle: String!) {
      productByHandle(handle: $handle) { id title }
    }
  `;
  const res = await callShopifyGraphQL(query, { handle });
  return res.productByHandle?.id || null;
}

// Fetch all metafields for a product GID
async function fetchProductMetafields(gid) {
  const query = `
    query($id: ID!) {
      product(id: $id) {
        metafields(first: 50) {
          edges {
            node { namespace key value type }
          }
        }
      }
    }
  `;
  const res = await callShopifyGraphQL(query, { id: gid });
  return res.product?.metafields?.edges.map(e => e.node) || [];
}

// Upsert metafields on product (GraphQL)
async function upsertProductMetafields(ownerId, metafieldsArr) {
  if (!metafieldsArr.length) return;
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value type }
        userErrors { field message }
      }
    }
  `;
  const variables = { metafields: metafieldsArr };
  const res = await callShopifyGraphQL(mutation, variables);
  if (res.metafieldsSet.userErrors.length) {
    console.warn('User errors:', res.metafieldsSet.userErrors);
  }
  return res.metafieldsSet.metafields;
}

// Main sync
(async () => {
  // 1. Get Amrod data
  const amrodToken = await (async () => {
    const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
    const res = await axios.post(AMROD_AUTH_URL, {
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    });
    return res.data.token || res.data.access_token;
  })();

  const amrodProducts = await (async () => {
    const res = await axios.get(`${AMROD_BASE_URL}/Products/GetProductsAndBranding`, {
      headers: { Authorization: `Bearer ${amrodToken}` }
    });
    return Array.isArray(res.data) ? res.data : res.data.Products || [];
  })();

  // 2. For each product, match by simpleCode/handle, compare metafields, update if changed
  for (const product of amrodProducts) {
    const handle = slugify(product.productName || product.description || product.simpleCode || product.simplecode);
    const shopifyGID = await getProductGIDByHandle(handle);
    if (!shopifyGID) {
      console.log(`Product not found in Shopify: ${handle}`);
      continue;
    }

    // Build source metafields (from Amrod API, mapped by your logic)
    const sourceMetafields = {};
    METAFIELDS_TO_SYNC.forEach(def => {
      let value = product[def.key] ?? '';
      // fallback to API field names if needed
      if (!value && def.key !== 'description') value = product[def.key.replace(/-/g, '')] ?? '';
      // Use longDescription for 'description' if available
      if (def.key === 'description' && product.longDescription) value = product.longDescription;
      if (def.type === 'json' && typeof value !== 'string') value = JSON.stringify(value);
      sourceMetafields[def.key] = value || '';
    });

    // Fetch existing metafields
    const shopifyMetafields = await fetchProductMetafields(shopifyGID);

    // Compare and build upserts only for changed or missing metafields, skipping blank values
    const metafieldsToUpsert = [];
    for (const def of METAFIELDS_TO_SYNC) {
      const existing = shopifyMetafields.find(
        m => m.namespace === def.namespace && m.key === def.key
      );
      const newValue = sourceMetafields[def.key]?.toString() || '';
      const existingValue = existing?.value?.toString() || '';
      // SKIP BLANK VALUES
      if (!newValue) continue;
      if (newValue !== existingValue) {
        metafieldsToUpsert.push({
          ownerId: shopifyGID,
          namespace: def.namespace,
          key: def.key,
          type: def.type,
          value: newValue
        });
      }
    }

    // Upsert only if something changed
    if (metafieldsToUpsert.length) {
      await upsertProductMetafields(shopifyGID, metafieldsToUpsert);
      console.log(`Updated metafields for: ${handle} (${metafieldsToUpsert.length} changed)`);
    } else {
      console.log(`No metafield changes needed: ${handle}`);
    }
    await new Promise(resolve => setTimeout(resolve, 250)); // Throttle to avoid Shopify rate limits
  }

  console.log('\n🎉 Metafield sync complete');
})();
