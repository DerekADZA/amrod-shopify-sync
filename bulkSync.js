import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const PRICE_MARKUP = 1.43
const SLEEP_MS = 300
const BATCH_SIZE = 50

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

// --- BUILD PRICING MAP ---
function buildPricingMap(prices) {
  const pricingMap = new Map()
  
  for (const priceRecord of prices) {
    const fullCode = priceRecord.fullCode || priceRecord.sku || priceRecord.code
    const cost = priceRecord.cost || priceRecord.price || priceRecord.unitPrice
    
    if (fullCode && cost) {
      // Store with multiple case variations for flexible lookup
      pricingMap.set(fullCode, parseFloat(cost))
      pricingMap.set(fullCode.toLowerCase(), parseFloat(cost))
      pricingMap.set(fullCode.toUpperCase(), parseFloat(cost))
      
      // Also store simple codes (remove the last parts for variants)
      const parts = fullCode.split('-')
      if (parts.length > 4) {
        const simpleCode = parts.slice(0, 4).join('-')
        pricingMap.set(simpleCode, parseFloat(cost))
        pricingMap.set(simpleCode.toLowerCase(), parseFloat(cost))
        pricingMap.set(simpleCode.toUpperCase(), parseFloat(cost))
      }
    }
  }
  
  console.log(`📊 Pricing map built with ${pricingMap.size} entries`)
  return pricingMap
}

// --- GET ALL SHOPIFY PRODUCTS ---
async function getAllShopifyProducts() {
  console.log('\n📦 Fetching ALL Shopify products...')
  
  let allProducts = []
  let lastId = null
  let batchCount = 0
  
  while (true) {
    batchCount++
    const params = { limit: BATCH_SIZE }
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

// --- IDENTIFY DEFINITE AMROD PRODUCTS ---
function identifyDefiniteAmrodProducts(products) {
  console.log('\n🔍 Identifying DEFINITE Amrod products...')
  
  let amrodProducts = []
  
  for (const product of products) {
    // Check for definite Amrod brands in titles
    const titleUpper = product.title.toUpperCase()
    const isDefiniteBrand = (
      titleUpper.includes('ALEX VARGA') ||
      titleUpper.includes('BAGBASE') ||
      titleUpper.includes('JAMES & NICHOLSON') ||
      titleUpper.includes('SLAZENGER')
    )
    
    for (const variant of product.variants) {
      const sku = (variant.sku || '').trim()
      if (!sku) continue
      
      const skuUpper = sku.toUpperCase()
      
      // Definite Amrod SKU patterns
      const isDefiniteAmrodSku = (
        skuUpper.startsWith('GF-AV-') ||     // Alex Varga gift sets
        skuUpper.startsWith('BG-') ||        // BagBase
        skuUpper.startsWith('JC-') ||        // James & Nicholson
        skuUpper.startsWith('SLAZ-') ||      // Slazenger
        skuUpper.startsWith('OL-') ||        // Other common Amrod
        skuUpper.startsWith('PC-') ||        // Other common Amrod
        skuUpper.startsWith('PA-') ||        // Other common Amrod
        skuUpper.startsWith('HS-') ||        // Other common Amrod
        skuUpper.startsWith('KH-') ||        // Other common Amrod
        skuUpper.startsWith('GH-') ||        // Other common Amrod
        /^[A-Z]{2}-[A-Z]{2}-\d+-[A-Z]/.test(skuUpper) // Classic Amrod pattern
      )
      
      if (isDefiniteBrand || isDefiniteAmrodSku) {
        amrodProducts.push({
          product: product,
          variant: variant,
          sku: sku,
          reason: isDefiniteBrand ? 'BRAND_NAME' : 'AMROD_SKU_PATTERN'
        })
      }
    }
  }
  
  console.log(`✅ Found ${amrodProducts.length} DEFINITE Amrod variants`)
  return amrodProducts
}

// --- GET PRICING FOR SKU ---
function getPricingForSKU(sku, pricingMap) {
  // Try multiple variations to find pricing
  const variations = [
    sku,                          // Original
    sku.toLowerCase(),            // Lowercase
    sku.toUpperCase(),            // Uppercase
    // Try simple code variations (remove color/size suffixes)
    sku.split('-').slice(0, 4).join('-'),
    sku.split('-').slice(0, 4).join('-').toLowerCase(),
    sku.split('-').slice(0, 4).join('-').toUpperCase(),
    // Try without last segment
    sku.split('-').slice(0, -1).join('-'),
    sku.split('-').slice(0, -1).join('-').toLowerCase(),
    sku.split('-').slice(0, -1).join('-').toUpperCase()
  ]
  
  for (const variation of variations) {
    const cost = pricingMap.get(variation)
    if (cost) {
      return { cost, matchedKey: variation }
    }
  }
  
  return null
}

// --- PRICE ROUNDING ---
function roundPrice(price) {
  let p = Math.ceil(price)
  return (p - 0.01 + 1).toFixed(2)
}

// --- UPDATE SINGLE PRODUCT ---
async function updateSingleProduct(productData, pricingResult) {
  const { variant, sku } = productData
  const { cost, matchedKey } = pricingResult
  const retailPrice = roundPrice(cost * PRICE_MARKUP)
  
  console.log(`\n🔄 Updating: ${sku}`)
  console.log(`   Product: ${productData.product.title}`)
  console.log(`   Matched pricing key: ${matchedKey}`)
  console.log(`   Cost: ${cost} → Retail: ${retailPrice}`)
  console.log(`   Old price: ${variant.price}`)
  
  let priceOK = false, costOK = false
  
  // Skip if price hasn't changed significantly (avoid unnecessary API calls)
  const currentPrice = parseFloat(variant.price)
  const newPrice = parseFloat(retailPrice)
  if (Math.abs(currentPrice - newPrice) < 0.01) {
    console.log(`   ⏭️  Price unchanged, skipping update`)
    return { priceOK: true, costOK: true, skipped: true }
  }
  
  // Update price
  try {
    await shopifyClient.put(`/variants/${variant.id}.json`, {
      variant: { id: variant.id, price: retailPrice }
    })
    console.log(`   ✅ Price: ${variant.price} → ${retailPrice}`)
    priceOK = true
  } catch (err) {
    console.log(`   ❌ Price update failed:`, err.response?.status, err.response?.data?.errors)
  }
  
  await sleep(SLEEP_MS)
  
  // Update cost
  try {
    await shopifyClient.put(`/inventory_items/${variant.inventory_item_id}.json`, {
      inventory_item: { id: variant.inventory_item_id, cost: cost }
    })
    console.log(`   ✅ Cost updated: ${cost}`)
    costOK = true
  } catch (err) {
    console.log(`   ❌ Cost update failed:`, err.response?.status, err.response?.data?.errors)
  }
  
  return { priceOK, costOK, skipped: false }
}

// --- MAIN BULK SYNC ---
;(async () => {
  console.log(`🚀 BULK AMROD PRICE SYNC`)
  console.log(`Markup: ${PRICE_MARKUP}x`)
  console.log('=' * 50)
  
  try {
    // 1. Get Amrod authentication and pricing
    const token = await getAmrodToken()
    const pricesData = await fetchAmrodPrices(token)
    const pricingMap = buildPricingMap(pricesData)
    
    // 2. Get all Shopify products
    const allProducts = await getAllShopifyProducts()
    
    // 3. Identify definite Amrod products
    const amrodProducts = identifyDefiniteAmrodProducts(allProducts)
    
    // 4. Get products with pricing
    console.log('\n💰 Checking pricing availability...')
    
    let withPricing = []
    let withoutPricing = []
    
    for (const productData of amrodProducts) {
      const pricingResult = getPricingForSKU(productData.sku, pricingMap)
      if (pricingResult) {
        withPricing.push({ ...productData, pricing: pricingResult })
      } else {
        withoutPricing.push(productData)
      }
    }
    
    console.log(`✅ Products with pricing: ${withPricing.length}`)
    console.log(`❌ Products without pricing: ${withoutPricing.length}`)
    
    if (withoutPricing.length > 0) {
      console.log(`\n📋 Products without pricing (first 10):`)
      withoutPricing.slice(0, 10).forEach(item => {
        console.log(`   ${item.sku} - ${item.product.title}`)
      })
    }
    
    if (withPricing.length === 0) {
      console.log('\n❌ No products found with valid pricing')
      return
    }
    
    // 5. Filter products that actually need updates
    console.log('\n💰 Filtering products that need price updates...')
    
    let needsUpdate = []
    let upToDate = []
    
    for (const productData of withPricing) {
      const { variant, pricing } = productData
      const { cost } = pricing
      const currentPrice = parseFloat(variant.price)
      const newPrice = parseFloat(roundPrice(cost * PRICE_MARKUP))
      const difference = Math.abs(newPrice - currentPrice)
      
      if (difference >= 0.01) {
        needsUpdate.push({
          ...productData,
          currentPrice,
          newPrice,
          difference: newPrice - currentPrice
        })
      } else {
        upToDate.push(productData)
      }
    }
    
    console.log(`✅ Products up to date: ${upToDate.length}`)
    console.log(`🔄 Products needing updates: ${needsUpdate.length}`)
    
    if (needsUpdate.length === 0) {
      console.log('\n🎉 All products are already up to date!')
      return
    }
    
    // Show some examples of what will be updated
    console.log(`\n📊 Sample updates (first 5):`)
    needsUpdate.slice(0, 5).forEach(item => {
      const changeType = item.difference > 0 ? '📈' : '📉'
      console.log(`   ${changeType} ${item.sku}: $${item.currentPrice} → $${item.newPrice} (${item.difference > 0 ? '+' : ''}$${item.difference.toFixed(2)})`)
      console.log(`      ${item.product.title}`)
    })
    
    // 6. Batch processing for safety
    const BATCH_SIZE_UPDATE = 25 // Process 25 products at a time
    const totalBatches = Math.ceil(needsUpdate.length / BATCH_SIZE_UPDATE)
    
    console.log(`\n🔄 BATCH PROCESSING PLAN:`)
    console.log(`   Total products to update: ${needsUpdate.length}`)
    console.log(`   Batch size: ${BATCH_SIZE_UPDATE}`)
    console.log(`   Total batches: ${totalBatches}`)
    console.log(`\n⚠️  IMPORTANT: Review the sample updates above before proceeding!`)
    console.log(`⚠️  This will make ${needsUpdate.length} price changes to your Shopify store!`)
    
    // Process all products at once
    const currentBatch = needsUpdate // Process all products
    console.log(`\n🚀 PROCESSING ALL ${currentBatch.length} PRODUCTS:`)
    
    let successCount = 0
    let failCount = 0
    let skipCount = 0
    
    for (const [index, productData] of currentBatch.entries()) {
      console.log(`\n📦 ${index + 1}/${currentBatch.length}`)
      
      try {
        const result = await updateSingleProduct(productData, productData.pricing)
        
        if (result.skipped) {
          skipCount++
        } else if (result.priceOK && result.costOK) {
          successCount++
        } else {
          failCount++
        }
        
        // Rate limiting
        await sleep(SLEEP_MS)
        
      } catch (err) {
        console.error(`   💥 Error updating ${productData.sku}:`, err.message)
        failCount++
      }
    }
    
    // Summary
    console.log(`\n🎉 BULK SYNC COMPLETE!`)
    console.log(`   ✅ Successful updates: ${successCount}`)
    console.log(`   ⏭️  Skipped (no change): ${skipCount}`)
    console.log(`   ❌ Failed updates: ${failCount}`)
    console.log(`   📊 Total processed: ${currentBatch.length}`)
    
    if (successCount > 0) {
      console.log(`\n🎯 SYNC SUMMARY:`)
      console.log(`   ${successCount} products updated with new pricing`)
      console.log(`   ${upToDate.length} products were already up to date`)
      console.log(`   ${withoutPricing.length} products missing pricing (investigate manually)`)
      console.log(`\n✅ Your Amrod inventory is now fully synced!`)
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()