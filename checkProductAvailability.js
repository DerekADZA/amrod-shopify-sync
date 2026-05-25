import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const AMROD_PRODUCTS_URL = 'https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding'
const AMROD_PRICES_URL = 'https://vendorapi.amrod.co.za/api/v1/Prices/'
const SLEEP_MS = 300

// --- Axios Clients ---
const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
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

// --- FETCH AMROD FULL CATALOG ---
async function fetchAmrodFullCatalog(token) {
  try {
    console.log('🔍 Fetching full Amrod catalog with availability status...')
    console.log('⚠️  This may take several minutes...')
    
    const res = await axios.get(AMROD_PRODUCTS_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 300000 // 5 minutes timeout
    })
    
    console.log(`✅ Successfully fetched ${res.data.length} products from catalog`)
    return res.data
  } catch (err) {
    console.error('❌ Failed to fetch full catalog:', err.response?.status, err.response?.statusText)
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
      }
    })
    
    console.log(`✅ Successfully fetched ${res.data.length} price records`)
    return res.data
  } catch (err) {
    console.error('❌ Failed to fetch prices:', err.response?.status, err.response?.statusText)
    process.exit(1)
  }
}

// --- FIND CURRENT ZERO PRICE PRODUCTS ---
async function findCurrentZeroPriceProducts() {
  console.log('\n📦 Finding current zero-price products...')
  
  let zeroProducts = []
  let lastId = null
  let batchCount = 0
  
  while (true) {
    batchCount++
    const params = { limit: 50 }
    if (lastId) params.since_id = lastId
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      for (const product of products) {
        for (const variant of product.variants) {
          const price = variant.price
          const sku = (variant.sku || '').trim()
          
          // Check for zero prices (string "0.00" as we discovered)
          if (price === "0.00" || price === "0" || price === 0) {
            zeroProducts.push({
              product: product,
              variant: variant,
              sku: sku,
              productTitle: product.title,
              vendor: product.vendor,
              status: product.status,
              published: product.published_at ? true : false
            })
          }
        }
      }
      
      lastId = products[products.length - 1].id
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error('❌ Error fetching products:', err.response?.status)
      break
    }
  }
  
  console.log(`✅ Found ${zeroProducts.length} current zero-price products`)
  return zeroProducts
}

// --- ANALYZE PRODUCT AVAILABILITY ---
function analyzeProductAvailability(zeroPriceProducts, amrodCatalog, amrodPrices) {
  console.log('\n🔍 ANALYZING PRODUCT AVAILABILITY...')
  
  // Build lookup maps
  const catalogMap = new Map()
  const priceMap = new Map()
  
  // Build catalog lookup (multiple SKU fields)
  for (const product of amrodCatalog) {
    const keys = [
      product.sku, product.code, product.fullCode, product.fullcode,
      product.simplecode, product.simpleCode, product.productCode
    ].filter(Boolean)
    
    for (const key of keys) {
      catalogMap.set(key.toLowerCase(), product)
    }
  }
  
  // Build price lookup
  for (const price of amrodPrices) {
    const keys = [
      price.fullCode, price.sku, price.code,
      price.simplecode, price.simpleCode
    ].filter(Boolean)
    
    for (const key of keys) {
      priceMap.set(key.toLowerCase(), price)
    }
  }
  
  console.log(`📊 Built lookups: ${catalogMap.size} catalog entries, ${priceMap.size} price entries`)
  
  // Analyze each zero-price product
  let results = {
    inCatalogWithPrice: [],
    inCatalogNoPrice: [],
    notInCatalog: [],
    discontinued: [],
    inactive: []
  }
  
  for (const zeroProduct of zeroPriceProducts) {
    const sku = zeroProduct.sku.toLowerCase()
    const catalogProduct = catalogMap.get(sku)
    const priceData = priceMap.get(sku)
    
    let analysis = {
      ...zeroProduct,
      catalogStatus: null,
      priceAvailable: false,
      shouldBeActive: false,
      reason: '',
      catalogData: catalogProduct,
      priceData: priceData
    }
    
    if (catalogProduct) {
      analysis.catalogStatus = 'FOUND'
      
      // Check various status fields that might exist
      const status = catalogProduct.status || catalogProduct.active || catalogProduct.available
      const discontinued = catalogProduct.discontinued || catalogProduct.obsolete
      const inactive = catalogProduct.inactive || catalogProduct.disabled
      
      if (priceData) {
        analysis.priceAvailable = true
        analysis.shouldBeActive = true
        analysis.reason = 'Product exists with pricing - should be active'
        results.inCatalogWithPrice.push(analysis)
      } else {
        analysis.reason = 'Product exists but no pricing available'
        results.inCatalogNoPrice.push(analysis)
      }
      
      // Check for discontinuation markers
      if (discontinued || status === 'discontinued' || status === 'obsolete') {
        analysis.shouldBeActive = false
        analysis.reason = 'Product discontinued in catalog'
        results.discontinued.push(analysis)
      }
      
      // Check for inactive markers
      if (inactive || status === 'inactive' || status === false) {
        analysis.shouldBeActive = false
        analysis.reason = 'Product inactive in catalog'
        results.inactive.push(analysis)
      }
      
    } else {
      analysis.catalogStatus = 'NOT_FOUND'
      analysis.reason = 'Product not found in current catalog - likely discontinued'
      results.notInCatalog.push(analysis)
    }
  }
  
  return results
}

// --- SHOW AVAILABILITY ANALYSIS ---
function showAvailabilityAnalysis(analysis) {
  console.log(`\n📊 PRODUCT AVAILABILITY ANALYSIS:`)
  console.log('=' * 60)
  
  console.log(`\n✅ PRODUCTS THAT SHOULD BE ACTIVE (${analysis.inCatalogWithPrice.length}):`)
  console.log(`   These have both catalog entry and pricing - should be fixed`)
  analysis.inCatalogWithPrice.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    console.log(`      Reason: ${product.reason}`)
  })
  if (analysis.inCatalogWithPrice.length > 5) {
    console.log(`   ... and ${analysis.inCatalogWithPrice.length - 5} more`)
  }
  
  console.log(`\n⚠️  PRODUCTS WITH CATALOG BUT NO PRICING (${analysis.inCatalogNoPrice.length}):`)
  console.log(`   These exist in catalog but have no pricing data`)
  analysis.inCatalogNoPrice.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    if (product.catalogData) {
      console.log(`      Catalog: ${product.catalogData.name || 'Unknown name'}`)
      console.log(`      Type: ${product.catalogData.type || 'Unknown type'}`)
    }
  })
  if (analysis.inCatalogNoPrice.length > 5) {
    console.log(`   ... and ${analysis.inCatalogNoPrice.length - 5} more`)
  }
  
  console.log(`\n❌ PRODUCTS NOT IN CATALOG (${analysis.notInCatalog.length}):`)
  console.log(`   These should probably be deactivated or removed`)
  analysis.notInCatalog.slice(0, 5).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
    console.log(`      Status: ${product.status}`)
    console.log(`      Published: ${product.published}`)
  })
  if (analysis.notInCatalog.length > 5) {
    console.log(`   ... and ${analysis.notInCatalog.length - 5} more`)
  }
  
  console.log(`\n🗑️  DISCONTINUED PRODUCTS (${analysis.discontinued.length}):`)
  console.log(`   These are marked as discontinued and should be deactivated`)
  analysis.discontinued.slice(0, 3).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
  })
  if (analysis.discontinued.length > 3) {
    console.log(`   ... and ${analysis.discontinued.length - 3} more`)
  }
  
  console.log(`\n🔒 INACTIVE PRODUCTS (${analysis.inactive.length}):`)
  console.log(`   These are marked as inactive and should be deactivated`)
  analysis.inactive.slice(0, 3).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
  })
  if (analysis.inactive.length > 3) {
    console.log(`   ... and ${analysis.inactive.length - 3} more`)
  }
}

// --- EXPORT ANALYSIS RESULTS ---
function exportAnalysisResults(analysis) {
  console.log(`\n📄 EXPORTING ANALYSIS RESULTS...`)
  
  const headers = [
    'SKU',
    'Product Title',
    'Vendor',
    'Shopify Status',
    'Published',
    'Catalog Status',
    'Price Available',
    'Should Be Active',
    'Reason',
    'Recommendation'
  ]
  
  let csvContent = headers.join(',') + '\n'
  
  // Combine all categories
  const allProducts = [
    ...analysis.inCatalogWithPrice.map(p => ({ ...p, category: 'FIX_PRICING' })),
    ...analysis.inCatalogNoPrice.map(p => ({ ...p, category: 'CHECK_PRICING' })),
    ...analysis.notInCatalog.map(p => ({ ...p, category: 'DEACTIVATE' })),
    ...analysis.discontinued.map(p => ({ ...p, category: 'DEACTIVATE' })),
    ...analysis.inactive.map(p => ({ ...p, category: 'DEACTIVATE' }))
  ]
  
  for (const product of allProducts) {
    const recommendation = product.category === 'FIX_PRICING' ? 'Fix pricing' :
                          product.category === 'CHECK_PRICING' ? 'Manual pricing needed' :
                          'Deactivate/Remove'
    
    const row = [
      `"${product.sku}"`,
      `"${product.productTitle.replace(/"/g, '""')}"`,
      `"${product.vendor || 'NO_VENDOR'}"`,
      `"${product.status}"`,
      `"${product.published}"`,
      `"${product.catalogStatus || 'UNKNOWN'}"`,
      `"${product.priceAvailable}"`,
      `"${product.shouldBeActive}"`,
      `"${product.reason.replace(/"/g, '""')}"`,
      `"${recommendation}"`
    ]
    csvContent += row.join(',') + '\n'
  }
  
  console.log(`✅ Analysis export ready with ${allProducts.length} products`)
  return csvContent
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🔍 PRODUCT AVAILABILITY CHECKER`)
  console.log(`This will check which zero-price products should be active vs deactivated`)
  console.log(`Using Amrod catalog and pricing data`)
  console.log('=' * 70)
  
  try {
    // 1. Get Amrod data
    const token = await getAmrodToken()
    const [amrodCatalog, amrodPrices] = await Promise.all([
      fetchAmrodFullCatalog(token),
      fetchAmrodPrices(token)
    ])
    
    // 2. Find current zero-price products
    const zeroPriceProducts = await findCurrentZeroPriceProducts()
    
    if (zeroPriceProducts.length === 0) {
      console.log('\n🎉 NO ZERO-PRICE PRODUCTS FOUND!')
      console.log('✅ All products have been fixed!')
      return
    }
    
    // 3. Analyze availability
    const analysis = analyzeProductAvailability(zeroPriceProducts, amrodCatalog, amrodPrices)
    
    // 4. Show results
    showAvailabilityAnalysis(analysis)
    
    // 5. Export results
    const csvContent = exportAnalysisResults(analysis)
    
    // 6. Summary and recommendations
    console.log(`\n💡 RECOMMENDATIONS:`)
    console.log('=' * 50)
    
    if (analysis.inCatalogWithPrice.length > 0) {
      console.log(`\n🔧 FIX PRICING (${analysis.inCatalogWithPrice.length} products):`)
      console.log(`   These can be fixed with proper Amrod pricing`)
      console.log(`   Run a pricing sync script for these SKUs`)
    }
    
    const shouldDeactivate = analysis.notInCatalog.length + analysis.discontinued.length + analysis.inactive.length
    if (shouldDeactivate > 0) {
      console.log(`\n🗑️  DEACTIVATE (${shouldDeactivate} products):`)
      console.log(`   ${analysis.notInCatalog.length} not in catalog`)
      console.log(`   ${analysis.discontinued.length} discontinued`)
      console.log(`   ${analysis.inactive.length} inactive`)
      console.log(`   These should be unpublished or removed from store`)
    }
    
    if (analysis.inCatalogNoPrice.length > 0) {
      console.log(`\n❓ MANUAL REVIEW (${analysis.inCatalogNoPrice.length} products):`)
      console.log(`   These exist in catalog but have no pricing`)
      console.log(`   May need manual pricing or could be special items`)
    }
    
    console.log(`\n🎯 SUMMARY:`)
    console.log(`   📊 Total zero-price products: ${zeroPriceProducts.length}`)
    console.log(`   🔧 Can be auto-fixed: ${analysis.inCatalogWithPrice.length}`)
    console.log(`   🗑️  Should be deactivated: ${shouldDeactivate}`)
    console.log(`   ❓ Need manual review: ${analysis.inCatalogNoPrice.length}`)
    
    const potentialReduction = shouldDeactivate
    const remainingAfterCleanup = zeroPriceProducts.length - potentialReduction
    console.log(`\n📈 POTENTIAL IMPACT:`)
    console.log(`   Current zero-price products: ${zeroPriceProducts.length}`)
    console.log(`   After deactivating discontinued: ${remainingAfterCleanup}`)
    console.log(`   Reduction: ${((potentialReduction/zeroPriceProducts.length)*100).toFixed(1)}%`)
    
    console.log(`\n✅ AVAILABILITY ANALYSIS COMPLETE!`)
    console.log(`   Check the exported data for detailed action plan`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()