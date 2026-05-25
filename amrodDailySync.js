import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za'
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const API_VERSION = '1'

// Updated products endpoint
const AMROD_UPDATED_PRODUCTS_URL = `${AMROD_BASE_URL}/api/v${API_VERSION}/Products/GetUpdatedProductsAndBranding`
const AMROD_PRICES_URL = `${AMROD_BASE_URL}/api/v${API_VERSION}/Prices/`

console.log('🔧 API Configuration:')
console.log(`   Base URL: ${AMROD_BASE_URL}`)
console.log(`   Auth URL: ${AMROD_AUTH_URL}`)
console.log(`   Updated Products Endpoint: ${AMROD_UPDATED_PRODUCTS_URL}`)
console.log(`   Prices Endpoint: ${AMROD_PRICES_URL}`)
console.log('')

const PRICE_MARKUP = 1.43
const SLEEP_MS = 300

// --- Axios Clients ---
const shopifyGraphQLClient = axios.create({
  baseURL: `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 60000
})

const sleep = ms => new Promise(r => setTimeout(r, ms))

// --- AUTH FUNCTION ---
async function getAmrodToken() {
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env
  if (!AMROD_EMAIL || !AMROD_PASSWORD || !AMROD_CUSTOMER_CODE) {
    console.error('❌ Missing Amrod credentials')
    process.exit(1)
  }
  
  try {
    console.log('🔐 Attempting Amrod authentication...')
    const res = await axios.post(AMROD_AUTH_URL, {
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    })
    
    const token = res.data.token || res.data.access_token
    if (!token) throw new Error('No token returned')
    
    console.log('✅ Amrod token received')
    return token
  } catch (err) {
    console.error('❌ Amrod auth failed:', err.response?.data || err.message)
    process.exit(1)
  }
}

// --- FETCH UPDATED PRODUCTS ---
async function fetchUpdatedProducts(token) {
  try {
    console.log('🔍 Fetching updated products from Amrod (changes since yesterday)...')
    console.log(`   URL: ${AMROD_UPDATED_PRODUCTS_URL}`)
    
    const res = await axios.get(AMROD_UPDATED_PRODUCTS_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    })
    
    console.log(`✅ Response status: ${res.status}`)
    console.log(`📊 Response data type: ${typeof res.data}`)
    console.log(`📊 Response data length: ${Array.isArray(res.data) ? res.data.length : 'Not an array'}`)
    
    // Debug the response structure
    if (res.data && typeof res.data === 'object') {
      console.log(`📊 Response keys: ${Object.keys(res.data).join(', ')}`)
      
      // Sample first item if it's an array
      if (Array.isArray(res.data) && res.data.length > 0) {
        console.log(`📊 First item keys: ${Object.keys(res.data[0]).join(', ')}`)
        if (res.data[0].actionType !== undefined) {
          console.log(`📊 First item actionType: ${res.data[0].actionType}`)
        }
      }
    }
    
    const updatedProducts = res.data || []
    console.log(`✅ Successfully fetched ${Array.isArray(updatedProducts) ? updatedProducts.length : 'unknown count'} updated products`)
    return updatedProducts
  } catch (err) {
    console.error('❌ Failed to fetch updated products:')
    console.error(`   Status: ${err.response?.status || 'No status'}`)
    console.error(`   Status Text: ${err.response?.statusText || 'No status text'}`)
    
    if (err.response?.data) {
      console.error('   Response data:', JSON.stringify(err.response.data, null, 2))
    }
    process.exit(1)
  }
}

// --- FETCH CURRENT PRICES ---
async function fetchCurrentPrices(token) {
  try {
    console.log('🔍 Fetching current Amrod pricing data...')
    
    const res = await axios.get(AMROD_PRICES_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    })
    
    const prices = res.data || []
    console.log(`✅ Successfully fetched ${Array.isArray(prices) ? prices.length : 'unknown count'} price records`)
    return prices
  } catch (err) {
    console.error('❌ Failed to fetch prices:', err.response?.status, err.response?.statusText)
    return []
  }
}

// --- ANALYZE UPDATED PRODUCTS ---
function analyzeUpdatedProducts(updatedProducts) {
  console.log('\n🔍 ANALYZING UPDATED PRODUCTS...')
  
  const analysis = {
    created: [],      // ActionType: 0
    updated: [],      // ActionType: 1  
    removed: [],      // ActionType: 2
    unknown: []       // Any other ActionType
  }
  
  for (const product of updatedProducts) {
    const actionType = product.actionType || product.ActionType
    
    switch(actionType) {
      case 0:
        analysis.created.push(product)
        break
      case 1:
        analysis.updated.push(product)
        break
      case 2:
        analysis.removed.push(product)
        break
      default:
        analysis.unknown.push(product)
        break
    }
  }
  
  console.log(`📊 Updated products breakdown:`)
  console.log(`   🆕 Created: ${analysis.created.length}`)
  console.log(`   🔄 Updated: ${analysis.updated.length}`)
  console.log(`   🗑️  Removed: ${analysis.removed.length}`)
  console.log(`   ❓ Unknown action: ${analysis.unknown.length}`)
  
  return analysis
}

// --- FIND SHOPIFY PRODUCTS BY SKU ---
async function findShopifyProductsBySku(skus) {
  console.log(`\n🔍 Finding Shopify products for ${skus.length} SKUs...`)
  
  const foundProducts = new Map()
  
  // Process SKUs in batches to avoid overwhelming GraphQL
  const batchSize = 50
  for (let i = 0; i < skus.length; i += batchSize) {
    const batchSkus = skus.slice(i, i + batchSize)
    
    console.log(`   📦 Searching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(skus.length/batchSize)}...`)
    
    // Build search query for this batch
    const skuQueries = batchSkus.map(sku => `sku:${sku}`).join(' OR ')
    
    const query = `
      query FindProductsBySku($query: String!) {
        products(first: 250, query: $query) {
          edges {
            node {
              id
              title
              vendor
              status
              variants(first: 50) {
                edges {
                  node {
                    id
                    sku
                    price
                    title
                  }
                }
              }
            }
          }
        }
      }
    `
    
    try {
      const response = await shopifyGraphQLClient.post('/graphql.json', {
        query,
        variables: { query: skuQueries }
      })
      
      const products = response.data.data.products.edges
      
      for (const productEdge of products) {
        const product = productEdge.node
        
        for (const variantEdge of product.variants.edges) {
          const variant = variantEdge.node
          if (variant.sku && batchSkus.includes(variant.sku.toLowerCase())) {
            foundProducts.set(variant.sku.toLowerCase(), {
              productId: product.id.replace('gid://shopify/Product/', ''),
              productGid: product.id,
              productTitle: product.title,
              vendor: product.vendor,
              status: product.status,
              variantId: variant.id.replace('gid://shopify/ProductVariant/', ''),
              variantGid: variant.id,
              sku: variant.sku,
              currentPrice: parseFloat(variant.price),
              variantTitle: variant.title
            })
          }
        }
      }
      
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error(`❌ Error searching for SKUs:`, err.response?.data || err.message)
    }
  }
  
  console.log(`✅ Found ${foundProducts.size} existing Shopify products`)
  return foundProducts
}

// --- PRICE ROUNDING ---
function roundPrice(price) {
  let p = Math.ceil(price)
  return (p - 0.01 + 1).toFixed(2)
}

// --- UPDATE PRODUCT PRICES ---
async function updateProductPrices(productsToUpdate, priceMap) {
  console.log(`\n💰 Updating prices for ${productsToUpdate.length} products...`)
  
  let updated = 0
  let failed = 0
  let skipped = 0
  
  for (let i = 0; i < productsToUpdate.length; i++) {
    const product = productsToUpdate[i]
    const sku = product.sku.toUpperCase()
    
    if (i % 50 === 0) {
      console.log(`   📦 Processing ${i + 1}/${productsToUpdate.length}...`)
    }
    
    // Get current Amrod price
    const amrodPrice = priceMap.get(sku)
    if (!amrodPrice) {
      console.log(`   ⚠️  No price found for ${product.sku}, skipping...`)
      skipped++
      continue
    }
    
    // Calculate correct price
    const correctPrice = parseFloat(roundPrice(amrodPrice * PRICE_MARKUP))
    const currentPrice = product.currentPrice
    const priceDifference = Math.abs(correctPrice - currentPrice)
    
    // Skip if price is already correct (within 5 cent tolerance)
    if (priceDifference <= 0.05) {
      skipped++
      continue
    }
    
    console.log(`   🔧 Updating ${product.sku}: R${currentPrice} → R${correctPrice}`)
    
    const mutation = `
      mutation UpdateVariantPrice($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
            price
            sku
          }
          userErrors {
            field
            message
          }
        }
      }
    `
    
    try {
      const response = await shopifyGraphQLClient.post('/graphql.json', {
        query: mutation,
        variables: {
          input: {
            id: product.variantGid,
            price: correctPrice.toString()
          }
        }
      })
      
      const data = response.data.data.productVariantUpdate
      if (data.userErrors && data.userErrors.length > 0) {
        console.error(`   ❌ Error updating ${product.sku}: ${data.userErrors[0].message}`)
        failed++
      } else {
        updated++
      }
      
    } catch (err) {
      console.error(`   ❌ Exception updating ${product.sku}: ${err.message}`)
      failed++
    }
    
    // Rate limiting - slower for large volumes
    if (i % 2 === 0) {
      await sleep(750) // Slightly slower rate limiting for safety
    }
    
    // Progress updates more frequently for large volumes
    if (updated % 250 === 0 && updated > 0) {
      console.log(`   🔄 Progress update: ${updated} prices updated so far...`)
    }
  }
  
  console.log(`\n💰 Price update complete:`)
  console.log(`   ✅ Successfully updated: ${updated}`)
  console.log(`   ⚠️  Skipped (already correct): ${skipped}`)
  console.log(`   ❌ Failed: ${failed}`)
  
  return { updated, skipped, failed }
}

// --- DEACTIVATE REMOVED PRODUCTS ---
async function deactivateRemovedProducts(productsToDeactivate) {
  console.log(`\n🗑️ Deactivating ${productsToDeactivate.length} removed products...`)
  
  let deactivated = 0
  let failed = 0
  
  for (let i = 0; i < productsToDeactivate.length; i++) {
    const product = productsToDeactivate[i]
    
    console.log(`   🗑️ Deactivating ${product.sku} - ${product.productTitle}`)
    
    const mutation = `
      mutation DeactivateProduct($productId: ID!) {
        productUpdate(input: {
          id: $productId,
          status: DRAFT
        }) {
          product {
            id
            status
            title
          }
          userErrors {
            field
            message
          }
        }
      }
    `
    
    try {
      const response = await shopifyGraphQLClient.post('/graphql.json', {
        query: mutation,
        variables: {
          productId: product.productGid
        }
      })
      
      const data = response.data.data.productUpdate
      if (data.userErrors && data.userErrors.length > 0) {
        console.error(`   ❌ Error deactivating ${product.sku}: ${data.userErrors[0].message}`)
        failed++
      } else {
        deactivated++
        console.log(`   ✅ Deactivated: ${product.sku}`)
      }
      
    } catch (err) {
      console.error(`   ❌ Exception deactivating ${product.sku}: ${err.message}`)
      failed++
    }
    
    await sleep(SLEEP_MS)
  }
  
  console.log(`\n🗑️ Deactivation complete:`)
  console.log(`   ✅ Successfully deactivated: ${deactivated}`)
  console.log(`   ❌ Failed: ${failed}`)
  
  return { deactivated, failed }
}

// --- PROCESS DAILY UPDATES ---
async function processDailyUpdates(analysis, priceMap) {
  console.log(`\n🔄 PROCESSING DAILY UPDATES`)
  console.log('='.repeat(50))
  
  let totalProcessed = 0
  let totalUpdated = 0
  let totalDeactivated = 0
  
  // Process created products (new products)
  if (analysis.created.length > 0) {
    console.log(`\n🆕 PROCESSING ${analysis.created.length} CREATED PRODUCTS`)
    console.log('   These are new products added to Amrod catalog')
    console.log('   Manual review recommended for new product import')
    
    // Show sample new products
    analysis.created.slice(0, 5).forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.simpleCode || product.fullCode} - ${product.productName}`)
    })
    if (analysis.created.length > 5) {
      console.log(`   ... and ${analysis.created.length - 5} more new products`)
    }
  }
  
  // Process updated products (price/info changes)
  if (analysis.updated.length > 0) {
    console.log(`\n🔄 PROCESSING ${analysis.updated.length} UPDATED PRODUCTS`)
    
    // Get SKUs for updated products
    const updatedSkus = analysis.updated.map(product => 
      (product.simpleCode || product.fullCode || product.code || '').toLowerCase()
    ).filter(Boolean)
    
    // Find existing Shopify products
    const existingProducts = await findShopifyProductsBySku(updatedSkus)
    
    // Filter to products that exist in Shopify
    const productsToUpdate = []
    for (const [sku, shopifyProduct] of existingProducts) {
      productsToUpdate.push(shopifyProduct)
    }
    
    console.log(`   Found ${productsToUpdate.length} existing products to update`)
    
    if (productsToUpdate.length > 0) {
      const result = await updateProductPrices(productsToUpdate, priceMap)
      totalUpdated += result.updated
      totalProcessed += productsToUpdate.length
    }
  }
  
  // Process removed products (deactivate)
  if (analysis.removed.length > 0) {
    console.log(`\n🗑️ PROCESSING ${analysis.removed.length} REMOVED PRODUCTS`)
    
    // Get SKUs for removed products
    const removedSkus = analysis.removed.map(product => 
      (product.simpleCode || product.fullCode || product.code || '').toLowerCase()
    ).filter(Boolean)
    
    // Find existing Shopify products to deactivate
    const existingProducts = await findShopifyProductsBySku(removedSkus)
    
    const productsToDeactivate = Array.from(existingProducts.values())
    
    console.log(`   Found ${productsToDeactivate.length} existing products to deactivate`)
    
    if (productsToDeactivate.length > 0) {
      const result = await deactivateRemovedProducts(productsToDeactivate)
      totalDeactivated += result.deactivated
      totalProcessed += productsToDeactivate.length
    }
  }
  
  return {
    totalProcessed,
    totalUpdated,
    totalDeactivated,
    newProducts: analysis.created.length
  }
}

// --- MAIN EXECUTION ---
async function main() {
  console.log(`🔄 AMROD DAILY SYNC`)
  console.log(`Synchronizing your catalog with Amrod's daily updates`)
  console.log(`This processes only products changed since yesterday`)
  console.log('='.repeat(80))
  
  try {
    // 1. Get Amrod token
    const token = await getAmrodToken()
    
    // 2. Fetch updated products and current prices
    console.log('\n📦 STEP 1: Fetching daily updates from Amrod...')
    const [updatedProducts, currentPrices] = await Promise.all([
      fetchUpdatedProducts(token),
      fetchCurrentPrices(token)
    ])
    
    if (updatedProducts.length === 0) {
      console.log('\n🎉 NO UPDATES FOUND!')
      console.log('✅ Your catalog is already up to date!')
      console.log('💡 This means no products were changed in Amrod since yesterday')
      return
    }
    
    // 3. Analyze the updates
    console.log('\n📦 STEP 2: Analyzing updates...')
    const analysis = analyzeUpdatedProducts(updatedProducts)
    
    // 4. Build price lookup map
    const priceMap = new Map()
    for (const price of currentPrices) {
      const keys = [
        price.code, 
        price.productCode, 
        price.sku,
        price.simpleCode,
        price.fullCode,
        price.simplecode
      ].filter(Boolean)
      
      for (const key of keys) {
        if (price.price || price.cost || price.amount) {
          const priceValue = price.price || price.cost || price.amount
          priceMap.set(key.toUpperCase(), parseFloat(priceValue))
        }
      }
    }
    
    console.log(`📊 Built price lookup with ${priceMap.size} entries`)
    
    // 5. Process the updates
    console.log('\n📦 STEP 3: Processing updates...')
    const results = await processDailyUpdates(analysis, priceMap)
    
    // 6. Final summary
    console.log(`\n🎉 DAILY SYNC COMPLETE!`)
    console.log('='.repeat(50))
    console.log(`   📊 Total products processed: ${results.totalProcessed}`)
    console.log(`   🔄 Price updates applied: ${results.totalUpdated}`)
    console.log(`   🗑️ Products deactivated: ${results.totalDeactivated}`)
    console.log(`   🆕 New products found: ${results.newProducts}`)
    
    if (results.newProducts > 0) {
      console.log(`\n💡 MANUAL ACTION REQUIRED:`)
      console.log(`   🆕 ${results.newProducts} new products were added to Amrod`)
      console.log(`   📝 Consider running a full product import for these new items`)
    }
    
    console.log(`\n✅ Your Shopify catalog is now synchronized with Amrod!`)
    console.log(`🕐 Run this script daily to stay up to date`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run the main function
main()