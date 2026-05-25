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

// --- BUILD AMROD SKU MAP ---
function buildAmrodSKUMap(priceData) {
  console.log('\n📋 Building Amrod SKU map...')
  
  let amrodSKUMap = new Map() // Maps lowercase to correct case
  
  for (const record of priceData) {
    const fullCode = record.fullCode || record.sku || record.code
    const simpleCode = record.simplecode || record.simpleCode
    
    if (fullCode) {
      amrodSKUMap.set(fullCode.toLowerCase(), fullCode)
    }
    if (simpleCode && simpleCode !== fullCode) {
      amrodSKUMap.set(simpleCode.toLowerCase(), simpleCode)
    }
  }
  
  console.log(`✅ Built map with ${amrodSKUMap.size} Amrod SKUs`)
  return amrodSKUMap
}

// --- FIND REMAINING CASE ISSUES ---
function findRemainingCaseIssues(products, amrodSKUMap) {
  console.log('\n🔍 Finding SKUs that still need case correction...')
  
  let stillNeedUpdates = []
  
  for (const product of products) {
    for (const variant of product.variants) {
      const currentSKU = (variant.sku || '').trim()
      if (!currentSKU) continue
      
      // Check if Amrod has this SKU with different case
      const correctSKU = amrodSKUMap.get(currentSKU.toLowerCase())
      
      if (correctSKU && correctSKU !== currentSKU) {
        stillNeedUpdates.push({
          product: product,
          variant: variant,
          currentSKU: currentSKU,
          correctSKU: correctSKU,
          productTitle: product.title,
          variantId: variant.id,
          productId: product.id
        })
      }
    }
  }
  
  console.log(`${stillNeedUpdates.length > 0 ? '❌' : '✅'} Found ${stillNeedUpdates.length} SKUs that still need case correction`)
  return stillNeedUpdates
}

// --- ATTEMPT MANUAL UPDATE ---
async function attemptManualUpdate(updateItem) {
  const { variant, currentSKU, correctSKU, productTitle, variantId } = updateItem
  
  console.log(`\n🔧 Attempting manual update:`)
  console.log(`   Product: ${productTitle}`)
  console.log(`   Variant ID: ${variantId}`)
  console.log(`   Current SKU: "${currentSKU}"`)
  console.log(`   Correct SKU: "${correctSKU}"`)
  
  try {
    await shopifyClient.put(`/variants/${variantId}.json`, {
      variant: { 
        id: variantId, 
        sku: correctSKU 
      }
    })
    console.log(`   ✅ Manual update successful!`)
    return { success: true }
  } catch (err) {
    console.log(`   ❌ Manual update failed:`)
    console.log(`      Status: ${err.response?.status}`)
    console.log(`      Error: ${JSON.stringify(err.response?.data?.errors, null, 2)}`)
    return { 
      success: false, 
      error: err.response?.data?.errors,
      status: err.response?.status 
    }
  }
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🔍 FIND FAILED SKUs`)
  console.log(`Identifying the 2 SKUs that failed to update`)
  console.log('=' * 50)
  
  try {
    // 1. Get data from both systems
    const token = await getAmrodToken()
    const amrodData = await fetchAmrodData(token)
    const shopifyProducts = await getAllShopifyProducts()
    
    // 2. Build maps and find remaining issues
    const amrodSKUMap = buildAmrodSKUMap(amrodData)
    const failedSKUs = findRemainingCaseIssues(shopifyProducts, amrodSKUMap)
    
    if (failedSKUs.length === 0) {
      console.log('\n🎉 All SKUs have been successfully updated!')
      console.log('✅ No failed SKUs found - the bulk update was 100% successful!')
      return
    }
    
    console.log(`\n❌ FAILED SKUs IDENTIFIED (${failedSKUs.length}):`)
    console.log('=' * 50)
    
    for (const [index, failedItem] of failedSKUs.entries()) {
      console.log(`\n📦 FAILED SKU ${index + 1}:`)
      console.log(`   Product: ${failedItem.productTitle}`)
      console.log(`   Product ID: ${failedItem.productId}`)
      console.log(`   Variant ID: ${failedItem.variantId}`)
      console.log(`   Current SKU: "${failedItem.currentSKU}"`)
      console.log(`   Should be: "${failedItem.correctSKU}"`)
      console.log(`   Shopify Admin Link: ${process.env.SHOPIFY_STORE_URL}/admin/products/${failedItem.productId}`)
    }
    
    // 3. Attempt to fix them manually
    console.log(`\n🔧 ATTEMPTING MANUAL FIXES:`)
    
    let manualSuccessCount = 0
    let manualFailCount = 0
    
    for (const [index, failedItem] of failedSKUs.entries()) {
      console.log(`\n🔧 Manual fix attempt ${index + 1}/${failedSKUs.length}:`)
      
      const result = await attemptManualUpdate(failedItem)
      
      if (result.success) {
        manualSuccessCount++
      } else {
        manualFailCount++
      }
      
      await sleep(SLEEP_MS)
    }
    
    // 4. Summary
    console.log(`\n📊 MANUAL FIX RESULTS:`)
    console.log(`   ✅ Successfully fixed: ${manualSuccessCount}`)
    console.log(`   ❌ Still failed: ${manualFailCount}`)
    
    if (manualFailCount > 0) {
      console.log(`\n💡 FOR REMAINING FAILURES:`)
      console.log(`   1. Try updating manually in Shopify Admin using the links above`)
      console.log(`   2. Check if the variants are part of a product that has restrictions`)
      console.log(`   3. Verify the variant IDs are still valid`)
      console.log(`   4. Check if there are any inventory or order constraints`)
    }
    
    if (manualSuccessCount === failedSKUs.length) {
      console.log(`\n🎉 ALL ISSUES RESOLVED!`)
      console.log(`✅ 100% of your Amrod SKUs now match exactly!`)
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()