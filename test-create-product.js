// test-create-product.js - Test creating a specific product by SKU
import 'dotenv/config';
import fetch from 'node-fetch';
import axios from 'axios';

const { SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN, AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE, SHOPIFY_LOCATION_ID } = process.env;
const SHOPIFY_API_VERSION = '2025-07';

const TEST_SKU = 'BG-AL-505-B-BL-0'; // Altitude Sisco Neoprene Laptop Sleeve

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

async function fetchAmrodProduct(sku) {
  const token = await getAmrodToken();
  const url = 'https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding';
  console.log('Fetching Amrod products...');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 120000
  });
  const data = await res.json();
  const products = Array.isArray(data) ? data : data.items || [];

  // Find product with matching SKU in variants
  return products.find(p => p.variants?.some(v => v.fullCode === sku));
}

async function createProductInShopify(product) {
  const client = axios.create({
    baseURL: `${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  console.log(`\nCreating product: ${product.productName}`);
  console.log(`Variants: ${product.variants.length}`);

  // Step 1: Create product WITHOUT variants
  const createMutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Build product options (using Amrod API field names)
  console.log('\nSample variant data:');
  console.log(JSON.stringify(product.variants[0], null, 2));

  const hasColour = product.variants.some(v => v.codeColourName || v.codeColour);
  const hasSize = product.variants.some(v => v.codeSizeName || v.codeSize);
  console.log(`Has colour? ${hasColour}`);
  console.log(`Has size? ${hasSize}`);

  const productOptions = [];
  if (hasColour) {
    const uniqueColours = [...new Set(product.variants.map(v => v.codeColourName || v.codeColour || 'Default'))];
    console.log(`Unique colours: ${uniqueColours.join(', ')}`);
    productOptions.push({
      name: 'Colour',
      values: uniqueColours.map(name => ({ name }))
    });
  }
  if (hasSize) {
    const uniqueSizes = [...new Set(product.variants.map(v => v.codeSizeName || v.codeSize || 'One Size'))];
    console.log(`Unique sizes: ${uniqueSizes.join(', ')}`);
    productOptions.push({
      name: 'Size',
      values: uniqueSizes.map(name => ({ name }))
    });
  }
  console.log(`Product options count: ${productOptions.length}`);

  const createInput = {
    title: product.productName,
    descriptionHtml: product.description || '',
    vendor: product.brand?.name || '',
    productType: product.categories?.[0]?.name || '',
    tags: [],
    templateSuffix: 'amrod-products',
    status: 'ACTIVE',
    productOptions: productOptions.length > 0 ? productOptions : undefined
  };

  console.log('\nStep 1: Creating product...');
  console.log(JSON.stringify(createInput, null, 2));

  const createResponse = await client.post('/graphql.json', {
    query: createMutation,
    variables: { input: createInput }
  });

  if (createResponse.data.errors) {
    console.error('\n❌ GraphQL Errors:');
    console.error(JSON.stringify(createResponse.data.errors, null, 2));
    throw new Error(`GraphQL errors: ${JSON.stringify(createResponse.data.errors)}`);
  }

  const createResult = createResponse.data.data.productCreate;
  if (createResult.userErrors.length > 0) {
    console.error('\n❌ User Errors:');
    console.error(JSON.stringify(createResult.userErrors, null, 2));
    throw new Error(`Product create errors: ${createResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
  }

  const createdProduct = createResult.product;
  console.log(`✅ Product created: ${createdProduct.id}`);

  // Step 2: Create variants
  const variantsMutation = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
        productVariants {
          id
          sku
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variantInputs = product.variants.slice(0, 3).map(v => { // Test with first 3 variants
    const optionValues = [];
    if (hasColour) {
      optionValues.push({
        optionName: 'Colour',
        name: v.codeColourName || v.codeColour || 'Default'
      });
    }
    if (hasSize) {
      optionValues.push({
        optionName: 'Size',
        name: v.codeSizeName || v.codeSize || 'One Size'
      });
    }
    if (optionValues.length === 0) {
      optionValues.push({
        optionName: 'Title',
        name: 'Default Title'
      });
    }

    return {
      price: "100.00",
      optionValues: optionValues,
      inventoryItem: {
        sku: v.fullCode,  // SKU goes inside inventoryItem
        cost: "50.00",
        tracked: true
      },
      inventoryQuantities: [{
        locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`,
        availableQuantity: 10
      }]
    };
  });

  console.log(`\nStep 2: Creating ${variantInputs.length} variants...`);
  console.log(JSON.stringify(variantInputs, null, 2));

  const variantsResponse = await client.post('/graphql.json', {
    query: variantsMutation,
    variables: {
      productId: createdProduct.id,
      variants: variantInputs,
      strategy: 'REMOVE_STANDALONE_VARIANT'
    }
  });

  if (variantsResponse.data.errors) {
    console.error('\n❌ GraphQL Errors creating variants:');
    console.error(JSON.stringify(variantsResponse.data.errors, null, 2));
    throw new Error(`GraphQL errors creating variants: ${JSON.stringify(variantsResponse.data.errors)}`);
  }

  const variantsResult = variantsResponse.data.data.productVariantsBulkCreate;
  if (variantsResult.userErrors.length > 0) {
    console.error('\n❌ User Errors creating variants:');
    console.error(JSON.stringify(variantsResult.userErrors, null, 2));
    throw new Error(`Variant creation errors: ${variantsResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
  }

  console.log(`✅ Created ${variantsResult.productVariants.length} variants`);
  variantsResult.productVariants.forEach(v => {
    console.log(`  - ${v.sku} (${v.id})`);
  });

  return createdProduct;
}

(async () => {
  try {
    console.log(`Testing product creation for SKU: ${TEST_SKU}\n`);

    const product = await fetchAmrodProduct(TEST_SKU);
    if (!product) {
      console.error(`Product with SKU ${TEST_SKU} not found in Amrod catalog`);
      process.exit(1);
    }

    console.log(`Found product: ${product.productName}`);

    const result = await createProductInShopify(product);
    console.log(`\n✅ SUCCESS! Product created: ${result.id}`);

  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}`);
    if (error.response) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
})();
