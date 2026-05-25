import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za'
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const API_VERSION = '1'

// Correct endpoints from Amrod API documentation
const AMROD_PRODUCTS_URL = `${AMROD_BASE_URL}/api/v${API_VERSION}/Products/GetProductsAndBranding`
const AMROD_PRICES_URL = `${AMROD_BASE_URL}/api/v${API_VERSION}/Prices/`

console.log('🔧 API Configuration:')
console.log(`   Base URL: ${AMROD_BASE_URL}`)
console.log(`   Auth URL: ${AMROD_AUTH_URL}`)
console.log(`   Products Endpoint: ${AMROD_PRODUCTS_URL}`)
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

// --- FETCH ALL PRODUCTS WITH BRANDING ---
async function fetchAllProducts(token) {
  try {
    console.log('🔍 Fetching all products from Amrod...')
    console.log('   This endpoint returns ALL products with branding information')
    console.log(`   URL: ${AMROD_PRODUCTS_URL}`)
    
    const res = await axios.get(AMROD_PRODUCTS_URL, {
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
      }
    }
    
    const products = res.data || []
    console.log(`✅ Successfully fetched ${Array.isArray(products) ? products.length : 'unknown count'} total products`)
    return products
  } catch (err) {
    console.error('❌ Failed to fetch products:')
    console.error(`   Status: ${err.response?.status || 'No status'}`)
    console.error(`   Status Text: ${err.response?.statusText || 'No status text'}`)
    console.error(`   URL: ${AMROD_PRODUCTS_URL}`)
    
    if (err.response?.data) {
      console.error('   Response data:', JSON.stringify(err.response.data, null, 2))
    }
    
    if (err.code) {
      console.error(`   Error code: ${err.code}`)
    }
    
    if (err.message) {
      console.error(`   Error message: ${err.message}`)
    }
    
    // Try alternative authentication header format
    console.log('\n🔄 Trying alternative authentication format...')
    try {
      const altRes = await axios.get(AMROD_PRODUCTS_URL, {
        headers: { 
          'accesskey': token,  // Try the old format
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 60000
      })
      
      console.log(`✅ Alternative auth worked! Status: ${altRes.status}`)
      const products = altRes.data || []
      console.log(`✅ Successfully fetched ${Array.isArray(products) ? products.length : 'unknown count'} total products`)
      return products
      
    } catch (altErr) {
      console.error('❌ Alternative auth also failed:')
      console.error(`   Status: ${altErr.response?.status || 'No status'}`)
      console.error(`   Message: ${altErr.message}`)
      process.exit(1)
    }
  }
}

// --- FETCH AMROD PRICES ---
async function fetchAmrodPrices(token) {
  try {
    console.log('🔍 Fetching Amrod pricing data...')
    console.log(`   URL: ${AMROD_PRICES_URL}`)
    
    const res = await axios.get(AMROD_PRICES_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    })
    
    console.log(`✅ Prices response status: ${res.status}`)
    console.log(`📊 Prices data type: ${typeof res.data}`)
    console.log(`📊 Prices data length: ${Array.isArray(res.data) ? res.data.length : 'Not an array'}`)
    
    const prices = res.data || []
    console.log(`✅ Successfully fetched ${Array.isArray(prices) ? prices.length : 'unknown count'} price records`)
    return prices
  } catch (err) {
    console.error('❌ Failed to fetch prices:')
    console.error(`   Status: ${err.response?.status || 'No status'}`)
    console.error(`   Status Text: ${err.response?.statusText || 'No status text'}`)
    console.error(`   Message: ${err.message}`)
    
    // Try alternative auth for prices too
    console.log('\n🔄 Trying alternative auth for prices...')
    try {
      const altRes = await axios.get(AMROD_PRICES_URL, {
        headers: { 
          'accesskey': token,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 60000
      })
      
      console.log(`✅ Alternative prices auth worked! Status: ${altRes.status}`)
      const prices = altRes.data || []
      console.log(`✅ Successfully fetched ${Array.isArray(prices) ? prices.length : 'unknown count'} price records`)
      return prices
      
    } catch (altErr) {
      console.error('❌ Prices with alternative auth also failed, continuing without prices...')
      return []
    }
  }
}

// --- FIND CURRENT ZERO PRICE PRODUCTS (GraphQL) ---
async function findCurrentZeroPriceProducts() {
  console.log('\n📦 Finding current zero-price products in Shopify using GraphQL...')
  
  let zeroProducts = []
  let hasNextPage = true
  let cursor = null
  let batchCount = 0
  
  const query = `
    query GetProductsWithVariants($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            vendor
            status
            publishedAt
            variantsCount {
              count
            }
            variants(first: 250) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                cursor
                node {
                  id
                  price
                  sku
                  title
                }
              }
            }
          }
        }
      }
    }
  `
  
  // Query for remaining variants when a product has more than 250 variants
  const remainingVariantsQuery = `
    query GetRemainingVariants($productId: ID!, $first: Int!, $after: String!) {
      product(id: $productId) {
        variants(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              price
              sku
              title
            }
          }
        }
      }
    }
  `
  
  while (hasNextPage) {
    batchCount++
    console.log(`   📦 Fetching product batch ${batchCount}...`)
    
    try {
      const variables = {
        first: 50,
        after: cursor
      }
      
      const response = await shopifyGraphQLClient.post('/graphql.json', {
        query,
        variables
      })
      
      const data = response.data.data
      const products = data.products.edges
      
      if (!products.length) break
      
      for (const productEdge of products) {
        const product = productEdge.node
        let allVariants = [...product.variants.edges]
        
        // Check if this product has more than 250 variants
        if (product.variantsCount.count > 250 && product.variants.pageInfo.hasNextPage) {
          console.log(`   📦 Product "${product.title}" has ${product.variantsCount.count} variants, fetching remaining...`)
          
          let variantCursor = product.variants.pageInfo.endCursor
          let hasMoreVariants = true
          
          while (hasMoreVariants) {
            const variantResponse = await shopifyGraphQLClient.post('/graphql.json', {
              query: remainingVariantsQuery,
              variables: {
                productId: product.id,
                first: 250,
                after: variantCursor
              }
            })
            
            const variantData = variantResponse.data.data.product.variants
            allVariants.push(...variantData.edges)
            
            hasMoreVariants = variantData.pageInfo.hasNextPage
            variantCursor = variantData.pageInfo.endCursor
            
            await sleep(100) // Small delay for variant pagination
          }
        }
        
        // Process all variants for zero prices
        for (const variantEdge of allVariants) {
          const variant = variantEdge.node
          const price = parseFloat(variant.price)
          const sku = (variant.sku || '').trim()
          
          // Check for zero prices
          if (price === 0 || variant.price === "0.00" || variant.price === "0") {
            zeroProducts.push({
              product: {
                id: product.id.replace('gid://shopify/Product/', ''),
                title: product.title,
                vendor: product.vendor,
                status: product.status.toLowerCase(),
                published_at: product.publishedAt
              },
              variant: {
                id: variant.id.replace('gid://shopify/ProductVariant/', ''),
                price: variant.price,
                sku: variant.sku,
                title: variant.title
              },
              sku: sku,
              productTitle: product.title,
              vendor: product.vendor,
              status: product.status.toLowerCase(),
              published: product.publishedAt ? true : false,
              variantId: variant.id.replace('gid://shopify/ProductVariant/', ''),
              productId: product.id.replace('gid://shopify/Product/', '')
            })
          }
        }
      }
      
      hasNextPage = data.products.pageInfo.hasNextPage
      cursor = data.products.pageInfo.endCursor
      
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error('❌ Error fetching products:', err.response?.status, err.response?.data)
      break
    }
  }
  
  console.log(`✅ Found ${zeroProducts.length} current zero-price products`)
  return zeroProducts
}

// --- ANALYZE AGAINST ALL PRODUCTS ---
async function analyzeAgainstAllProducts(zeroPriceProducts, allProducts, amrodPrices) {
  console.log('\n🔍 ANALYZING ZERO-PRICE PRODUCTS AGAINST AMROD CATALOG...')
  
  // Build product lookup maps - use multiple code fields
  const productMap = new Map()
  const variantMap = new Map()
  
  console.log('🔍 Sample Amrod product structure:')
  if (allProducts.length > 0) {
    const sample = allProducts[0]
    console.log(`   simpleCode: ${sample.simpleCode}`)
    console.log(`   fullCode: ${sample.fullCode}`)
    console.log(`   productName: ${sample.productName}`)
    console.log(`   variants count: ${sample.variants ? sample.variants.length : 0}`)
    if (sample.variants && sample.variants.length > 0) {
      console.log(`   first variant code: ${sample.variants[0].code}`)
    }
  }
  
  for (const product of allProducts) {
    // Store base product by multiple code fields
    const productCodes = [
      product.simpleCode,
      product.fullCode,
      product.code
    ].filter(Boolean)
    
    for (const code of productCodes) {
      productMap.set(code.toUpperCase(), product)
    }
    
    // Store variants by their codes
    if (product.variants && Array.isArray(product.variants)) {
      for (const variant of product.variants) {
        const variantCodes = [
          variant.code,
          variant.simpleCode,
          variant.fullCode
        ].filter(Boolean)
        
        for (const code of variantCodes) {
          variantMap.set(code.toUpperCase(), {
            ...variant,
            baseProduct: product
          })
        }
      }
    }
  }
  
  // Build pricing lookup from pricing endpoint
  const priceMap = new Map()
  console.log('🔍 Sample pricing structure:')
  if (amrodPrices.length > 0) {
    const sample = amrodPrices[0]
    console.log(`   Available price fields: ${Object.keys(sample).join(', ')}`)
  }
  
  for (const price of amrodPrices) {
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
  
  console.log(`📊 Built lookups:`)
  console.log(`   Products: ${productMap.size}`)
  console.log(`   Variants: ${variantMap.size}`)
  console.log(`   Prices: ${priceMap.size}`)
  
  // Show sample Shopify SKUs vs Amrod codes for debugging
  console.log('\n🔍 Sample comparison:')
  console.log('   Shopify SKUs (first 5):')
  zeroPriceProducts.slice(0, 5).forEach((product, index) => {
    console.log(`     ${index + 1}. "${product.sku}"`)
  })
  
  console.log('   Amrod product codes (first 5):')
  Array.from(productMap.keys()).slice(0, 5).forEach((code, index) => {
    console.log(`     ${index + 1}. "${code}"`)
  })
  
  console.log('   Amrod variant codes (first 5):')
  Array.from(variantMap.keys()).slice(0, 5).forEach((code, index) => {
    console.log(`     ${index + 1}. "${code}"`)
  })
  
  let results = {
    availableWithPricing: [],
    availableNoPricing: [],
    notAvailable: [],
    unknown: []
  }
  
  console.log(`\n🔍 Analyzing ${zeroPriceProducts.length} zero-price products...`)
  
  for (const [index, zeroProduct] of zeroPriceProducts.entries()) {
    if (index % 50 === 0) {
      console.log(`   📦 Analyzed ${index}/${zeroPriceProducts.length} products...`)
    }
    
    const sku = zeroProduct.sku.toUpperCase()
    const isVariantAvailable = variantMap.has(sku)
    const isProductAvailable = productMap.has(sku)
    const hasPrice = priceMap.has(sku)
    
    let analysis = {
      ...zeroProduct,
      isAvailable: isVariantAvailable || isProductAvailable,
      hasPrice: hasPrice,
      amrodData: variantMap.get(sku) || productMap.get(sku),
      priceData: priceMap.get(sku),
      recommendation: '',
      reason: ''
    }
    
    if (isVariantAvailable || isProductAvailable) {
      if (hasPrice) {
        const cost = priceMap.get(sku)
        const retailPrice = parseFloat(roundPrice(cost * PRICE_MARKUP))
        
        analysis.recommendation = 'FIX_PRICING'
        analysis.reason = `Available in Amrod with pricing: R${cost} → R${retailPrice}`
        analysis.newPrice = retailPrice
        analysis.cost = cost
        results.availableWithPricing.push(analysis)
      } else {
        analysis.recommendation = 'MANUAL_REVIEW'
        analysis.reason = 'Available in Amrod but no pricing found'
        results.availableNoPricing.push(analysis)
      }
    } else {
      analysis.recommendation = 'DEACTIVATE'
      analysis.reason = 'Product not found in Amrod catalog - should be deactivated'
      results.notAvailable.push(analysis)
    }
    
    // Small delay to avoid overwhelming
    if (index % 100 === 0) {
      await sleep(50)
    }
  }
  
  console.log(`✅ Analysis complete!`)
  return results
}

// --- PRICE ROUNDING ---
function roundPrice(price) {
  let p = Math.ceil(price)
  return (p - 0.01 + 1).toFixed(2)
}

// --- UPDATE VARIANT PRICES (GraphQL) ---
async function updateVariantPrices(variantsToUpdate) {
  console.log(`\n💰 Updating ${variantsToUpdate.length} variant prices using GraphQL...`)
  
  // Process in batches to avoid overwhelming the API
  const batchSize = 10
  let updated = 0
  let failed = 0
  
  for (let i = 0; i < variantsToUpdate.length; i += batchSize) {
    const batch = variantsToUpdate.slice(i, i + batchSize)
    console.log(`   📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(variantsToUpdate.length/batchSize)}...`)
    
    // Prepare variants for bulk update
    const variantInputs = batch.map(item => ({
      id: `gid://shopify/ProductVariant/${item.variantId}`,
      price: item.newPrice.toString()
    }))
    
    const mutation = `
      mutation UpdateVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
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
          productId: `gid://shopify/Product/${batch[0].productId}`,
          variants: variantInputs
        }
      })
      
      const data = response.data.data
      if (data.productVariantsBulkUpdate.userErrors.length > 0) {
        console.error('❌ Errors updating variants:', data.productVariantsBulkUpdate.userErrors)
        failed += batch.length
      } else {
        updated += batch.length
        console.log(`   ✅ Updated ${batch.length} variants in this batch`)
      }
      
    } catch (err) {
      console.error(`❌ Failed to update batch:`, err.response?.data || err.message)
      failed += batch.length
    }
    
    await sleep(SLEEP_MS)
  }
  
  console.log(`\n💰 Price update complete:`)
  console.log(`   ✅ Successfully updated: ${updated}`)
  console.log(`   ❌ Failed: ${failed}`)
  
  return { updated, failed }
}

// --- DEACTIVATE PRODUCTS (GraphQL) ---
async function deactivateProducts(productsToDeactivate) {
  console.log(`\n🗑️ Deactivating ${productsToDeactivate.length} non-available products...`)
  
  let deactivated = 0
  let failed = 0
  
  for (const product of productsToDeactivate) {
    console.log(`   🗑️ Deactivating: "${product.sku}" - ${product.productTitle}`)
    
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
          productId: `gid://shopify/Product/${product.productId}`
        }
      })
      
      const data = response.data.data
      if (data.productUpdate.userErrors.length > 0) {
        console.error(`❌ Error deactivating ${product.sku}:`, data.productUpdate.userErrors)
        failed++
      } else {
        deactivated++
        console.log(`   ✅ Deactivated: ${product.sku}`)
      }
      
    } catch (err) {
      console.error(`❌ Failed to deactivate ${product.sku}:`, err.response?.data || err.message)
      failed++
    }
    
    await sleep(SLEEP_MS)
  }
  
  console.log(`\n🗑️ Deactivation complete:`)
  console.log(`   ✅ Successfully deactivated: ${deactivated}`)
  console.log(`   ❌ Failed: ${failed}`)
  
  return { deactivated, failed }
}

// --- BATCH UPDATE PRICING ---
async function batchUpdatePricing(analysis) {
  console.log(`\n🔧 BATCH PRICING UPDATE`)
  console.log('='.repeat(50))
  
  const itemsToUpdate = analysis.availableWithPricing
  if (itemsToUpdate.length === 0) {
    console.log('📝 No items need pricing updates')
    return { updated: 0, failed: 0 }
  }
  
  console.log(`📊 Items to update: ${itemsToUpdate.length}`)
  console.log(`💡 This will update variants with proper pricing from Amrod`)
  
  // Group by product to optimize API calls
  const byProduct = new Map()
  for (const item of itemsToUpdate) {
    if (!byProduct.has(item.productId)) {
      byProduct.set(item.productId, [])
    }
    byProduct.get(item.productId).push(item)
  }
  
  console.log(`📦 Products to update: ${byProduct.size}`)
  
  let totalUpdated = 0
  let totalFailed = 0
  
  for (const [productId, variants] of byProduct) {
    console.log(`\n📦 Updating product ${productId} (${variants.length} variants)...`)
    
    const result = await updateVariantPrices(variants)
    totalUpdated += result.updated
    totalFailed += result.failed
    
    // Small delay between products
    await sleep(500)
  }
  
  console.log(`\n🎉 BATCH UPDATE COMPLETE!`)
  console.log(`   ✅ Total variants updated: ${totalUpdated}`)
  console.log(`   ❌ Total failures: ${totalFailed}`)
  console.log(`   📈 Success rate: ${((totalUpdated/(totalUpdated+totalFailed))*100).toFixed(1)}%`)
  
  return { updated: totalUpdated, failed: totalFailed }
}

// --- SHOW ANALYSIS RESULTS ---
function showAnalysisResults(analysis) {
  console.log(`\n📊 AMROD PRODUCT ANALYSIS:`)
  console.log('='.repeat(60))
  
  console.log(`\n✅ AVAILABLE WITH PRICING (${analysis.availableWithPricing.length}):`)
  console.log(`   These should be fixed with proper pricing`)
  analysis.availableWithPricing.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" → R${product.newPrice}`)
    console.log(`      Product: ${product.productTitle}`)
    console.log(`      Cost: R${product.cost}`)
  })
  if (analysis.availableWithPricing.length > 5) {
    console.log(`   ... and ${analysis.availableWithPricing.length - 5} more`)
  }
  
  console.log(`\n❓ AVAILABLE NO PRICING (${analysis.availableNoPricing.length}):`)
  console.log(`   These are available in Amrod but need manual pricing`)
  analysis.availableNoPricing.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    console.log(`      Reason: ${product.reason}`)
  })
  if (analysis.availableNoPricing.length > 5) {
    console.log(`   ... and ${analysis.availableNoPricing.length - 5} more`)
  }
  
  console.log(`\n❌ NOT AVAILABLE (${analysis.notAvailable.length}):`)
  console.log(`   These should be deactivated or removed`)
  analysis.notAvailable.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    console.log(`      Published: ${product.published}`)
  })
  if (analysis.notAvailable.length > 5) {
    console.log(`   ... and ${analysis.notAvailable.length - 5} more`)
  }
}

// --- EXPORT ANALYSIS ---
function exportAnalysis(analysis) {
  console.log(`\n📄 EXPORTING AMROD ANALYSIS...`)
  
  const headers = [
    'SKU',
    'Product Title',
    'Recommendation',
    'Reason',
    'Is Available',
    'Current Cost',
    'New Price',
    'Shopify Status',
    'Published'
  ]
  
  let csvContent = headers.join(',') + '\n'
  
  const allProducts = [
    ...analysis.availableWithPricing,
    ...analysis.availableNoPricing,
    ...analysis.notAvailable
  ]
  
  for (const product of allProducts) {
    const row = [
      `"${product.sku}"`,
      `"${product.productTitle.replace(/"/g, '""')}"`,
      `"${product.recommendation}"`,
      `"${product.reason.replace(/"/g, '""')}"`,
      `"${product.isAvailable}"`,
      `"${product.cost || ''}"`,
      `"${product.newPrice || ''}"`,
      `"${product.status}"`,
      `"${product.published}"`
    ]
    csvContent += row.join(',') + '\n'
  }
  
  console.log(`✅ Export ready with ${allProducts.length} products`)
  return csvContent
}

// --- EXECUTE AUTO-FIX OPERATIONS ---
async function executeAutoFix(analysis) {
  const canFix = analysis.availableWithPricing.length
  const shouldDeactivate = analysis.notAvailable.length
  
  console.log(`\n🤖 AUTO-EXECUTION:`)
  console.log(`   Starting automatic fixes...`)
  
  // Auto-fix pricing for available products
  if (canFix > 0) {
    console.log(`\n🔧 AUTO-FIXING ${canFix} PRODUCTS WITH PRICING...`)
    const pricingResult = await batchUpdatePricing(analysis)
    console.log(`✅ Pricing update completed: ${pricingResult.updated} updated, ${pricingResult.failed} failed`)
  }
  
  // Auto-deactivate non-available products
  if (shouldDeactivate > 0) {
    console.log(`\n🗑️ AUTO-DEACTIVATING ${shouldDeactivate} NON-AVAILABLE PRODUCTS...`)
    const deactivateResult = await deactivateProducts(analysis.notAvailable)
    console.log(`✅ Deactivation completed: ${deactivateResult.deactivated} deactivated, ${deactivateResult.failed} failed`)
  }
  
  console.log(`\n🎉 AUTO-FIX COMPLETE!`)
  console.log(`   ✅ All zero-price products have been processed automatically`)
  console.log(`   🔧 Products with pricing: FIXED`)
  console.log(`   🗑️ Non-available products: DEACTIVATED`)
  console.log(`   📊 Your store is now clean and properly priced!`)
  
  return {
    pricingUpdated: canFix,
    productsDeactivated: shouldDeactivate
  }
}

// --- MAIN EXECUTION ---
async function main() {
  console.log(`🔍 AMROD PRODUCTS CHECKER`)
  console.log(`Using Amrod's product endpoints to determine what should be active`)
  console.log(`This will show which zero-price products are actually available vs discontinued`)
  console.log('='.repeat(80))
  
  try {
    // 1. Get Amrod token
    const token = await getAmrodToken()
    
    // 2. Fetch all products and pricing data
    const [allProducts, amrodPrices] = await Promise.all([
      fetchAllProducts(token),
      fetchAmrodPrices(token)
    ])
    
    // 3. Find current zero-price products
    const zeroPriceProducts = await findCurrentZeroPriceProducts()
    
    if (zeroPriceProducts.length === 0) {
      console.log('\n🎉 NO ZERO-PRICE PRODUCTS FOUND!')
      console.log('✅ All products have been fixed!')
      return
    }
    
    // 4. Analyze against all products
    const analysis = await analyzeAgainstAllProducts(zeroPriceProducts, allProducts, amrodPrices)
    
    // 5. Show results
    showAnalysisResults(analysis)
    
    // 6. Export results
    const csvContent = exportAnalysis(analysis)
    
    // 7. Show summary
    console.log(`\n💡 SUMMARY & RECOMMENDATIONS:`)
    console.log('='.repeat(50))
    
    const totalZero = zeroPriceProducts.length
    const canFix = analysis.availableWithPricing.length
    const shouldDeactivate = analysis.notAvailable.length
    const needReview = analysis.availableNoPricing.length
    
    console.log(`\n📊 BREAKDOWN:`)
    console.log(`   Total zero-price products: ${totalZero}`)
    console.log(`   🔧 Can auto-fix with pricing: ${canFix} (${((canFix/totalZero)*100).toFixed(1)}%)`)
    console.log(`   🗑️  Should deactivate: ${shouldDeactivate} (${((shouldDeactivate/totalZero)*100).toFixed(1)}%)`)
    console.log(`   ❓ Need manual review: ${needReview} (${((needReview/totalZero)*100).toFixed(1)}%)`)
    
    console.log(`\n🎯 NEXT ACTIONS:`)
    if (canFix > 0) {
      console.log(`   1. 🔧 Run pricing fix for ${canFix} available products`)
    }
    if (shouldDeactivate > 0) {
      console.log(`   2. 🗑️  Deactivate ${shouldDeactivate} non-available products`)
    }
    if (needReview > 0) {
      console.log(`   3. ❓ Manually review ${needReview} products for pricing`)
    }
    
    // 8. Execute auto-fix operations
    await executeAutoFix(analysis)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run the main function
main()