import 'dotenv/config'
import axios from 'axios'
import fs from 'fs'

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

// --- PULL ALL PRODUCTS RAW ---
async function pullAllProductsRaw() {
  console.log('\n📦 Pulling ALL products from Shopify (raw data)...')
  
  let allProducts = []
  let lastId = null
  let batchCount = 0
  
  while (true) {
    batchCount++
    const params = { limit: 250 } // Use max limit for faster download
    if (lastId) params.since_id = lastId
    
    if (batchCount % 5 === 0) {
      console.log(`   📦 Downloaded ${allProducts.length} products so far...`)
    }
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      allProducts.push(...products)
      lastId = products[products.length - 1].id
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error('❌ Error fetching products:', err.response?.status, err.response?.statusText)
      break
    }
  }
  
  console.log(`✅ Downloaded ${allProducts.length} products from Shopify`)
  return allProducts
}

// --- ANALYZE ALL PRICE VALUES ---
function analyzeAllPriceValues(products) {
  console.log('\n🔍 ANALYZING ALL PRICE VALUES...')
  
  let allVariants = []
  let priceValueCounts = new Map()
  let priceTypeCounts = new Map()
  let uniquePriceValues = new Set()
  
  for (const product of products) {
    for (const variant of product.variants) {
      const variantData = {
        productId: product.id,
        variantId: variant.id,
        productTitle: product.title,
        variantTitle: variant.title,
        handle: product.handle,
        vendor: product.vendor,
        sku: variant.sku,
        rawPrice: variant.price,
        priceType: typeof variant.price,
        createdAt: variant.created_at,
        updatedAt: variant.updated_at
      }
      
      allVariants.push(variantData)
      
      // Track price values and types
      const priceStr = String(variant.price)
      const priceType = typeof variant.price
      
      priceValueCounts.set(priceStr, (priceValueCounts.get(priceStr) || 0) + 1)
      priceTypeCounts.set(priceType, (priceTypeCounts.get(priceType) || 0) + 1)
      uniquePriceValues.add(priceStr)
    }
  }
  
  console.log(`✅ Analyzed ${allVariants.length} variants from ${products.length} products`)
  
  // Show price type distribution
  console.log(`\n📊 PRICE TYPE DISTRIBUTION:`)
  const sortedTypes = [...priceTypeCounts.entries()].sort((a, b) => b[1] - a[1])
  sortedTypes.forEach(([type, count]) => {
    console.log(`   ${type}: ${count} variants`)
  })
  
  // Show most common price values
  console.log(`\n📊 MOST COMMON PRICE VALUES (top 20):`)
  const sortedPrices = [...priceValueCounts.entries()].sort((a, b) => b[1] - a[1])
  sortedPrices.slice(0, 20).forEach(([price, count]) => {
    console.log(`   "${price}": ${count} variants`)
  })
  
  // Find all potential zero values
  console.log(`\n🔍 ALL POTENTIAL ZERO/LOW VALUES:`)
  const potentialZeroValues = [...uniquePriceValues].filter(price => {
    const priceStr = String(price).toLowerCase()
    return priceStr === '0' || 
           priceStr === '0.0' || 
           priceStr === '0.00' || 
           priceStr === '' || 
           priceStr === 'null' || 
           priceStr === 'undefined' ||
           (parseFloat(price) < 1 && !isNaN(parseFloat(price)))
  }).sort()
  
  potentialZeroValues.forEach(price => {
    const count = priceValueCounts.get(price)
    console.log(`   "${price}": ${count} variants`)
  })
  
  return { allVariants, priceValueCounts, potentialZeroValues }
}

// --- FILTER VARIANTS BY PRICE CRITERIA ---
function filterVariantsByPrice(allVariants, targetPrices = ['0', '0.0', '0.00']) {
  console.log(`\n🎯 FILTERING VARIANTS BY SPECIFIC PRICE VALUES...`)
  console.log(`   Looking for prices: ${targetPrices.map(p => `"${p}"`).join(', ')}`)
  
  let matchingVariants = []
  
  for (const variant of allVariants) {
    const priceStr = String(variant.rawPrice)
    if (targetPrices.includes(priceStr)) {
      matchingVariants.push(variant)
    }
  }
  
  console.log(`✅ Found ${matchingVariants.length} variants with target price values`)
  return matchingVariants
}

// --- EXPORT FILTERED VARIANTS ---
function exportFilteredVariants(variants, filename = 'zero_price_variants.csv') {
  console.log(`\n📄 EXPORTING ${variants.length} VARIANTS TO ${filename}...`)
  
  const headers = [
    'Vendor',
    'Product Title',
    'Variant Title',
    'Product Handle',
    'SKU',
    'Raw Price',
    'Price Type',
    'Product ID',
    'Variant ID',
    'Created At',
    'Updated At'
  ]
  
  let csvContent = headers.join(',') + '\n'
  
  for (const variant of variants) {
    const row = [
      `"${variant.vendor || 'NO_VENDOR'}"`,
      `"${variant.productTitle.replace(/"/g, '""')}"`,
      `"${variant.variantTitle.replace(/"/g, '""')}"`,
      `"${variant.handle || ''}"`,
      `"${variant.sku || ''}"`,
      `"${variant.rawPrice}"`,
      `"${variant.priceType}"`,
      variant.productId,
      variant.variantId,
      variant.createdAt || '',
      variant.updatedAt || ''
    ]
    csvContent += row.join(',') + '\n'
  }
  
  // Write to file
  try {
    fs.writeFileSync(filename, csvContent)
    console.log(`✅ Exported to ${filename}`)
  } catch (err) {
    console.log(`❌ Could not write file: ${err.message}`)
    console.log(`📄 CSV content ready (${csvContent.length} characters)`)
  }
  
  // Show sample
  console.log(`\n📋 SAMPLE EXPORTED DATA (first 5 rows):`)
  const lines = csvContent.split('\n')
  lines.slice(0, 6).forEach((line, index) => {
    if (line.trim()) {
      console.log(`   ${index === 0 ? 'HEADERS' : `ROW ${index}`}: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`)
    }
  })
  
  return csvContent
}

// --- ANALYZE VENDORS OF FILTERED VARIANTS ---
function analyzeVendorsOfFilteredVariants(variants) {
  console.log(`\n📊 VENDOR ANALYSIS OF FILTERED VARIANTS:`)
  
  const vendorGroups = new Map()
  
  for (const variant of variants) {
    const vendor = variant.vendor || 'NO_VENDOR'
    if (!vendorGroups.has(vendor)) {
      vendorGroups.set(vendor, [])
    }
    vendorGroups.get(vendor).push(variant)
  }
  
  const sortedVendors = [...vendorGroups.entries()].sort((a, b) => b[1].length - a[1].length)
  
  sortedVendors.forEach(([vendor, variants]) => {
    console.log(`\n🏪 ${vendor}: ${variants.length} variants`)
    
    // Show sample products
    variants.slice(0, 3).forEach((variant, index) => {
      console.log(`   ${index + 1}. "${variant.sku}" - ${variant.productTitle}`)
      console.log(`      Price: ${JSON.stringify(variant.rawPrice)} (${variant.priceType})`)
    })
    
    if (variants.length > 3) {
      console.log(`   ... and ${variants.length - 3} more`)
    }
  })
  
  return sortedVendors
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`📥 PULL ALL PRODUCTS & ANALYZE LOCALLY`)
  console.log(`This will download ALL products and analyze price values locally`)
  console.log(`To find the discrepancy between API results and actual data`)
  console.log('=' * 70)
  
  try {
    // 1. Pull all products from Shopify
    const allProducts = await pullAllProductsRaw()
    
    // 2. Analyze all price values
    const analysis = analyzeAllPriceValues(allProducts)
    
    // 3. Ask user what price values to filter by
    console.log(`\n❓ WHICH PRICE VALUES SHOULD WE FILTER BY?`)
    console.log(`   Based on the analysis above, we can filter by specific values`)
    console.log(`   Common zero values: "0", "0.0", "0.00"`)
    console.log(`   But you might see other patterns in the data above`)
    
    // For now, let's filter by common zero values
    const targetPrices = ['0', '0.0', '0.00', '']
    const filteredVariants = filterVariantsByPrice(analysis.allVariants, targetPrices)
    
    // 4. Analyze vendors of filtered variants
    if (filteredVariants.length > 0) {
      const vendorAnalysis = analyzeVendorsOfFilteredVariants(filteredVariants)
      
      // 5. Export results
      const csvContent = exportFilteredVariants(filteredVariants)
    }
    
    // 6. Try different price criteria if first attempt didn't find many
    if (filteredVariants.length < 50 && analysis.potentialZeroValues.length > 0) {
      console.log(`\n🔄 TRYING BROADER CRITERIA...`)
      console.log(`   First attempt found ${filteredVariants.length} variants`)
      console.log(`   Trying with all potential zero values: ${analysis.potentialZeroValues.join(', ')}`)
      
      const broaderVariants = filterVariantsByPrice(analysis.allVariants, analysis.potentialZeroValues)
      
      if (broaderVariants.length > filteredVariants.length) {
        console.log(`   Broader search found ${broaderVariants.length} variants`)
        analyzeVendorsOfFilteredVariants(broaderVariants)
        exportFilteredVariants(broaderVariants, 'broader_zero_price_variants.csv')
      }
    }
    
    console.log(`\n🎯 FINAL RESULTS:`)
    console.log(`   📊 Total products: ${allProducts.length}`)
    console.log(`   📊 Total variants: ${analysis.allVariants.length}`)
    console.log(`   📊 Potential zero-price variants: ${filteredVariants.length}`)
    
    if (filteredVariants.length < 100) {
      console.log(`   💡 Much fewer than expected 164 - products may have been updated`)
    } else {
      console.log(`   ✅ Found substantial number of zero-price variants`)
    }
    
    console.log(`\n✅ LOCAL ANALYSIS COMPLETE!`)
    console.log(`   Check the exported CSV files for detailed data`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()