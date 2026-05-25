import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const SLEEP_MS = 300

// The specific SKU we're looking for
const TARGET_SKU = 'gf-am-916-b-s-0'

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

// --- SEARCH FOR ALL VARIATIONS ---
async function searchForAllVariations() {
  console.log(`🔍 Direct search for: ${TARGET_SKU}`)
  console.log(`Also searching for case variations...`)
  
  const searchVariations = [
    'gf-am-916-b-s-0',     // lowercase
    'GF-AM-916-B-S-0',     // uppercase  
    'Gf-Am-916-B-S-0',     // mixed case
    'gf-am-916-b',         // simple code
    'GF-AM-916-B'          // simple code uppercase
  ]
  
  let allProducts = []
  let foundMatches = []
  let lastId = null
  let batchCount = 0
  
  while (true) {
    batchCount++
    const params = { limit: 50 }
    if (lastId) params.since_id = lastId
    
    if (batchCount % 10 === 0) {
      console.log(`   📦 Scanned ${allProducts.length} products so far...`)
    }
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      allProducts.push(...products)
      
      // Check each product's variants for our target SKUs
      for (const product of products) {
        for (const variant of product.variants) {
          const sku = (variant.sku || '').trim()
          if (!sku) continue
          
          // Check for any of our variations
          for (const searchSKU of searchVariations) {
            if (sku === searchSKU || sku.toLowerCase() === searchSKU.toLowerCase()) {
              foundMatches.push({
                product: product,
                variant: variant,
                sku: sku,
                searchedFor: searchSKU,
                matchType: sku === searchSKU ? 'EXACT' : 'CASE_DIFFERENT'
              })
            }
          }
          
          // Also check if it contains our key parts
          if (sku.toLowerCase().includes('gf-am-916') || 
              sku.toLowerCase().includes('am-916')) {
            foundMatches.push({
              product: product,
              variant: variant,
              sku: sku,
              searchedFor: 'contains gf-am-916',
              matchType: 'PARTIAL'
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
  
  console.log(`✅ Scanned ${allProducts.length} products total`)
  return { allProducts, foundMatches }
}

// --- UPDATE SPECIFIC SKU ---
async function updateSpecificSKU(matchData) {
  const { variant, sku, product } = matchData
  const correctSKU = 'GF-AM-916-B-S-0'
  const amrodCost = 316.57
  const retailPrice = 452.99
  
  console.log(`\n🔄 UPDATING SPECIFIC SKU:`)
  console.log(`   Product: ${product.title}`)
  console.log(`   Variant ID: ${variant.id}`)
  console.log(`   Current SKU: "${sku}"`)
  console.log(`   Correct SKU: "${correctSKU}"`)
  console.log(`   Current Price: R${variant.price}`)
  console.log(`   Target Price: R${retailPrice}`)
  
  let skuOK = false, priceOK = false, costOK = false
  
  // Update SKU first
  if (sku !== correctSKU) {
    try {
      await shopifyClient.put(`/variants/${variant.id}.json`, {
        variant: { id: variant.id, sku: correctSKU }
      })
      console.log(`   ✅ SKU updated: "${sku}" → "${correctSKU}"`)
      skuOK = true
    } catch (err) {
      console.log(`   ❌ SKU update failed:`, err.response?.status, err.response?.data?.errors)
    }
    
    await sleep(SLEEP_MS)
  } else {
    skuOK = true
    console.log(`   ✅ SKU already correct`)
  }
  
  // Update price
  if (parseFloat(variant.price) !== retailPrice) {
    try {
      await shopifyClient.put(`/variants/${variant.id}.json`, {
        variant: { id: variant.id, price: retailPrice.toFixed(2) }
      })
      console.log(`   ✅ Price updated: R${variant.price} → R${retailPrice}`)
      priceOK = true
    } catch (err) {
      console.log(`   ❌ Price update failed:`, err.response?.status, err.response?.data?.errors)
    }
    
    await sleep(SLEEP_MS)
  } else {
    priceOK = true
    console.log(`   ✅ Price already correct`)
  }
  
  // Update cost
  try {
    await shopifyClient.put(`/inventory_items/${variant.inventory_item_id}.json`, {
      inventory_item: { id: variant.inventory_item_id, cost: amrodCost }
    })
    console.log(`   ✅ Cost updated: R${amrodCost}`)
    costOK = true
  } catch (err) {
    console.log(`   ❌ Cost update failed:`, err.response?.status, err.response?.data?.errors)
  }
  
  return { skuOK, priceOK, costOK }
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🎯 DIRECT SKU SEARCH`)
  console.log(`Target: ${TARGET_SKU} (Alps Winter Blanket Gift Set)`)
  console.log('=' * 60)
  
  try {
    // 1. Search for the product
    const { allProducts, foundMatches } = await searchForAllVariations()
    
    // 2. Remove duplicates
    const uniqueMatches = foundMatches.filter((match, index, self) =>
      index === self.findIndex(m => m.variant.id === match.variant.id)
    )
    
    console.log(`\n📊 SEARCH RESULTS:`)
    console.log(`   Total products scanned: ${allProducts.length}`)
    console.log(`   Matches found: ${uniqueMatches.length}`)
    
    if (uniqueMatches.length === 0) {
      console.log(`\n❌ NO MATCHES FOUND`)
      console.log(`💡 Possible reasons:`)
      console.log(`   1. Product was deleted`)
      console.log(`   2. SKU was changed to something else`)
      console.log(`   3. Product is in a different format than expected`)
      console.log(`   4. There might be a sync delay`)
      return
    }
    
    // 3. Show all matches
    console.log(`\n📋 FOUND MATCHES:`)
    uniqueMatches.forEach((match, index) => {
      console.log(`\n   Match ${index + 1}:`)
      console.log(`     SKU: "${match.sku}"`)
      console.log(`     Product: ${match.product.title}`)
      console.log(`     Match Type: ${match.matchType}`)
      console.log(`     Current Price: R${match.variant.price}`)
      console.log(`     Product ID: ${match.product.id}`)
      console.log(`     Variant ID: ${match.variant.id}`)
      console.log(`     Searched for: ${match.searchedFor}`)
    })
    
    // 4. Find the exact target and update it
    const exactMatch = uniqueMatches.find(match => 
      match.sku.toLowerCase() === TARGET_SKU.toLowerCase()
    )
    
    if (exactMatch) {
      console.log(`\n🎯 FOUND EXACT TARGET: ${exactMatch.sku}`)
      console.log(`🔧 Proceeding with update...`)
      
      const updateResult = await updateSpecificSKU(exactMatch)
      
      console.log(`\n🎉 UPDATE COMPLETE!`)
      console.log(`   SKU: ${updateResult.skuOK ? '✅' : '❌'}`)
      console.log(`   Price: ${updateResult.priceOK ? '✅' : '❌'}`)
      console.log(`   Cost: ${updateResult.costOK ? '✅' : '❌'}`)
      
      if (updateResult.skuOK && updateResult.priceOK && updateResult.costOK) {
        console.log(`\n✅ Alps Winter Blanket Gift Set is now correctly configured!`)
      }
    } else {
      console.log(`\n❓ Target SKU not found, but similar products exist`)
      console.log(`💡 You may want to update one of the matches above manually`)
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()