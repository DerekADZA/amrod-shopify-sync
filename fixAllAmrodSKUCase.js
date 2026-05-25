import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const SLEEP_MS = 300
const BATCH_SIZE = 50 // Process in batches to avoid rate limits

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

// --- FETCH AMROD PRICES ---
async function fetchAmrodPrices(token) {
  try {
    console.log('🔍 Fetching Amrod prices...')
    const res = await axios.get('https://vendorapi.amrod.co.za/api/v1/Prices/', {
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

// --- BUILD CASE MAPPING ---
function buildCaseMapping(prices) {
  const originalCaseMap = new Map() // lowercase -> original Amrod case
  
  console.log('📊 Building case mapping from Amrod API...')
  
  for (const priceRecord of prices) {
    const fullCode = priceRecord.fullCode || priceRecord.sku || priceRecord.code
    const simpleCode = priceRecord.simplecode || priceRecord.simpleCode
    
    if (fullCode) {
      originalCaseMap.set(fullCode.toLowerCase(), fullCode)
    }
    if (simpleCode && simpleCode !== fullCode) {
      originalCaseMap.set(simpleCode.toLowerCase(), simpleCode)
    }
  }
  
  console.log(`📊 Case mapping built with ${originalCaseMap.size} entries`)
  return originalCaseMap
}

// --- GET ALL AMROD PRODUCTS ---
async function getAllAmrodProducts() {
  console.log('\n📦 Fetching all Amrod products...')
  
  let allAmrodProducts = []
  let lastId = null
  let batchCount = 0
  
  while (true) {
    batchCount++
    const params = { 
      limit: 50,
      vendor: 'Amrod' // Only Amrod products
    }
    if (lastId) params.since_id = lastId
    
    if (batchCount % 10 === 0) {
      console.log(`   📦 Fetched ${allAmrodProducts.length} Amrod products so far...`)
    }
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      // Only add confirmed Amrod products
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
  
  console.log(`✅ Retrieved ${allAmrodProducts.length} Amrod products`)
  return allAmrodProducts
}

// --- FIND CASE MISMATCHES ---
function findCaseMismatches(products, originalCaseMap) {
  console.log('\n🔍 Analyzing SKU case mismatches...')
  
  let caseMismatches = []
  let correctCases = []
  let notInAmrod = []
  let totalVariants = 0
  
  for (const product of products) {
    for (const variant of product.variants) {
      totalVariants++
      const sku = (variant.sku || '').trim()
      
      if (!sku) continue
      
      const correctCase = originalCaseMap.get(sku.toLowerCase())
      
      if (correctCase) {
        if (sku !== correctCase) {
          caseMismatches.push({
            product,
            variant,
            currentSKU: sku,
            correctSKU: correctCase,
            productTitle: product.title,
            variantTitle: variant.title
          })
        } else {
          correctCases.push({
            product,
            variant,
            sku: sku
          })
        }
      } else {
        notInAmrod.push({
          product,
          variant,
          sku: sku,
          productTitle: product.title
        })
      }
    }
  }
  
  console.log(`✅ Case analysis complete:`)
  console.log(`   Total Amrod variants: ${totalVariants}`)
  console.log(`   Case mismatches: ${caseMismatches.length}`)
  console.log(`   Correct case: ${correctCases.length}`)
  console.log(`   Not in Amrod API: ${notInAmrod.length}`)
  
  return { caseMismatches, correctCases, notInAmrod }
}

// --- FIX SINGLE SKU CASE ---
async function fixSingleSKUCase(mismatch) {
  const { variant, currentSKU, correctSKU, product } = mismatch
  
  try {
    await shopifyClient.put(`/variants/${variant.id}.json`, {
      variant: { 
        id: variant.id, 
        sku: correctSKU 
      }
    })
    
    return { success: true, currentSKU, correctSKU }
  } catch (err) {
    console.error(`   ❌ Failed to update SKU "${currentSKU}" to "${correctSKU}":`, err.response?.status, err.response?.data?.errors)
    return { success: false, currentSKU, correctSKU, error: err.response?.data }
  }
}

// --- PROCESS BATCH ---
async function processBatch(batch, batchIndex, totalBatches) {
  console.log(`\n📦 Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} items)`)
  
  let successCount = 0
  let failCount = 0
  
  for (const [index, mismatch] of batch.entries()) {
    console.log(`   ${index + 1}/${batch.length}: "${mismatch.currentSKU}" → "${mismatch.correctSKU}"`)
    
    const result = await fixSingleSKUCase(mismatch)
    
    if (result.success) {
      successCount++
      console.log(`   ✅ Updated successfully`)
    } else {
      failCount++
      console.log(`   ❌ Failed to update`)
    }
    
    await sleep(SLEEP_MS)
  }
  
  console.log(`   Batch ${batchIndex + 1} complete: ✅ ${successCount} ❌ ${failCount}`)
  return { successCount, failCount }
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🔄 AMROD SKU CASE STANDARDIZER`)
  console.log(`This script will standardize all Amrod SKU cases to match the API`)
  console.log(`Based on diagnostic: ~3,715 SKUs need case correction`)
  console.log('=' * 70)
  
  try {
    // 1. Get Amrod API data for correct case formats
    const token = await getAmrodToken()
    const pricesData = await fetchAmrodPrices(token)
    const originalCaseMap = buildCaseMapping(pricesData)
    
    // 2. Get all Amrod products
    const amrodProducts = await getAllAmrodProducts()
    
    if (amrodProducts.length === 0) {
      console.log('❌ No Amrod products found')
      return
    }
    
    // 3. Find case mismatches
    const { caseMismatches, correctCases, notInAmrod } = findCaseMismatches(amrodProducts, originalCaseMap)
    
    if (caseMismatches.length === 0) {
      console.log('\n🎉 NO CASE MISMATCHES FOUND!')
      console.log(`✅ All ${correctCases.length} Amrod SKUs already have correct case formatting`)
      return
    }
    
    // 4. Show preview of what will be fixed
    console.log(`\n📊 CASE STANDARDIZATION PREVIEW (first 10):`)
    caseMismatches.slice(0, 10).forEach((mismatch, index) => {
      console.log(`   ${index + 1}. "${mismatch.currentSKU}" → "${mismatch.correctSKU}"`)
      console.log(`      ${mismatch.productTitle}`)
    })
    
    if (caseMismatches.length > 10) {
      console.log(`   ... and ${caseMismatches.length - 10} more case mismatches`)
    }
    
    console.log(`\n⚠️  This will standardize ${caseMismatches.length} SKUs to proper case format!`)
    console.log(`   📊 Processing in batches of ${BATCH_SIZE} to avoid rate limits`)
    
    // 5. Process in batches
    const batches = []
    for (let i = 0; i < caseMismatches.length; i += BATCH_SIZE) {
      batches.push(caseMismatches.slice(i, i + BATCH_SIZE))
    }
    
    console.log(`\n🚀 STARTING CASE STANDARDIZATION (${batches.length} batches):`)
    
    let totalSuccess = 0
    let totalFail = 0
    
    for (const [batchIndex, batch] of batches.entries()) {
      const result = await processBatch(batch, batchIndex, batches.length)
      totalSuccess += result.successCount
      totalFail += result.failCount
      
      // Longer pause between batches
      if (batchIndex < batches.length - 1) {
        console.log(`   ⏸️  Pausing between batches...`)
        await sleep(SLEEP_MS * 2)
      }
    }
    
    // 6. Final Summary
    console.log(`\n🎉 CASE STANDARDIZATION COMPLETE!`)
    console.log(`   ✅ Successfully updated: ${totalSuccess} SKUs`)
    console.log(`   ❌ Failed to update: ${totalFail} SKUs`)
    console.log(`   📊 Success rate: ${((totalSuccess / caseMismatches.length) * 100).toFixed(1)}%`)
    
    console.log(`\n📊 FINAL AMROD SKU STATUS:`)
    console.log(`   ✅ Correct case format: ${correctCases.length + totalSuccess}`)
    console.log(`   ❌ Still mismatched: ${totalFail}`)
    console.log(`   ⚠️  Not in Amrod API: ${notInAmrod.length}`)
    
    if (totalSuccess > 0) {
      console.log(`\n✅ ${totalSuccess} Amrod SKUs now have standardized case formatting!`)
      console.log(`🔄 Future price syncs should work much more reliably`)
    }
    
    if (notInAmrod.length > 0) {
      console.log(`\n💡 PRODUCTS NOT IN AMROD API (first 5):`)
      notInAmrod.slice(0, 5).forEach(item => {
        console.log(`   • SKU: "${item.sku}" - ${item.productTitle}`)
      })
      if (notInAmrod.length > 5) {
        console.log(`   ... and ${notInAmrod.length - 5} more`)
      }
      console.log(`   💭 These might be discontinued or from different suppliers`)
    }
    
    console.log(`\n🎯 MISSION ACCOMPLISHED!`)
    console.log(`   🔧 Standardized ${totalSuccess} SKU case formats`)
    console.log(`   💰 Amrod products ready for reliable price syncing`)
    console.log(`   📈 Store data quality significantly improved`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()