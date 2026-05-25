import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
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

// --- FETCH AMROD DATA ---
async function fetchAmrodData(token) {
  try {
    console.log('🔍 Fetching Amrod data...')
    const res = await axios.get('https://vendorapi.amrod.co.za/api/v1/Prices/', {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })
    
    console.log(`✅ Successfully fetched ${res.data.length} Amrod price records`)
    return res.data
  } catch (err) {
    console.error('❌ Failed to fetch Amrod data:', err.response?.status, err.response?.statusText)
    process.exit(1)
  }
}

// --- GET ALL SHOPIFY PRODUCTS ---
async function getAllShopifyProducts() {
  console.log('\n📦 Fetching ALL Shopify products...')
  
  let allProducts = []
  let lastId = null
  let batchCount = 0
  
  while (true) {
    batchCount++
    const params = { limit: 50 }
    if (lastId) params.since_id = lastId
    
    if (batchCount % 10 === 0) {
      console.log(`   📦 Fetched ${allProducts.length} products so far...`)
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
  
  console.log(`✅ Retrieved ${allProducts.length} total products`)
  return allProducts
}

// --- EXTRACT SHOPIFY SKUS ---
function extractShopifySKUs(products) {
  console.log('\n📋 Extracting Shopify SKUs...')
  
  let shopifySKUs = []
  
  for (const product of products) {
    for (const variant of product.variants) {
      const sku = (variant.sku || '').trim()
      if (sku) {
        shopifySKUs.push({
          sku: sku,
          productTitle: product.title,
          productId: product.id,
          variantId: variant.id,
          price: variant.price
        })
      }
    }
  }
  
  console.log(`✅ Found ${shopifySKUs.length} SKUs in Shopify`)
  return shopifySKUs
}

// --- EXTRACT AMROD SKUS ---
function extractAmrodSKUs(priceData) {
  console.log('\n📋 Extracting Amrod SKUs...')
  
  let amrodSKUs = new Set()
  let amrodData = new Map()
  
  for (const record of priceData) {
    const fullCode = record.fullCode || record.sku || record.code
    const simpleCode = record.simplecode || record.simpleCode
    const cost = record.cost || record.price || record.unitPrice
    
    if (fullCode) {
      amrodSKUs.add(fullCode)
      amrodData.set(fullCode, { cost, simpleCode, record })
    }
    if (simpleCode && simpleCode !== fullCode) {
      amrodSKUs.add(simpleCode)
      amrodData.set(simpleCode, { cost, simpleCode, record })
    }
  }
  
  console.log(`✅ Found ${amrodSKUs.size} unique SKUs in Amrod`)
  return { amrodSKUs, amrodData }
}

// --- COMPARE SKUS ---
function compareSKUs(shopifySKUs, amrodSKUs, amrodData) {
  console.log('\n🔍 Comparing SKUs...')
  
  let exactMatches = []
  let caseOnlyDifferences = []
  let noMatches = []
  let potentialMatches = []
  
  for (const shopifyItem of shopifySKUs) {
    const shopifySKU = shopifyItem.sku
    const shopifySKULower = shopifySKU.toLowerCase()
    
    // Check for exact match
    if (amrodSKUs.has(shopifySKU)) {
      exactMatches.push({
        ...shopifyItem,
        amrodSKU: shopifySKU,
        matchType: 'EXACT',
        amrodData: amrodData.get(shopifySKU)
      })
      continue
    }
    
    // Check for case-only differences
    let caseMatch = null
    for (const amrodSKU of amrodSKUs) {
      if (amrodSKU.toLowerCase() === shopifySKULower && amrodSKU !== shopifySKU) {
        caseMatch = amrodSKU
        break
      }
    }
    
    if (caseMatch) {
      caseOnlyDifferences.push({
        ...shopifyItem,
        amrodSKU: caseMatch,
        matchType: 'CASE_DIFFERENT',
        amrodData: amrodData.get(caseMatch)
      })
      continue
    }
    
    // Check for potential matches (similar structure)
    let potentialMatch = null
    const shopifyParts = shopifySKU.toLowerCase().split('-')
    
    for (const amrodSKU of amrodSKUs) {
      const amrodParts = amrodSKU.toLowerCase().split('-')
      
      // Check if first 2-3 parts match
      if (shopifyParts.length >= 2 && amrodParts.length >= 2) {
        const shopifyPrefix = shopifyParts.slice(0, 3).join('-')
        const amrodPrefix = amrodParts.slice(0, 3).join('-')
        
        if (shopifyPrefix === amrodPrefix && shopifySKU.toLowerCase() !== amrodSKU.toLowerCase()) {
          potentialMatch = amrodSKU
          break
        }
      }
    }
    
    if (potentialMatch) {
      potentialMatches.push({
        ...shopifyItem,
        amrodSKU: potentialMatch,
        matchType: 'POTENTIAL',
        amrodData: amrodData.get(potentialMatch)
      })
    } else {
      noMatches.push({
        ...shopifyItem,
        matchType: 'NO_MATCH'
      })
    }
  }
  
  return {
    exactMatches,
    caseOnlyDifferences,
    potentialMatches,
    noMatches
  }
}

// --- ANALYZE DIFFERENCES ---
function analyzeDifferences(comparison) {
  console.log('\n📊 ANALYSIS RESULTS:')
  console.log('=' * 60)
  
  const total = comparison.exactMatches.length + 
                comparison.caseOnlyDifferences.length + 
                comparison.potentialMatches.length + 
                comparison.noMatches.length
  
  console.log(`📊 OVERALL STATISTICS:`)
  console.log(`   Total Shopify SKUs analyzed: ${total}`)
  console.log(`   ✅ Exact matches: ${comparison.exactMatches.length} (${((comparison.exactMatches.length / total) * 100).toFixed(1)}%)`)
  console.log(`   🔤 Case differences only: ${comparison.caseOnlyDifferences.length} (${((comparison.caseOnlyDifferences.length / total) * 100).toFixed(1)}%)`)
  console.log(`   🔍 Potential matches: ${comparison.potentialMatches.length} (${((comparison.potentialMatches.length / total) * 100).toFixed(1)}%)`)
  console.log(`   ❌ No matches: ${comparison.noMatches.length} (${((comparison.noMatches.length / total) * 100).toFixed(1)}%)`)
  
  if (comparison.caseOnlyDifferences.length > 0) {
    console.log(`\n🔤 CASE DIFFERENCES (first 10):`)
    comparison.caseOnlyDifferences.slice(0, 10).forEach(item => {
      console.log(`   Shopify: "${item.sku}" → Amrod: "${item.amrodSKU}"`)
      console.log(`      Product: ${item.productTitle}`)
    })
    if (comparison.caseOnlyDifferences.length > 10) {
      console.log(`   ... and ${comparison.caseOnlyDifferences.length - 10} more`)
    }
  }
  
  if (comparison.potentialMatches.length > 0) {
    console.log(`\n🔍 POTENTIAL MATCHES (first 10):`)
    comparison.potentialMatches.slice(0, 10).forEach(item => {
      console.log(`   Shopify: "${item.sku}" → Amrod: "${item.amrodSKU}"`)
      console.log(`      Product: ${item.productTitle}`)
    })
    if (comparison.potentialMatches.length > 10) {
      console.log(`   ... and ${comparison.potentialMatches.length - 10} more`)
    }
  }
  
  if (comparison.noMatches.length > 0) {
    console.log(`\n❌ NO MATCHES (first 10):`)
    comparison.noMatches.slice(0, 10).forEach(item => {
      console.log(`   "${item.sku}" - ${item.productTitle}`)
    })
    if (comparison.noMatches.length > 10) {
      console.log(`   ... and ${comparison.noMatches.length - 10} more`)
    }
  }
  
  return comparison
}

// --- GENERATE RECOMMENDATIONS ---
function generateRecommendations(comparison) {
  console.log(`\n💡 RECOMMENDATIONS:`)
  console.log('=' * 40)
  
  const total = comparison.exactMatches.length + 
                comparison.caseOnlyDifferences.length + 
                comparison.potentialMatches.length + 
                comparison.noMatches.length
  
  const needsUpdate = comparison.caseOnlyDifferences.length + comparison.potentialMatches.length
  const updatePercentage = (needsUpdate / total) * 100
  
  if (updatePercentage < 10) {
    console.log(`✅ LOW IMPACT: Only ${needsUpdate} SKUs (${updatePercentage.toFixed(1)}%) need updates`)
    console.log(`   Recommendation: UPDATE SKUs to match Amrod exactly`)
    console.log(`   Benefit: Perfect sync with minimal disruption`)
  } else if (updatePercentage < 30) {
    console.log(`⚠️  MEDIUM IMPACT: ${needsUpdate} SKUs (${updatePercentage.toFixed(1)}%) need updates`)
    console.log(`   Recommendation: Consider updating, but test thoroughly`)
    console.log(`   Alternative: Improve matching logic instead`)
  } else {
    console.log(`🚨 HIGH IMPACT: ${needsUpdate} SKUs (${updatePercentage.toFixed(1)}%) need updates`)
    console.log(`   Recommendation: Keep current SKUs, improve matching logic`)
    console.log(`   Reason: Too many changes could disrupt existing systems`)
  }
  
  console.log(`\n🛠️  NEXT STEPS:`)
  if (comparison.caseOnlyDifferences.length > 0) {
    console.log(`   1. Fix ${comparison.caseOnlyDifferences.length} case differences (low risk)`)
  }
  if (comparison.potentialMatches.length > 0) {
    console.log(`   2. Investigate ${comparison.potentialMatches.length} potential matches manually`)
  }
  if (comparison.noMatches.length > 0) {
    console.log(`   3. Review ${comparison.noMatches.length} unmatched SKUs (might not be Amrod products)`)
  }
  
  console.log(`\n📋 IMPLEMENTATION OPTIONS:`)
  console.log(`   Option A: Update all SKUs to match Amrod (${needsUpdate} changes)`)
  console.log(`   Option B: Keep current SKUs, use advanced matching logic`)
  console.log(`   Option C: Hybrid - fix case differences only (${comparison.caseOnlyDifferences.length} changes)`)
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🚀 SKU COMPARISON ANALYSIS`)
  console.log(`Comparing Shopify SKUs with Amrod SKUs`)
  console.log('=' * 60)
  
  try {
    // 1. Get data from both systems
    const token = await getAmrodToken()
    const amrodPriceData = await fetchAmrodData(token)
    const shopifyProducts = await getAllShopifyProducts()
    
    // 2. Extract SKUs
    const shopifySKUs = extractShopifySKUs(shopifyProducts)
    const { amrodSKUs, amrodData } = extractAmrodSKUs(amrodPriceData)
    
    // 3. Compare SKUs
    const comparison = compareSKUs(shopifySKUs, amrodSKUs, amrodData)
    
    // 4. Analyze and show results
    analyzeDifferences(comparison)
    
    // 5. Generate recommendations
    generateRecommendations(comparison)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()