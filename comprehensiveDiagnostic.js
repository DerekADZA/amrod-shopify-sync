import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
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
    return null
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
    return null
  }
}

// --- FETCH AMROD PRICES ---
async function fetchAmrodPrices(token) {
  if (!token) return null
  
  try {
    console.log('🔍 Fetching Amrod prices...')
    const res = await axios.get('https://vendorapi.amrod.co.za/api/v1/Prices/', {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })
    
    console.log(`✅ Successfully fetched ${res.data.length} price records from Amrod`)
    return res.data
  } catch (err) {
    console.error('❌ Failed to fetch Amrod prices:', err.response?.status, err.response?.statusText)
    return null
  }
}

// --- BUILD CASE-INSENSITIVE PRICING MAP ---
function buildCaseInsensitivePricingMap(prices) {
  const pricingMap = new Map() // lowercase SKU -> cost
  const originalCaseMap = new Map() // lowercase SKU -> original case SKU
  
  console.log('📊 Building case-insensitive pricing map...')
  
  for (const priceRecord of prices) {
    const fullCode = priceRecord.fullCode || priceRecord.sku || priceRecord.code
    const simpleCode = priceRecord.simplecode || priceRecord.simpleCode
    const cost = priceRecord.cost || priceRecord.price || priceRecord.unitPrice
    
    if (!cost || isNaN(parseFloat(cost))) continue
    
    const costValue = parseFloat(cost)
    
    // Store both full code and simple code in lowercase for matching
    if (fullCode) {
      const lowerSKU = fullCode.toLowerCase()
      pricingMap.set(lowerSKU, costValue)
      originalCaseMap.set(lowerSKU, fullCode)
    }
    if (simpleCode && simpleCode !== fullCode) {
      const lowerSKU = simpleCode.toLowerCase()
      pricingMap.set(lowerSKU, costValue)
      originalCaseMap.set(lowerSKU, simpleCode)
    }
  }
  
  console.log(`📊 Case-insensitive pricing map built with ${pricingMap.size} entries`)
  return { pricingMap, originalCaseMap }
}

// --- GET AMROD PRODUCTS ONLY ---
async function getAmrodProductsOnly() {
  console.log('\n📦 Fetching ONLY Amrod vendor products...')
  
  let allAmrodProducts = []
  let lastId = null
  let batchCount = 0
  let totalScanned = 0
  
  while (true) {
    batchCount++
    const params = { 
      limit: 50,
      vendor: 'Amrod' // Filter by Amrod vendor only
    }
    if (lastId) params.since_id = lastId
    
    if (batchCount % 10 === 0) {
      console.log(`   📦 Fetched ${allAmrodProducts.length} Amrod products so far... (scanned ${totalScanned} total)`)
    }
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      totalScanned += products.length
      
      // Double-check vendor field and add to Amrod products
      for (const product of products) {
        if (product.vendor && product.vendor.toLowerCase() === 'amrod') {
          allAmrodProducts.push(product)
        }
      }
      
      lastId = products[products.length - 1].id
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error('❌ Error fetching products:', err.response?.status, err.response?.statusText)
      break
    }
  }
  
  console.log(`✅ Retrieved ${allAmrodProducts.length} Amrod products (scanned ${totalScanned} total products)`)
  return allAmrodProducts
}

// --- ANALYZE AMROD PRODUCTS ---
function analyzeAmrodProducts(products, amrodData = null) {
  console.log('\n🔍 AMROD PRODUCTS ANALYSIS')
  console.log('=' * 50)
  
  let stats = {
    totalProducts: products.length,
    totalVariants: 0,
    zeroPrice: 0,
    validPrice: 0,
    emptySKU: 0,
    validSKU: 0,
    skuPatterns: new Map(),
    priceDistribution: {
      zero: 0,
      under1: 0,
      under10: 0,
      under100: 0,
      under500: 0,
      over500: 0
    },
    caseMismatchedSKUs: 0
  }
  
  let allZeroPriceProducts = []
  let allValidProducts = []
  let sampleSKUs = []
  let exactMatches = 0
  let caseInsensitiveMatches = 0
  
  const { pricingMap, originalCaseMap } = amrodData || { pricingMap: new Map(), originalCaseMap: new Map() }
  
  console.log(`\n📊 Processing ${products.length} Amrod products...`)
  
  for (const product of products) {
    console.log(`   Processing: ${product.title} (Vendor: ${product.vendor})`)
    
    for (const variant of product.variants) {
      stats.totalVariants++
      
      const sku = (variant.sku || '').trim()
      const price = parseFloat(variant.price) || 0
      
      // SKU Analysis
      if (!sku) {
        stats.emptySKU++
      } else {
        stats.validSKU++
        
        // Collect sample SKUs
        if (sampleSKUs.length < 30) {
          sampleSKUs.push(sku)
        }
        
        // Analyze SKU patterns
        const pattern = analyzeSKUPattern(sku)
        stats.skuPatterns.set(pattern, (stats.skuPatterns.get(pattern) || 0) + 1)
        
        // Check Amrod matching - both exact and case-insensitive
        if (amrodData) {
          const lowerSKU = sku.toLowerCase()
          
          // Check exact match first
          if (originalCaseMap.has(sku)) {
            exactMatches++
          }
          // Check case-insensitive match
          else if (pricingMap.has(lowerSKU)) {
            caseInsensitiveMatches++
            stats.caseMismatchedSKUs++
          }
        }
      }
      
      // Price Analysis
      const productData = {
        productTitle: product.title,
        variantTitle: variant.title,
        sku: sku,
        price: price,
        productId: product.id,
        variantId: variant.id,
        createdAt: variant.created_at,
        updatedAt: variant.updated_at,
        vendor: product.vendor
      }
      
      if (price === 0) {
        stats.zeroPrice++
        stats.priceDistribution.zero++
        allZeroPriceProducts.push(productData)
      } else {
        stats.validPrice++
        allValidProducts.push(productData)
        
        // Price distribution
        if (price < 1) stats.priceDistribution.under1++
        else if (price < 10) stats.priceDistribution.under10++
        else if (price < 100) stats.priceDistribution.under100++
        else if (price < 500) stats.priceDistribution.under500++
        else stats.priceDistribution.over500++
      }
    }
  }
  
  // Print comprehensive analysis
  console.log(`\n📊 AMROD INVENTORY OVERVIEW:`)
  console.log(`   Total Amrod Products: ${stats.totalProducts}`)
  console.log(`   Total Amrod Variants: ${stats.totalVariants}`)
  
  console.log(`\n💰 AMROD PRICING ANALYSIS:`)
  console.log(`   Zero Price Products: ${stats.zeroPrice} (${((stats.zeroPrice/stats.totalVariants)*100).toFixed(1)}%)`)
  console.log(`   Valid Price Products: ${stats.validPrice} (${((stats.validPrice/stats.totalVariants)*100).toFixed(1)}%)`)
  
  console.log(`\n   Detailed Price Distribution:`)
  console.log(`     R0.00 (ZERO): ${stats.priceDistribution.zero}`)
  console.log(`     R0.01-R0.99: ${stats.priceDistribution.under1}`)
  console.log(`     R1.00-R9.99: ${stats.priceDistribution.under10}`)
  console.log(`     R10.00-R99.99: ${stats.priceDistribution.under100}`)
  console.log(`     R100.00-R499.99: ${stats.priceDistribution.under500}`)
  console.log(`     R500.00+: ${stats.priceDistribution.over500}`)
  
  console.log(`\n🏷️  AMROD SKU ANALYSIS:`)
  console.log(`   Empty SKUs: ${stats.emptySKU} (${((stats.emptySKU/stats.totalVariants)*100).toFixed(1)}%)`)
  console.log(`   Valid SKUs: ${stats.validSKU} (${((stats.validSKU/stats.totalVariants)*100).toFixed(1)}%)`)
  
  if (amrodData) {
    console.log(`\n🔗 AMROD API MATCHING:`)
    console.log(`   Exact case matches: ${exactMatches}`)
    console.log(`   Case-insensitive matches: ${caseInsensitiveMatches}`)
    console.log(`   Total matchable SKUs: ${exactMatches + caseInsensitiveMatches}`)
    console.log(`   Unmatched SKUs: ${stats.validSKU - exactMatches - caseInsensitiveMatches}`)
    console.log(`   Match rate: ${(((exactMatches + caseInsensitiveMatches)/stats.validSKU)*100).toFixed(1)}%`)
    console.log(`   Case mismatch rate: ${((stats.caseMismatchedSKUs/stats.validSKU)*100).toFixed(1)}%`)
  }
  
  console.log(`\n🏷️  AMROD SKU PATTERN ANALYSIS:`)
  const sortedPatterns = [...stats.skuPatterns.entries()].sort((a, b) => b[1] - a[1])
  sortedPatterns.forEach(([pattern, count]) => {
    console.log(`   ${pattern}: ${count} variants`)
  })
  
  console.log(`\n📋 SAMPLE AMROD SKUs WITH API MATCH STATUS:`)
  sampleSKUs.forEach((sku, index) => {
    let matchStatus = '❌ No match'
    if (amrodData) {
      if (originalCaseMap.has(sku)) {
        matchStatus = '✅ Exact match'
      } else if (pricingMap.has(sku.toLowerCase())) {
        const amrodSKU = originalCaseMap.get(sku.toLowerCase())
        matchStatus = `🔄 Case mismatch (API: "${amrodSKU}")`
      }
    }
    console.log(`   ${index + 1}. "${sku}" ${matchStatus}`)
  })
  
  // Show ALL zero price Amrod products
  if (allZeroPriceProducts.length > 0) {
    console.log(`\n🚨 ALL ZERO PRICE AMROD PRODUCTS (${allZeroPriceProducts.length} total):`)
    allZeroPriceProducts.forEach((problem, index) => {
      let amrodStatus = '❌ No API match'
      let fixable = false
      
      if (amrodData) {
        const lowerSKU = problem.sku.toLowerCase()
        if (originalCaseMap.has(problem.sku)) {
          amrodStatus = '✅ Exact API match - IMMEDIATELY FIXABLE'
          fixable = true
        } else if (pricingMap.has(lowerSKU)) {
          amrodStatus = `🔄 Case mismatch - FIXABLE (API: "${originalCaseMap.get(lowerSKU)}")`
          fixable = true
        }
      }
      
      console.log(`   ${index + 1}. SKU: "${problem.sku}" ${amrodStatus}`)
      console.log(`      Product: ${problem.productTitle}`)
      console.log(`      Created: ${problem.createdAt}`)
      console.log(`      ${fixable ? '🛠️  CAN BE FIXED' : '⚠️  NEEDS MANUAL REVIEW'}`)
    })
    
    // Count fixable vs unfixable
    if (amrodData) {
      const fixableCount = allZeroPriceProducts.filter(p => {
        const lowerSKU = p.sku.toLowerCase()
        return originalCaseMap.has(p.sku) || pricingMap.has(lowerSKU)
      }).length
      
      console.log(`\n📊 ZERO PRICE SUMMARY:`)
      console.log(`   Total zero-price Amrod products: ${allZeroPriceProducts.length}`)
      console.log(`   Immediately fixable: ${fixableCount}`)
      console.log(`   Need manual review: ${allZeroPriceProducts.length - fixableCount}`)
    }
  } else {
    console.log(`\n✅ NO ZERO PRICE AMROD PRODUCTS FOUND!`)
  }
  
  return { 
    stats, 
    allZeroPriceProducts, 
    allValidProducts, 
    sampleSKUs, 
    exactMatches, 
    caseInsensitiveMatches 
  }
}

// --- ANALYZE SKU PATTERN ---
function analyzeSKUPattern(sku) {
  if (!sku) return 'EMPTY'
  
  // Improved pattern recognition for Amrod
  if (/^[A-Z]{2}-[A-Z]{2}-\d{3}-[A-Z]-?[A-Z]?-?\d*$/i.test(sku)) return 'AMROD_FULL' // GF-AM-916-B-S-0
  if (/^[A-Z]{2}-[A-Z]{2}-\d{3}-[A-Z]$/i.test(sku)) return 'AMROD_SIMPLE' // GF-AM-916-B
  if (/^[A-Za-z]+-\d+-[A-Za-z]+$/i.test(sku)) return 'CATEGORY_NUMBER_COLOR' // ac-2365-bl
  if (/^[A-Za-z]+-\d+$/i.test(sku)) return 'CATEGORY_NUMBER' // tech-5212
  if (/^\d+$/.test(sku)) return 'NUMERIC_ONLY'
  if (/^[A-Z]+\d+$/i.test(sku)) return 'ALPHANUMERIC'
  if (sku.includes('-')) return 'HYPHENATED'
  if (sku.includes('_')) return 'UNDERSCORED'
  if (/^[A-Z]+$/i.test(sku)) return 'LETTERS_ONLY'
  
  return 'OTHER'
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🎯 AMROD-ONLY SHOPIFY DIAGNOSTIC`)
  console.log(`This will analyze ONLY products with vendor = "Amrod"`)
  console.log('=' * 60)
  
  try {
    // 1. Get only Amrod products
    const amrodProducts = await getAmrodProductsOnly()
    
    if (amrodProducts.length === 0) {
      console.log('❌ No Amrod products found in Shopify store')
      console.log('💡 Check if vendor field is set correctly to "Amrod"')
      return
    }
    
    // 2. Get Amrod API data for comparison
    const token = await getAmrodToken()
    const amrodPrices = await fetchAmrodPrices(token)
    const amrodData = amrodPrices ? buildCaseInsensitivePricingMap(amrodPrices) : null
    
    // 3. Analyze only Amrod products
    const analysis = analyzeAmrodProducts(amrodProducts, amrodData)
    
    // 4. Enhanced Recommendations
    console.log(`\n💡 AMROD-SPECIFIC RECOMMENDATIONS:`)
    console.log('=' * 50)
    
    if (analysis.stats.zeroPrice > 0) {
      console.log(`\n🚨 CRITICAL: ${analysis.stats.zeroPrice} AMROD PRODUCTS WITH ZERO PRICES`)
      
      if (amrodData) {
        const fixableZeroPrice = analysis.allZeroPriceProducts.filter(p => {
          const lowerSKU = p.sku.toLowerCase()
          return amrodData.originalCaseMap.has(p.sku) || amrodData.pricingMap.has(lowerSKU)
        })
        
        console.log(`   • Immediately fixable: ${fixableZeroPrice.length} products`)
        console.log(`   • Need investigation: ${analysis.stats.zeroPrice - fixableZeroPrice.length} products`)
        
        if (fixableZeroPrice.length > 0) {
          console.log(`   🚀 RUN: fixAmrodZeroPrices.js to fix these immediately`)
        }
      }
    } else {
      console.log(`\n✅ EXCELLENT: All Amrod products have prices set`)
    }
    
    if (analysis.stats.caseMismatchedSKUs > 0) {
      console.log(`\n🔄 SKU CASE ISSUES:`)
      console.log(`   • ${analysis.stats.caseMismatchedSKUs} Amrod SKUs have case mismatches`)
      console.log(`   • These could sync properly if case is standardized`)
      console.log(`   🚀 RUN: fixAmrodSKUCase.js to standardize case formatting`)
    }
    
    if (amrodData) {
      const totalMatchable = analysis.exactMatches + analysis.caseInsensitiveMatches
      const matchRate = ((totalMatchable / analysis.stats.validSKU) * 100).toFixed(1)
      
      console.log(`\n📊 AMROD SYNC CAPABILITY:`)
      console.log(`   • Total Amrod SKUs that can sync: ${totalMatchable} (${matchRate}%)`)
      console.log(`   • Ready for immediate sync: ${analysis.exactMatches}`)
      console.log(`   • Need case correction first: ${analysis.caseInsensitiveMatches}`)
      console.log(`   • Cannot sync (missing from API): ${analysis.stats.validSKU - totalMatchable}`)
      
      if (matchRate < 90) {
        console.log(`   ⚠️  Match rate is below 90% - investigate unmatched SKUs`)
      }
    }
    
    console.log(`\n🎯 IMMEDIATE ACTION PLAN FOR AMROD PRODUCTS:`)
    if (analysis.stats.zeroPrice > 0) {
      console.log(`   1. 🚨 FIX ${analysis.stats.zeroPrice} zero-price Amrod products IMMEDIATELY`)
    }
    if (analysis.stats.caseMismatchedSKUs > 0) {
      console.log(`   2. 🔄 Standardize ${analysis.stats.caseMismatchedSKUs} SKU case formats`)
    }
    console.log(`   3. 💰 Run comprehensive price sync for all matched Amrod products`)
    console.log(`   4. 🔍 Investigate unmatched Amrod SKUs`)
    
    console.log(`\n✅ AMROD-ONLY DIAGNOSTIC COMPLETE!`)
    console.log(`   📊 Analyzed ${analysis.stats.totalVariants} Amrod variants across ${analysis.stats.totalProducts} Amrod products`)
    console.log(`   ⚠️  Found ${analysis.allZeroPriceProducts.length} Amrod products with zero prices`)
    console.log(`   🔗 ${amrodData ? analysis.exactMatches + analysis.caseInsensitiveMatches : 0} Amrod products can sync with API`)
    console.log(`   🎯 Focus: Pure Amrod data, no interference from other vendors`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()