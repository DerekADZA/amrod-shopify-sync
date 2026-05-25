import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'

// Target product to investigate
const TARGET_SKU = 'gf-am-916-b-s-0'

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

// --- FETCH ALL AMROD DATA ---
async function fetchAllAmrodData(token) {
  console.log('\n📊 Fetching ALL Amrod data...')
  
  try {
    // Fetch pricing data
    console.log('🔍 Fetching pricing data...')
    const priceRes = await axios.get('https://vendorapi.amrod.co.za/api/v1/Prices/', {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })
    
    console.log(`✅ Fetched ${priceRes.data.length} price records`)
    
    // Try to fetch product data if available
    let productData = null
    try {
      console.log('🔍 Attempting to fetch product data...')
      const productRes = await axios.get('https://vendorapi.amrod.co.za/api/v1/Products/', {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      })
      productData = productRes.data
      console.log(`✅ Fetched ${productData.length} product records`)
    } catch (err) {
      console.log('⚠️  Product data endpoint not available or accessible')
    }
    
    // Try to fetch inventory data if available
    let inventoryData = null
    try {
      console.log('🔍 Attempting to fetch inventory data...')
      const invRes = await axios.get('https://vendorapi.amrod.co.za/api/v1/Inventory/', {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      })
      inventoryData = invRes.data
      console.log(`✅ Fetched ${inventoryData.length} inventory records`)
    } catch (err) {
      console.log('⚠️  Inventory data endpoint not available or accessible')
    }
    
    return {
      prices: priceRes.data,
      products: productData,
      inventory: inventoryData
    }
    
  } catch (err) {
    console.error('❌ Failed to fetch Amrod data:', err.response?.status, err.response?.statusText)
    if (err.response?.data) {
      console.error('Response data:', err.response.data)
    }
    process.exit(1)
  }
}

// --- ANALYZE TARGET PRODUCT ---
function analyzeTargetProduct(targetSku, amrodData) {
  console.log(`\n🔍 ANALYZING TARGET PRODUCT: ${targetSku}`)
  console.log('=' * 60)
  
  const { prices, products, inventory } = amrodData
  
  // Search in pricing data
  console.log('\n💰 SEARCHING IN PRICING DATA:')
  const pricingMatches = []
  
  prices.forEach(priceRecord => {
    const fullCode = priceRecord.fullCode || priceRecord.sku || priceRecord.code
    if (!fullCode) return
    
    const fullCodeLower = fullCode.toLowerCase()
    const targetLower = targetSku.toLowerCase()
    
    // Different types of matches
    if (fullCodeLower === targetLower) {
      pricingMatches.push({ ...priceRecord, matchType: 'EXACT' })
    } else if (fullCodeLower.includes('am-916') || fullCodeLower.includes('gf-am-916')) {
      pricingMatches.push({ ...priceRecord, matchType: 'RELATED' })
    } else if (fullCodeLower.includes('916')) {
      pricingMatches.push({ ...priceRecord, matchType: 'CONTAINS_916' })
    }
  })
  
  console.log(`Found ${pricingMatches.length} pricing matches:`)
  
  // Show exact matches first
  const exactMatches = pricingMatches.filter(m => m.matchType === 'EXACT')
  if (exactMatches.length > 0) {
    console.log(`\n✅ EXACT PRICING MATCHES (${exactMatches.length}):`)
    exactMatches.forEach(match => {
      console.log(`   SKU: ${match.fullCode || match.sku || match.code}`)
      console.log(`   Cost: R${match.cost || match.price || match.unitPrice}`)
      console.log(`   Record:`, JSON.stringify(match, null, 2))
      console.log('   ---')
    })
  }
  
  // Show related matches
  const relatedMatches = pricingMatches.filter(m => m.matchType === 'RELATED')
  if (relatedMatches.length > 0) {
    console.log(`\n🔍 RELATED PRICING MATCHES (${relatedMatches.length}):`)
    relatedMatches.slice(0, 10).forEach(match => {
      console.log(`   SKU: ${match.fullCode || match.sku || match.code}`)
      console.log(`   Cost: R${match.cost || match.price || match.unitPrice}`)
    })
    if (relatedMatches.length > 10) {
      console.log(`   ... and ${relatedMatches.length - 10} more`)
    }
  }
  
  // Show 916 matches (limited)
  const contains916 = pricingMatches.filter(m => m.matchType === 'CONTAINS_916')
  if (contains916.length > 0) {
    console.log(`\n🔍 PRODUCTS CONTAINING "916" (first 10 of ${contains916.length}):`)
    contains916.slice(0, 10).forEach(match => {
      console.log(`   SKU: ${match.fullCode || match.sku || match.code} - R${match.cost || match.price || match.unitPrice}`)
    })
  }
  
  // Search in product data if available
  if (products && products.length > 0) {
    console.log('\n📦 SEARCHING IN PRODUCT DATA:')
    const productMatches = products.filter(product => {
      const code = (product.code || product.sku || product.fullCode || '').toLowerCase()
      const name = (product.name || product.title || product.description || '').toLowerCase()
      const targetLower = targetSku.toLowerCase()
      
      return code.includes(targetLower) || 
             code.includes('am-916') || 
             code.includes('gf-am-916') ||
             name.includes('916')
    })
    
    console.log(`Found ${productMatches.length} product matches:`)
    productMatches.slice(0, 5).forEach(product => {
      console.log(`   Code: ${product.code || product.sku || 'N/A'}`)
      console.log(`   Name: ${product.name || product.title || 'N/A'}`)
      console.log(`   Record:`, JSON.stringify(product, null, 2))
      console.log('   ---')
    })
  }
  
  // Search in inventory data if available
  if (inventory && inventory.length > 0) {
    console.log('\n📦 SEARCHING IN INVENTORY DATA:')
    const inventoryMatches = inventory.filter(item => {
      const code = (item.code || item.sku || item.fullCode || '').toLowerCase()
      const targetLower = targetSku.toLowerCase()
      
      return code.includes(targetLower) || 
             code.includes('am-916') || 
             code.includes('gf-am-916')
    })
    
    console.log(`Found ${inventoryMatches.length} inventory matches:`)
    inventoryMatches.slice(0, 5).forEach(item => {
      console.log(`   Code: ${item.code || item.sku || 'N/A'}`)
      console.log(`   Quantity: ${item.quantity || item.stock || 'N/A'}`)
      console.log(`   Record:`, JSON.stringify(item, null, 2))
      console.log('   ---')
    })
  }
  
  return {
    pricingMatches,
    productMatches: products ? products.filter(p => 
      (p.code || '').toLowerCase().includes('916') ||
      (p.name || '').toLowerCase().includes('916')
    ) : [],
    inventoryMatches: inventory ? inventory.filter(i => 
      (i.code || '').toLowerCase().includes('916')
    ) : []
  }
}

// --- EXPLORE AMROD API STRUCTURE ---
async function exploreAmrodAPI(token) {
  console.log('\n🔍 EXPLORING AMROD API STRUCTURE:')
  
  const endpoints = [
    '/api/v1/Prices/',
    '/api/v1/Products/',
    '/api/v1/Inventory/',
    '/api/v1/Categories/',
    '/api/v1/Brands/',
    '/api/v1/Stock/',
    '/api/v1/'
  ]
  
  for (const endpoint of endpoints) {
    try {
      console.log(`\n📡 Testing endpoint: ${endpoint}`)
      const res = await axios.get(`https://vendorapi.amrod.co.za${endpoint}`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      })
      
      if (Array.isArray(res.data)) {
        console.log(`   ✅ Success: Found ${res.data.length} records`)
        if (res.data.length > 0) {
          console.log(`   📋 Sample record structure:`)
          console.log(`   `, Object.keys(res.data[0]))
        }
      } else if (typeof res.data === 'object') {
        console.log(`   ✅ Success: Object response`)
        console.log(`   📋 Response keys:`, Object.keys(res.data))
      } else {
        console.log(`   ✅ Success: ${typeof res.data} response`)
      }
      
    } catch (err) {
      console.log(`   ❌ Failed: ${err.response?.status || err.message}`)
    }
  }
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🚀 AMROD PRODUCT DATA PULL`)
  console.log(`Target: ${TARGET_SKU}`)
  console.log('=' * 50)
  
  try {
    // 1. Authenticate with Amrod
    const token = await getAmrodToken()
    
    // 2. Explore API structure
    await exploreAmrodAPI(token)
    
    // 3. Fetch all available data
    const amrodData = await fetchAllAmrodData(token)
    
    // 4. Analyze target product
    const analysis = analyzeTargetProduct(TARGET_SKU, amrodData)
    
    // 5. Summary
    console.log(`\n📊 ANALYSIS SUMMARY:`)
    console.log(`   Exact pricing matches: ${analysis.pricingMatches.filter(m => m.matchType === 'EXACT').length}`)
    console.log(`   Related pricing matches: ${analysis.pricingMatches.filter(m => m.matchType === 'RELATED').length}`)
    console.log(`   Contains "916" matches: ${analysis.pricingMatches.filter(m => m.matchType === 'CONTAINS_916').length}`)
    console.log(`   Product data matches: ${analysis.productMatches.length}`)
    console.log(`   Inventory matches: ${analysis.inventoryMatches.length}`)
    
    if (analysis.pricingMatches.length === 0) {
      console.log(`\n❌ No matches found for ${TARGET_SKU}`)
      console.log(`💡 Possible reasons:`)
      console.log(`   1. Product doesn't exist in Amrod catalog`)
      console.log(`   2. SKU format is different`)
      console.log(`   3. Product is discontinued`)
      console.log(`   4. SKU has been updated in Amrod`)
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()