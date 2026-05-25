import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
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

// --- VERY AGGRESSIVE ZERO PRICE DETECTION ---
function isZeroPriceAggressive(price) {
  // Convert everything to string first to see what we're dealing with
  const priceStr = String(price).trim()
  
  // All the ways something could be "zero"
  if (price === null || price === undefined) return true
  if (priceStr === '' || priceStr === 'null' || priceStr === 'undefined') return true
  if (priceStr === '0' || priceStr === '0.0' || priceStr === '0.00' || priceStr === '0.000') return true
  if (price === 0 || price === 0.0) return true
  
  // Try parsing as number
  const numPrice = parseFloat(price)
  if (isNaN(numPrice)) return true // If it can't be parsed as number, consider it zero
  if (numPrice === 0 || numPrice < 0.001) return true // Very small numbers count as zero
  
  return false
}

// --- GET ALL PRODUCTS WITH DETAILED LOGGING ---
async function getAllProductsWithDetailedLogging() {
  console.log('\n📦 Scanning ALL products with aggressive zero detection...')
  
  let allProducts = []
  let allZeroProducts = []
  let priceExamples = new Map() // Track different price formats we see
  let lastId = null
  let batchCount = 0
  let totalVariants = 0
  
  while (true) {
    batchCount++
    const params = { limit: 50 }
    if (lastId) params.since_id = lastId
    
    if (batchCount % 20 === 0) {
      console.log(`   📦 Batch ${batchCount}: ${allProducts.length} products, ${totalVariants} variants, ${allZeroProducts.length} zero-price found...`)
    }
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      allProducts.push(...products)
      
      for (const product of products) {
        for (const variant of product.variants) {
          totalVariants++
          const rawPrice = variant.price
          const sku = (variant.sku || '').trim()
          
          // Track price format examples
          const priceKey = `${typeof rawPrice}:"${rawPrice}"`
          const currentCount = priceExamples.get(priceKey) || 0
          priceExamples.set(priceKey, currentCount + 1)
          
          // Use aggressive zero detection
          if (isZeroPriceAggressive(rawPrice)) {
            allZeroProducts.push({
              product: product,
              variant: variant,
              sku: sku,
              rawPrice: rawPrice,
              priceType: typeof rawPrice,
              productTitle: product.title,
              variantTitle: variant.title,
              vendor: product.vendor || 'NO_VENDOR',
              productId: product.id,
              variantId: variant.id,
              createdAt: variant.created_at,
              updatedAt: variant.updated_at
            })
          }
        }
      }
      
      lastId = products[products.length - 1].id
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error('❌ Error fetching products:', err.response?.status, err.response?.statusText)
      break
    }
  }
  
  console.log(`\n✅ SCAN COMPLETE:`)
  console.log(`   Total products: ${allProducts.length}`)
  console.log(`   Total variants: ${totalVariants}`)
  console.log(`   Zero-price variants found: ${allZeroProducts.length}`)
  
  // Show price format distribution
  console.log(`\n📊 PRICE FORMATS FOUND (top 15):`)
  const sortedPrices = [...priceExamples.entries()].sort((a, b) => b[1] - a[1])
  sortedPrices.slice(0, 15).forEach(([format, count]) => {
    const isZeroFormat = format.includes('"0"') || format.includes('"0.00"') || format.includes('""') || format.includes('null')
    console.log(`   ${format}: ${count} variants ${isZeroFormat ? '⚠️ (ZERO FORMAT)' : ''}`)
  })
  
  return { allProducts, allZeroProducts, priceExamples }
}

// --- ANALYZE ZERO PRODUCTS BY VENDOR ---
function analyzeZeroProductsByVendor(zeroProducts) {
  console.log(`\n🔍 ANALYZING ${zeroProducts.length} ZERO-PRICE PRODUCTS BY VENDOR:`)
  
  const vendorGroups = new Map()
  
  for (const product of zeroProducts) {
    const vendor = product.vendor || 'NO_VENDOR'
    if (!vendorGroups.has(vendor)) {
      vendorGroups.set(vendor, [])
    }
    vendorGroups.get(vendor).push(product)
  }
  
  const sortedVendors = [...vendorGroups.entries()].sort((a, b) => b[1].length - a[1].length)
  
  console.log(`\n📊 BY VENDOR:`)
  sortedVendors.forEach(([vendor, products]) => {
    console.log(`   ${vendor}: ${products.length} products`)
  })
  
  // Show detailed breakdown for each vendor
  console.log(`\n📋 DETAILED VENDOR BREAKDOWN:`)
  sortedVendors.forEach(([vendor, products]) => {
    console.log(`\n🏪 ${vendor} (${products.length} products):`)
    
    // Show first 5 examples from each vendor
    products.slice(0, 5).forEach((product, index) => {
      console.log(`   ${index + 1}. "${product.sku}" - ${product.productTitle}`)
      console.log(`      Raw Price: ${JSON.stringify(product.rawPrice)} (${product.priceType})`)
      console.log(`      Created: ${product.createdAt}`)
    })
    
    if (products.length > 5) {
      console.log(`   ... and ${products.length - 5} more`)
    }
  })
  
  return sortedVendors
}

// --- EXPORT RESULTS ---
function exportResults(zeroProducts) {
  console.log(`\n📄 GENERATING COMPREHENSIVE EXPORT...`)
  
  const headers = [
    'Vendor',
    'Product Title',
    'Variant Title', 
    'SKU',
    'Raw Price',
    'Price Type',
    'Product ID',
    'Variant ID',
    'Product Handle',
    'Created At',
    'Updated At'
  ]
  
  let csvContent = headers.join(',') + '\n'
  
  for (const product of zeroProducts) {
    const row = [
      `"${product.vendor || 'NO_VENDOR'}"`,
      `"${product.productTitle.replace(/"/g, '""')}"`,
      `"${product.variantTitle.replace(/"/g, '""')}"`,
      `"${product.sku}"`,
      `"${product.rawPrice}"`,
      `"${product.priceType}"`,
      product.productId,
      product.variantId,
      `"${product.product.handle || ''}"`,
      product.createdAt,
      product.updatedAt
    ]
    csvContent += row.join(',') + '\n'
  }
  
  console.log(`✅ CSV export ready with ${zeroProducts.length} zero-price products`)
  
  // Show first few lines as sample
  console.log(`\n📋 CSV SAMPLE (first 3 lines):`)
  const lines = csvContent.split('\n')
  lines.slice(0, 4).forEach((line, index) => {
    if (line.trim()) {
      console.log(`   ${index === 0 ? 'HEADERS' : `ROW ${index}`}: ${line.substring(0, 120)}${line.length > 120 ? '...' : ''}`)
    }
  })
  
  return csvContent
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🔍 AGGRESSIVE ZERO-PRICE PRODUCT FINDER`)
  console.log(`This will use the most aggressive detection to find ALL zero-price products`)
  console.log(`Expected: Find the actual ~164 (or whatever the real number is)`)
  console.log('=' * 80)
  
  try {
    // 1. Scan all products with detailed logging
    const { allProducts, allZeroProducts, priceExamples } = await getAllProductsWithDetailedLogging()
    
    if (allZeroProducts.length === 0) {
      console.log('\n🎉 NO ZERO PRICE PRODUCTS FOUND!')
      console.log('✅ All products have valid pricing')
      console.log('\n💡 If this seems wrong, check the price format analysis above')
      return
    }
    
    // 2. Analyze by vendor
    const vendorAnalysis = analyzeZeroProductsByVendor(allZeroProducts)
    
    // 3. Export results
    const csvContent = exportResults(allZeroProducts)
    
    // 4. Final summary
    console.log(`\n🎯 AGGRESSIVE SCAN RESULTS:`)
    console.log('=' * 50)
    console.log(`   📊 Total products scanned: ${allProducts.length}`)
    console.log(`   📊 Zero-price products found: ${allZeroProducts.length}`)
    console.log(`   📊 Unique vendors with zero prices: ${vendorAnalysis.length}`)
    
    if (allZeroProducts.length !== 164) {
      console.log(`\n⚠️  DISCREPANCY ALERT:`)
      console.log(`   Expected: ~164 zero-price products`)
      console.log(`   Found: ${allZeroProducts.length} zero-price products`)
      
      if (allZeroProducts.length < 100) {
        console.log(`   💡 Much fewer found - products may have been fixed already`)
      } else if (allZeroProducts.length > 200) {
        console.log(`   💡 More found - detection may be too aggressive`)
      }
    }
    
    console.log(`\n📄 Complete CSV data generated for analysis`)
    console.log(`✅ AGGRESSIVE SCAN COMPLETE!`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()