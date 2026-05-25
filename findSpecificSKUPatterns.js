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

// SKUs from your CSV that showed 0 prices
const SAMPLE_SKUS_FROM_CSV = [
  'gf-av-972-b-bl-0',
  'gf-av-971-b-bl-0', 
  'gf-av-969-b-bl-0',
  'gf-av-968-b-bl-0',
  'av-19033-bl',
  'gf-av-896-b-bl-0',
  'gf-av-895-b-bl-0',
  'gf-av-768-b-bl-0',
  'gf-av-767-b-bl-0',
  'gf-av-766-b-bl-0',
  'gf-av-765-b-bl-0',
  'gf-av-764-b-bl-0',
  'gf-av-763-b-bl-0',
  'gf-av-740-b-bl-0',
  'gf-av-738-b-bl-0',
  'gf-av-737-b-bl-0',
  'gf-av-736-b-bl-0',
  'gf-av-735-b-bl-0',
  'gf-av-734-b-bl-0',
  'gf-av-733-b-bl-0',
  'gf-av-732-b-s-0',
  'gf-av-701-b-bl-0',
  'av-19017-bl',
  'av-19176-gm',
  'av-19175-gm',
  'av-19174-gm',
  'av-19173-gm',
  'av-19172-gm',
  'av-19169-bl'
]

// --- FIND SPECIFIC PRODUCTS BY SKU ---
async function findProductsBySKUs(skuList) {
  console.log(`\n📦 Looking for specific products by SKU...`)
  console.log(`   Searching for ${skuList.length} SKUs from CSV`)
  
  let foundProducts = []
  let notFoundSKUs = []
  let lastId = null
  let batchCount = 0
  let totalScanned = 0
  
  // Create a Set for faster lookup
  const skuSet = new Set(skuList.map(sku => sku.toLowerCase()))
  
  while (true) {
    batchCount++
    const params = { limit: 50, vendor: 'Amrod' }
    if (lastId) params.since_id = lastId
    
    if (batchCount % 10 === 0) {
      console.log(`   📦 Scanned ${totalScanned} Amrod products, found ${foundProducts.length} matching SKUs...`)
    }
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      totalScanned += products.length
      
      for (const product of products) {
        if (product.vendor && product.vendor.toLowerCase() === 'amrod') {
          for (const variant of product.variants) {
            const sku = (variant.sku || '').trim().toLowerCase()
            
            if (skuSet.has(sku)) {
              foundProducts.push({
                product: product,
                variant: variant,
                originalSKU: variant.sku,
                sku: sku,
                price: variant.price,
                priceType: typeof variant.price,
                productTitle: product.title,
                variantTitle: variant.title,
                vendor: product.vendor,
                productId: product.id,
                variantId: variant.id,
                createdAt: variant.created_at,
                updatedAt: variant.updated_at
              })
              
              // Remove from set so we can track what wasn't found
              skuSet.delete(sku)
            }
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
  
  // What's left in skuSet wasn't found
  notFoundSKUs = Array.from(skuSet)
  
  console.log(`✅ Search complete:`)
  console.log(`   Total Amrod products scanned: ${totalScanned}`)
  console.log(`   SKUs found: ${foundProducts.length}`)
  console.log(`   SKUs not found: ${notFoundSKUs.length}`)
  
  return { foundProducts, notFoundSKUs }
}

// --- ANALYZE FOUND PRODUCTS ---
function analyzeFoundProducts(foundProducts) {
  if (foundProducts.length === 0) {
    console.log(`\n❌ No products found with the specified SKUs`)
    return
  }
  
  console.log(`\n🔍 ANALYSIS OF FOUND PRODUCTS:`)
  
  let zeroPrice = 0
  let validPrice = 0
  let priceFormats = new Map()
  
  foundProducts.forEach((product, index) => {
    const price = parseFloat(product.price) || 0
    const priceKey = `${product.priceType}:"${product.price}"`
    
    priceFormats.set(priceKey, (priceFormats.get(priceKey) || 0) + 1)
    
    if (price === 0) {
      zeroPrice++
    } else {
      validPrice++
    }
    
    console.log(`\n   ${index + 1}. SKU: "${product.originalSKU}"`)
    console.log(`      Product: ${product.productTitle}`)
    console.log(`      Current Price: ${JSON.stringify(product.price)} (${product.priceType})`)
    console.log(`      Parsed Price: R${price}`)
    console.log(`      Status: ${price === 0 ? '❌ ZERO PRICE' : '✅ HAS PRICE'}`)
    console.log(`      Updated: ${product.updatedAt}`)
  })
  
  console.log(`\n📊 SUMMARY:`)
  console.log(`   Zero price products: ${zeroPrice}`)
  console.log(`   Valid price products: ${validPrice}`)
  
  console.log(`\n📊 PRICE FORMATS FOUND:`)
  const sortedFormats = [...priceFormats.entries()].sort((a, b) => b[1] - a[1])
  sortedFormats.forEach(([format, count]) => {
    console.log(`   ${format}: ${count} products`)
  })
  
  return { zeroPrice, validPrice, priceFormats }
}

// --- CHECK CURRENT INVENTORY COUNT ---
async function checkCurrentInventoryStats() {
  console.log(`\n📊 CHECKING CURRENT STORE STATISTICS...`)
  
  let totalProducts = 0
  let totalVariants = 0
  let zeroPriceCount = 0
  let lastId = null
  
  while (true) {
    const params = { limit: 250 }
    if (lastId) params.since_id = lastId
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      totalProducts += products.length
      
      for (const product of products) {
        for (const variant of product.variants) {
          totalVariants++
          const price = parseFloat(variant.price) || 0
          if (price === 0) {
            zeroPriceCount++
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
  
  console.log(`   Total products in store: ${totalProducts}`)
  console.log(`   Total variants in store: ${totalVariants}`)
  console.log(`   Current zero price variants: ${zeroPriceCount}`)
  
  return { totalProducts, totalVariants, zeroPriceCount }
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🎯 SPECIFIC SKU PATTERN FINDER`)
  console.log(`This will look for specific SKUs that showed 0 prices in your CSV`)
  console.log(`Sample SKUs from your CSV data`)
  console.log('=' * 70)
  
  try {
    // 1. Check current store stats
    const storeStats = await checkCurrentInventoryStats()
    
    // 2. Look for specific SKUs from CSV
    const { foundProducts, notFoundSKUs } = await findProductsBySKUs(SAMPLE_SKUS_FROM_CSV)
    
    // 3. Analyze what we found
    if (foundProducts.length > 0) {
      const analysis = analyzeFoundProducts(foundProducts)
      
      console.log(`\n💡 INSIGHTS:`)
      if (analysis && analysis.zeroPrice === 0) {
        console.log(`   ✅ All CSV SKUs now have valid prices!`)
        console.log(`   🎉 This suggests our previous fixes worked better than expected`)
        console.log(`   📈 The 484 -> 4 reduction makes sense now`)
      }
    }
    
    // 4. Show not found SKUs
    if (notFoundSKUs.length > 0) {
      console.log(`\n❌ SKUs NOT FOUND (${notFoundSKUs.length}):`)
      notFoundSKUs.slice(0, 10).forEach((sku, index) => {
        console.log(`   ${index + 1}. "${sku}"`)
      })
      if (notFoundSKUs.length > 10) {
        console.log(`   ... and ${notFoundSKUs.length - 10} more`)
      }
      console.log(`   💡 These might have been deleted or have different SKU formats`)
    }
    
    console.log(`\n🎯 CONCLUSION:`)
    if (storeStats.zeroPriceCount <= 10) {
      console.log(`   🎉 SUCCESS: Store now has only ${storeStats.zeroPriceCount} zero-price products!`)
      console.log(`   📉 Down from 484 - our fixes were very effective!`)
      console.log(`   ✅ Mission largely accomplished!`)
    } else {
      console.log(`   ⚠️  Still ${storeStats.zeroPriceCount} zero-price products remaining`)
      console.log(`   🔍 Need to investigate why these weren't found`)
    }
    
    console.log(`\n✅ ANALYSIS COMPLETE!`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()