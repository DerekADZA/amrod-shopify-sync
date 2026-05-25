import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const SLEEP_MS = 300

// The specific SKU to search for
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

// --- SEARCH FOR SPECIFIC SKU ---
async function searchForSpecificSKU(targetSku) {
  console.log(`🔍 Searching for: ${targetSku}`)
  
  let foundProducts = []
  let lastId = null
  let productCount = 0
  
  while (true) {
    const params = { limit: 50 }
    if (lastId) params.since_id = lastId
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      productCount += products.length
      
      if (productCount % 500 === 0) {
        console.log(`   📊 Scanned ${productCount} products...`)
      }
      
      // Check each product's variants
      for (const product of products) {
        for (const variant of product.variants) {
          const sku = (variant.sku || '').trim()
          if (!sku) continue
          
          // Multiple ways to match
          const exactMatch = sku === targetSku
          const caseInsensitiveMatch = sku.toLowerCase() === targetSku.toLowerCase()
          const containsMatch = sku.toLowerCase().includes(targetSku.toLowerCase())
          const reverseContainsMatch = targetSku.toLowerCase().includes(sku.toLowerCase())
          
          if (exactMatch || caseInsensitiveMatch || containsMatch || reverseContainsMatch) {
            console.log(`\n✅ FOUND MATCH!`)
            console.log(`   Target: ${targetSku}`)
            console.log(`   Found SKU: ${sku}`)
            console.log(`   Match Type: ${exactMatch ? 'EXACT' : caseInsensitiveMatch ? 'CASE-INSENSITIVE' : containsMatch ? 'CONTAINS' : 'REVERSE-CONTAINS'}`)
            console.log(`   Product: ${product.title}`)
            console.log(`   Product ID: ${product.id}`)
            console.log(`   Variant ID: ${variant.id}`)
            console.log(`   Current Price: R${variant.price}`)
            console.log(`   Inventory Item ID: ${variant.inventory_item_id}`)
            
            foundProducts.push({
              product: product,
              variant: variant,
              sku: sku,
              matchType: exactMatch ? 'EXACT' : caseInsensitiveMatch ? 'CASE-INSENSITIVE' : containsMatch ? 'CONTAINS' : 'REVERSE-CONTAINS'
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
  
  console.log(`\n📊 Search completed: ${productCount} products scanned`)
  console.log(`✅ Found ${foundProducts.length} matching products`)
  
  return foundProducts
}

// --- SEARCH FOR PARTIAL MATCHES ---
async function searchForPartialMatches() {
  console.log(`\n🔍 Searching for partial matches: "916", "gf-am", "am-916"...`)
  
  const searchTerms = ['916', 'gf-am', 'am-916', 'GF-AM-916']
  let allMatches = []
  
  let lastId = null
  let productCount = 0
  
  while (true) {
    const params = { limit: 50 }
    if (lastId) params.since_id = lastId
    
    try {
      const res = await shopifyClient.get('/products.json', { params })
      const products = res.data.products || []
      
      if (!products.length) break
      
      productCount += products.length
      
      if (productCount % 500 === 0) {
        console.log(`   📊 Scanned ${productCount} products...`)
      }
      
      // Check each product's variants
      for (const product of products) {
        for (const variant of product.variants) {
          const sku = (variant.sku || '').trim()
          if (!sku) continue
          
          // Check for partial matches
          for (const term of searchTerms) {
            if (sku.toLowerCase().includes(term.toLowerCase())) {
              allMatches.push({
                sku: sku,
                title: product.title,
                price: variant.price,
                productId: product.id,
                variantId: variant.id,
                matchedTerm: term
              })
              break // Don't add same product multiple times
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
  
  return allMatches
}

// --- MAIN EXECUTION ---
;(async () => {
  console.log(`🚀 SPECIFIC SKU SEARCH`)
  console.log(`Target: ${TARGET_SKU}`)
  console.log('=' * 50)
  
  try {
    // 1. Search for exact SKU
    const exactMatches = await searchForSpecificSKU(TARGET_SKU)
    
    // 2. If no exact matches, search for partial matches
    if (exactMatches.length === 0) {
      console.log(`\n🔍 No exact matches found. Searching for partial matches...`)
      const partialMatches = await searchForPartialMatches()
      
      if (partialMatches.length > 0) {
        console.log(`\n📋 PARTIAL MATCHES FOUND (${partialMatches.length}):`)
        partialMatches.forEach(item => {
          const priceStatus = parseFloat(item.price) === 0 ? '💰 R 0.00' : `💵 R ${item.price}`
          console.log(`   ${item.sku} - ${item.title} (${priceStatus}) [matched: ${item.matchedTerm}]`)
        })
      } else {
        console.log(`\n❌ No partial matches found either`)
      }
    }
    
    console.log(`\n📊 FINAL RESULT:`)
    if (exactMatches.length > 0) {
      console.log(`   ✅ Found ${exactMatches.length} exact match(es) for ${TARGET_SKU}`)
      exactMatches.forEach(match => {
        console.log(`      ${match.sku} - ${match.product.title} (R${match.variant.price})`)
      })
    } else {
      console.log(`   ❌ SKU "${TARGET_SKU}" not found in Shopify`)
      console.log(`   💡 Check if the SKU format is different or if the product exists`)
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()