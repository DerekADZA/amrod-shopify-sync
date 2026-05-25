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
const PRICE_TOLERANCE = 0.05 // 5 cent tolerance for price differences

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
    
    const res = await axios.get(AMROD_PRODUCTS_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    })
    
    const products = res.data || []
    console.log(`✅ Successfully fetched ${Array.isArray(products) ? products.length : 'unknown count'} total products`)
    return products
  } catch (err) {
    console.error('❌ Failed to fetch products:', err.response?.status, err.response?.statusText)
    process.exit(1)
  }
}

// --- FETCH AMROD PRICES ---
async function fetchAmrodPrices(token) {
  try {
    console.log('🔍 Fetching Amrod pricing data...')
    
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

// --- FETCH ALL SHOPIFY PRODUCTS (GraphQL) ---
async function fetchAllShopifyProducts() {
  console.log('\n📦 Fetching ALL products from Shopify using GraphQL...')
  
  let allProducts = []
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
                  compareAtPrice
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
              compareAtPrice
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
        
        // Process all variants
        for (const variantEdge of allVariants) {
          const variant = variantEdge.node
          const price = parseFloat(variant.price)
          const sku = (variant.sku || '').trim()
          
          // Include all products with SKUs
          if (sku) {
            allProducts.push({
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
                title: variant.title,
                compareAtPrice: variant.compareAtPrice
              },
              sku: sku,
              productTitle: product.title,
              vendor: product.vendor,
              status: product.status.toLowerCase(),
              published: product.publishedAt ? true : false,
              variantId: variant.id.replace('gid://shopify/ProductVariant/', ''),
              productId: product.id.replace('gid://shopify/Product/', ''),
              currentPrice: price
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
  
  console.log(`✅ Found ${allProducts.length} total products with SKUs in Shopify`)
  return allProducts
}

// --- ANALYZE ALL PRODUCT PRICES ---
async function analyzeAllProductPrices(shopifyProducts, allProducts, amrodPrices) {
  console.log('\n🔍 ANALYZING ALL PRODUCT PRICES AGAINST AMROD...')
  console.log('⚠️  IMPORTANT: Only analyzing Amrod products (filtering by vendor)')
  
  // Filter to only Amrod products
  const amrodProducts = shopifyProducts.filter(product => {
    // Check various ways Amrod might be identified
    const vendor = (product.vendor || '').toLowerCase()
    const title = (product.productTitle || '').toLowerCase()
    
    return vendor.includes('amrod') || 
           vendor.includes('idea') ||
           vendor === '' || // Sometimes Amrod products have no vendor
           title.includes('amrod')
  })
  
  console.log(`📊 Product filtering:`)
  console.log(`   Total Shopify products: ${shopifyProducts.length}`)
  console.log(`   Filtered to Amrod products: ${amrodProducts.length}`)
  console.log(`   Non-Amrod products (safe): ${shopifyProducts.length - amrodProducts.length}`)
  
  // Show sample vendors to help identify correct filtering
  const vendors = [...new Set(shopifyProducts.map(p => p.vendor).filter(Boolean))]
  console.log(`   All vendors in store: ${vendors.join(', ')}`)
  
  // Build product lookup maps - use multiple code fields
  const productMap = new Map()
  const variantMap = new Map()
  
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
  
  let results = {
    correctPrices: [],
    incorrectPrices: [],
    noPricing: [],
    notAvailable: [],
    zeroPrice: [],
    skippedNonAmrod: shopifyProducts.length - amrodProducts.length
  }
  
  console.log(`\n🔍 Analyzing ${amrodProducts.length} Amrod products only...`)
  console.log(`⚠️  Skipping ${results.skippedNonAmrod} non-Amrod products to keep them safe`)
  
  for (const [index, shopifyProduct] of amrodProducts.entries()) {
    if (index % 100 === 0) {
      console.log(`   📦 Analyzed ${index}/${amrodProducts.length} Amrod products...`)
    }
    
    const sku = shopifyProduct.sku.toUpperCase()
    const currentPrice = shopifyProduct.currentPrice
    const isVariantAvailable = variantMap.has(sku)
    const isProductAvailable = productMap.has(sku)
    const hasPrice = priceMap.has(sku)
    
    let analysis = {
      ...shopifyProduct,
      isAvailable: isVariantAvailable || isProductAvailable,
      hasPrice: hasPrice,
      amrodData: variantMap.get(sku) || productMap.get(sku),
      currentAmrodPrice: priceMap.get(sku),
      recommendation: '',
      reason: '',
      priceDifference: 0
    }
    
    // Check if price is zero
    if (currentPrice === 0) {
      analysis.recommendation = 'FIX_ZERO_PRICE'
      analysis.reason = 'Amrod product has zero price'
      if (hasPrice) {
        const cost = priceMap.get(sku)
        const correctPrice = parseFloat(roundPrice(cost * PRICE_MARKUP))
        analysis.correctPrice = correctPrice
        analysis.cost = cost
        analysis.priceDifference = correctPrice - currentPrice
      }
      results.zeroPrice.push(analysis)
    }
    // Check if product is available in Amrod
    else if (!isVariantAvailable && !isProductAvailable) {
      analysis.recommendation = 'DEACTIVATE'
      analysis.reason = 'Amrod product not found in current Amrod catalog'
      results.notAvailable.push(analysis)
    }
    // Check if we have pricing for available product
    else if (!hasPrice) {
      analysis.recommendation = 'MANUAL_REVIEW'
      analysis.reason = 'Available in Amrod but no pricing found'
      results.noPricing.push(analysis)
    }
    // Compare current price with correct Amrod price
    else {
      const cost = priceMap.get(sku)
      const correctPrice = parseFloat(roundPrice(cost * PRICE_MARKUP))
      const priceDifference = Math.abs(correctPrice - currentPrice)
      
      analysis.correctPrice = correctPrice
      analysis.cost = cost
      analysis.priceDifference = priceDifference
      
      if (priceDifference <= PRICE_TOLERANCE) {
        analysis.recommendation = 'CORRECT'
        analysis.reason = `Price is correct (within ${PRICE_TOLERANCE} tolerance)`
        results.correctPrices.push(analysis)
      } else {
        analysis.recommendation = 'UPDATE_PRICE'
        analysis.reason = `Price incorrect: R${currentPrice} should be R${correctPrice} (diff: R${priceDifference.toFixed(2)})`
        results.incorrectPrices.push(analysis)
      }
    }
    
    // Small delay to avoid overwhelming
    if (index % 200 === 0) {
      await sleep(50)
    }
  }
  
  console.log(`✅ Analysis complete!`)
  console.log(`🛡️  Protected ${results.skippedNonAmrod} non-Amrod products from changes`)
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
  
  let updated = 0
  let failed = 0
  
  for (let i = 0; i < variantsToUpdate.length; i++) {
    const variant = variantsToUpdate[i]
    
    if (i % 100 === 0) {
      console.log(`   📦 Processing variant ${i + 1}/${variantsToUpdate.length}... (${updated} updated, ${failed} failed)`)
    }
    
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
            id: `gid://shopify/ProductVariant/${variant.variantId}`,
            price: variant.correctPrice.toString()
          }
        }
      })
      
      // Check if response exists
      if (!response.data || !response.data.data) {
        console.error(`❌ Invalid response for ${variant.sku}`)
        failed++
        continue
      }
      
      const data = response.data.data.productVariantUpdate
      if (!data) {
        console.error(`❌ No productVariantUpdate in response for ${variant.sku}`)
        failed++
        continue
      }
      
      if (data.userErrors && data.userErrors.length > 0) {
        console.error(`❌ Error updating ${variant.sku}: ${data.userErrors[0].message}`)
        failed++
      } else {
        updated++
        if (updated % 500 === 0) {
          console.log(`   ✅ Successfully updated ${updated} variants so far...`)
        }
      }
      
    } catch (err) {
      console.error(`❌ Exception updating ${variant.sku}: ${err.message}`)
      failed++
    }
    
    // Rate limit: 2 requests per second
    if (i % 2 === 0) {
      await sleep(500)
    }
  }
  
  console.log(`\n💰 Price update complete:`)
  console.log(`   ✅ Successfully updated: ${updated}`)
  console.log(`   ❌ Failed: ${failed}`)
  console.log(`   📊 Success rate: ${((updated/(updated+failed))*100).toFixed(1)}%`)
  
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

// --- SHOW PRICE ANALYSIS RESULTS ---
function showPriceAnalysisResults(analysis) {
  console.log(`\n📊 COMPLETE PRICE ANALYSIS:`)
  console.log('='.repeat(60))
  
  console.log(`\n✅ CORRECT PRICES (${analysis.correctPrices.length}):`)
  console.log(`   These products have correct pricing`)
  
  console.log(`\n🔧 INCORRECT PRICES (${analysis.incorrectPrices.length}):`)
  console.log(`   These need price updates`)
  analysis.incorrectPrices.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    console.log(`      Current: R${product.currentPrice} → Correct: R${product.correctPrice}`)
    console.log(`      Difference: R${product.priceDifference.toFixed(2)}`)
  })
  if (analysis.incorrectPrices.length > 5) {
    console.log(`   ... and ${analysis.incorrectPrices.length - 5} more`)
  }
  
  console.log(`\n🚨 ZERO PRICES (${analysis.zeroPrice.length}):`)
  console.log(`   These have zero prices and need immediate fixing`)
  analysis.zeroPrice.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    if (product.correctPrice) {
      console.log(`      Should be: R${product.correctPrice}`)
    }
  })
  if (analysis.zeroPrice.length > 5) {
    console.log(`   ... and ${analysis.zeroPrice.length - 5} more`)
  }
  
  console.log(`\n❓ NO PRICING DATA (${analysis.noPricing.length}):`)
  console.log(`   These are in Amrod but have no pricing`)
  analysis.noPricing.slice(0, 3).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
  })
  if (analysis.noPricing.length > 3) {
    console.log(`   ... and ${analysis.noPricing.length - 3} more`)
  }
  
  console.log(`\n❌ NOT AVAILABLE (${analysis.notAvailable.length}):`)
  console.log(`   These should be deactivated`)
  analysis.notAvailable.slice(0, 3).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    console.log(`      Current Price: R${product.currentPrice}`)
  })
  if (analysis.notAvailable.length > 3) {
    console.log(`   ... and ${analysis.notAvailable.length - 3} more`)
  }
}

// --- EXECUTE COMPLETE PRICE FIX ---
async function executeCompletePriceFix(analysis) {
  console.log(`\n🤖 COMPLETE PRICE SYNC EXECUTION:`)
  console.log('='.repeat(50))
  
  const incorrectPrices = analysis.incorrectPrices.length
  const zeroPrices = analysis.zeroPrice.length
  const shouldDeactivate = analysis.notAvailable.length
  
  let totalUpdated = 0
  let totalDeactivated = 0
  
  // Fix incorrect prices
  if (incorrectPrices > 0) {
    console.log(`\n🔧 FIXING ${incorrectPrices} INCORRECT PRICES...`)
    const result = await updateVariantPrices(analysis.incorrectPrices)
    totalUpdated += result.updated
    console.log(`✅ Incorrect prices fixed: ${result.updated}`)
  }
  
  // Fix zero prices
  if (zeroPrices > 0) {
    const zeroPricesWithPricing = analysis.zeroPrice.filter(p => p.correctPrice)
    if (zeroPricesWithPricing.length > 0) {
      console.log(`\n🚨 FIXING ${zeroPricesWithPricing.length} ZERO PRICES...`)
      const result = await updateVariantPrices(zeroPricesWithPricing)
      totalUpdated += result.updated
      console.log(`✅ Zero prices fixed: ${result.updated}`)
    }
  }
  
  // Deactivate non-available products
  if (shouldDeactivate > 0) {
    console.log(`\n🗑️ DEACTIVATING ${shouldDeactivate} NON-AVAILABLE PRODUCTS...`)
    const result = await deactivateProducts(analysis.notAvailable)
    totalDeactivated += result.deactivated
    console.log(`✅ Products deactivated: ${result.deactivated}`)
  }
  
  console.log(`\n🎉 COMPLETE PRICE SYNC FINISHED!`)
  console.log(`   ✅ Total prices updated: ${totalUpdated}`)
  console.log(`   🗑️ Total products deactivated: ${totalDeactivated}`)
  console.log(`   📊 Your entire store is now synchronized with Amrod!`)
  
  return { totalUpdated, totalDeactivated }
}

// --- MAIN EXECUTION ---
async function main() {
  console.log(`🔍 COMPLETE AMROD PRICE AUDIT & SYNC`)
  console.log(`Checking ALL products in your store against Amrod pricing`)
  console.log(`This will ensure your entire catalog has correct, up-to-date prices`)
  console.log('='.repeat(80))
  
  try {
    // 1. Get Amrod token
    const token = await getAmrodToken()
    
    // 2. Fetch all Amrod products and pricing data
    console.log('\n📦 STEP 1: Fetching Amrod data...')
    const [allAmrodProducts, amrodPrices] = await Promise.all([
      fetchAllProducts(token),
      fetchAmrodPrices(token)
    ])
    
    // 3. Fetch all Shopify products
    console.log('\n📦 STEP 2: Fetching Shopify data...')
    const allShopifyProducts = await fetchAllShopifyProducts()
    
    if (allShopifyProducts.length === 0) {
      console.log('\n❌ No products found in Shopify!')
      return
    }
    
    // 4. Analyze all product prices
    console.log('\n📦 STEP 3: Analyzing prices...')
    const analysis = await analyzeAllProductPrices(allShopifyProducts, allAmrodProducts, amrodPrices)
    
    // 5. Show results
    showPriceAnalysisResults(analysis)
    
    // 6. Show summary
    console.log(`\n💡 COMPLETE PRICE AUDIT SUMMARY:`)
    console.log('='.repeat(50))
    
    const total = allShopifyProducts.length
    const correct = analysis.correctPrices.length
    const incorrect = analysis.incorrectPrices.length
    const zero = analysis.zeroPrice.length
    const noPricing = analysis.noPricing.length
    const notAvailable = analysis.notAvailable.length
    
    console.log(`\n📊 PRICE BREAKDOWN:`)
    console.log(`   Total products in store: ${total}`)
    console.log(`   🛡️  Non-Amrod products (protected): ${analysis.skippedNonAmrod}`)
    console.log(`   📦 Amrod products analyzed: ${total - analysis.skippedNonAmrod}`)
    console.log(`   ✅ Correct prices: ${correct} (${((correct/(total - analysis.skippedNonAmrod))*100).toFixed(1)}%)`)
    console.log(`   🔧 Incorrect prices: ${incorrect} (${((incorrect/(total - analysis.skippedNonAmrod))*100).toFixed(1)}%)`)
    console.log(`   🚨 Zero prices: ${zero} (${((zero/(total - analysis.skippedNonAmrod))*100).toFixed(1)}%)`)
    console.log(`   ❓ No pricing data: ${noPricing} (${((noPricing/(total - analysis.skippedNonAmrod))*100).toFixed(1)}%)`)
    console.log(`   ❌ Not available in Amrod: ${notAvailable} (${((notAvailable/(total - analysis.skippedNonAmrod))*100).toFixed(1)}%)`)
    
    const needsUpdate = incorrect + zero
    console.log(`\n🎯 ACTION REQUIRED:`)
    console.log(`   📝 Products needing price updates: ${needsUpdate}`)
    console.log(`   🗑️ Products to deactivate: ${notAvailable}`)
    console.log(`   ❓ Products needing manual review: ${noPricing}`)
    
    // 7. Execute complete price fix
    if (needsUpdate > 0 || notAvailable > 0) {
      console.log(`\n🚀 Starting automatic synchronization...`)
      await executeCompletePriceFix(analysis)
    } else {
      console.log(`\n🎉 PERFECT! All prices are already correct!`)
      console.log(`   Your store is fully synchronized with Amrod.`)
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run the main function
main()