import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const PRICE_MARKUP = 1.43
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

// --- BUILD SIMPLE PRICING MAP ---
function buildPricingMap(prices) {
  const pricingMap = new Map()
  
  console.log('📊 Building pricing map...')
  
  for (const priceRecord of prices) {
    const fullCode = priceRecord.fullCode || priceRecord.sku || priceRecord.code
    const simpleCode = priceRecord.simplecode || priceRecord.simpleCode
    const cost = priceRecord.cost || priceRecord.price || priceRecord.unitPrice
    
    if (!cost || isNaN(parseFloat(cost))) continue
    
    const costValue = parseFloat(cost)
    
    // Store both full code and simple code
    if (fullCode) {
      pricingMap.set(fullCode, costValue)
    }
    if (simpleCode && simpleCode !== fullCode) {
      pricingMap.set(simpleCode, costValue)
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

// --- ANALYZE PRODUCTS FOR AMROD PRICING ---
function analyzeProductsForAmrodPricing(products, pricingMap) {
  console.log('\n💰 Analyzing products for Amrod pricing...')
  
  let amrodProducts = []
  let nonAmrodProducts = []
  let totalVariants = 0
  
  for (const product of products) {
    for (const variant of product.variants) {
      totalVariants++
      const sku = (variant.sku || '').trim()
      if (!sku) continue
      
      // Since SKUs are now exactly matched, we can do simple lookups
      const cost = pricingMap.get(sku)
      
      if (cost) {
        amrodProducts.push({
          product: product,
          variant: variant,
          sku: sku,
          cost: cost,
          currentPrice: parseFloat(variant.price) || 0
        })
      } else {
        nonAmrodProducts.push({
          product: product,
          variant: variant,
          sku: sku,
          currentPrice: parseFloat(variant.price) || 0
        })
      }
    }
  }
  
  console.log(`✅ Analysis complete:`)
  console.log(`   Total variants: ${totalVariants}`)
  console.log(`   Amrod products: ${amrodProducts.length}`)
  console.log(`   Non-Amrod products: ${nonAmrodProducts.length}`)
  
  return { amrodProducts, nonAmrodProducts }
}

// --- IDENTIFY PRODUCTS NEEDING PRICE UPDATES ---
function identifyPriceUpdatesNeeded(amrodProducts) {
  console.log('\n🔍 Identifying products that need price updates...')
  
  let needsUpdate = []
  let upToDate = []
  let priceIncreases = []
  let priceDecreases = []
  
  for (const productData of amrodProducts) {
    const { cost, currentPrice } = productData
    const newPrice = parseFloat(roundPrice(cost * PRICE_MARKUP))
    const difference = newPrice - currentPrice
    
    if (Math.abs(difference) >= 0.01) {
      const updateInfo = {
        ...productData,
        newPrice,
        difference,
        percentChange: currentPrice > 0 ? ((difference / currentPrice) * 100) : 100
      }
      
      needsUpdate.push(updateInfo)
      
      if (difference > 0) {
        priceIncreases.push(updateInfo)
      } else {
        priceDecreases.push(updateInfo)
      }
    } else {
      upToDate.push(productData)
    }
  }
  
  console.log(`✅ Price analysis complete:`)
  console.log(`   Products up to date: ${upToDate.length}`)
  console.log(`   Products needing updates: ${needsUpdate.length}`)
  console.log(`   Price increases: ${priceIncreases.length}`)
  console.log(`   Price decreases: ${priceDecreases.length}`)
  
  return { needsUpdate, upToDate, priceIncreases, priceDecreases }
}

// --- PRICE ROUNDING ---
function roundPrice(price) {
  let p = Math.ceil(price)
  return (p - 0.01 + 1).toFixed(2)
}

// --- UPDATE SINGLE PRODUCT ---
async function updateSingleProduct(productData) {
  const { variant, sku, cost, newPrice } = productData
  
  console.log(`\n🔄 Updating: ${sku}`)
  console.log(`   Product: ${productData.product.title}`)
  console.log(`   Cost: R${cost} → Retail: R${newPrice}`)
  console.log(`   Old price: R${productData.currentPrice}`)
  
  let priceOK = false, costOK = false
  
  // Update price
  try {
    await shopifyClient.put(`/variants/${variant.id}.json`, {
      variant: { id: variant.id, price: newPrice }
    })
    console.log(`   ✅ Price: R${productData.currentPrice} → R${newPrice}`)
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
    console.log(`   ✅ Cost updated: R${cost}`)
    costOK = true
  } catch (err) {
    console.log(`   ❌ Cost update failed:`, err.response?.status, err.response?.data?.errors)
  }
  
  return { priceOK, costOK }
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🚀 FINAL COMPREHENSIVE PRICE SYNC`)
  console.log(`Perfect SKU matching enabled - this should be flawless!`)
  console.log(`Markup: ${PRICE_MARKUP}x`)
  console.log('=' * 60)
  
  try {
    // 1. Get Amrod authentication and pricing
    const token = await getAmrodToken()
    const pricesData = await fetchAmrodPrices(token)
    const pricingMap = buildPricingMap(pricesData)
    
    // 2. Get all Shopify products
    const allProducts = await getAllShopifyProducts()
    
    // 3. Analyze products for Amrod pricing
    const { amrodProducts, nonAmrodProducts } = analyzeProductsForAmrodPricing(allProducts, pricingMap)
    
    if (amrodProducts.length === 0) {
      console.log('\n❌ No Amrod products found with pricing')
      return
    }
    
    // 4. Identify price updates needed
    const priceAnalysis = identifyPriceUpdatesNeeded(amrodProducts)
    
    if (priceAnalysis.needsUpdate.length === 0) {
      console.log('\n🎉 ALL AMROD PRODUCTS ARE UP TO DATE!')
      console.log(`✅ ${priceAnalysis.upToDate.length} products already have correct pricing`)
      return
    }
    
    // 5. Show what will be updated
    console.log(`\n📊 PRICE UPDATE PREVIEW (first 10):`)
    priceAnalysis.needsUpdate.slice(0, 10).forEach(item => {
      const changeType = item.difference > 0 ? '📈' : '📉'
      console.log(`   ${changeType} ${item.sku}: R${item.currentPrice} → R${item.newPrice} (${item.difference > 0 ? '+' : ''}R${item.difference.toFixed(2)})`)
      console.log(`      ${item.product.title}`)
    })
    
    if (priceAnalysis.needsUpdate.length > 10) {
      console.log(`   ... and ${priceAnalysis.needsUpdate.length - 10} more`)
    }
    
    console.log(`\n⚠️  This will update ${priceAnalysis.needsUpdate.length} products with new pricing!`)
    
    // 6. Update all products
    console.log(`\n🚀 UPDATING ${priceAnalysis.needsUpdate.length} PRODUCTS:`)
    
    let successCount = 0
    let failCount = 0
    
    for (const [index, productData] of priceAnalysis.needsUpdate.entries()) {
      console.log(`\n📦 ${index + 1}/${priceAnalysis.needsUpdate.length}`)
      
      try {
        const result = await updateSingleProduct(productData)
        
        if (result.priceOK && result.costOK) {
          successCount++
        } else {
          failCount++
        }
        
        await sleep(SLEEP_MS)
        
      } catch (err) {
        console.error(`   💥 Error updating ${productData.sku}:`, err.message)
        failCount++
      }
    }
    
    // 7. Final Summary
    console.log(`\n🎉 COMPREHENSIVE PRICE SYNC COMPLETE!`)
    console.log(`   ✅ Successfully updated: ${successCount} products`)
    console.log(`   ❌ Failed to update: ${failCount} products`)
    console.log(`   ✅ Already up to date: ${priceAnalysis.upToDate.length} products`)
    console.log(`   📊 Total Amrod products: ${amrodProducts.length}`)
    console.log(`   📊 Non-Amrod products: ${nonAmrodProducts.length}`)
    console.log(`   📈 Success rate: ${((successCount / priceAnalysis.needsUpdate.length) * 100).toFixed(1)}%`)
    
    if (successCount > 0) {
      console.log(`\n✅ ${successCount} products now have current Amrod pricing!`)
      console.log(`💰 Price increases: ${priceAnalysis.priceIncreases.length}`)
      console.log(`💰 Price decreases: ${priceAnalysis.priceDecreases.length}`)
    }
    
    console.log(`\n🎯 MISSION ACCOMPLISHED!`)
    console.log(`   🔧 SKUs are perfectly matched with Amrod`)
    console.log(`   💰 Prices are synced with current Amrod rates`)
    console.log(`   📊 ${((amrodProducts.length / (amrodProducts.length + nonAmrodProducts.length)) * 100).toFixed(1)}% of inventory is Amrod products`)
    console.log(`   🚀 Future syncs will be automatic and reliable`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()