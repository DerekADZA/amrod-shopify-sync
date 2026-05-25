import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const SLEEP_MS = 300

// Search terms related to the target product
const SEARCH_TERMS = [
  'gf-am-916',
  'am-916',
  '916',
  'GF-AM-916',
  'AM-916'
]

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

// --- BROAD SEARCH FOR SIMILAR SKUS ---
async function broadSearchForSimilarSKUs() {
  console.log(`🔍 Broad search for SKUs containing: ${SEARCH_TERMS.join(', ')}`)
  
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
          
          // Check if SKU contains any of our search terms
          const skuLower = sku.toLowerCase()
          for (const term of SEARCH_TERMS) {
            if (skuLower.includes(term.toLowerCase())) {
              foundProducts.push({
                sku: sku,
                title: product.title,
                price: variant.price,
                productId: product.id,
                variantId: variant.id,
                matchedTerm: term
              })
              break // Don't add the same product multiple times
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
  
  console.log(`✅ Found ${foundProducts.length} products with similar SKUs`)
  return foundProducts
}

// --- SEARCH FOR GF-AM PRODUCTS ---
async function searchGFAMProducts() {
  console.log(`\n🔍 Searching for all GF-AM products...`)
  
  let gfamProducts = []
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
      
      // Check each product's variants for GF-AM pattern
      for (const product of products) {
        for (const variant of product.variants) {
          const sku = (variant.sku || '').trim()
          if (!sku) continue
          
          // Check if SKU starts with GF-AM
          if (sku.toUpperCase().startsWith('GF-AM-')) {
            gfamProducts.push({
              sku: sku,
              title: product.title,
              price: variant.price,
              productId: product.id,
              variantId: variant.id
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
  
  console.log(`✅ Found ${gfamProducts.length} GF-AM products`)
  return gfamProducts
}

// --- SEARCH BY PRODUCT TITLE ---
async function searchByTitle() {
  console.log(`\n🔍 Searching by product title containing "916"...`)
  
  let titleMatches = []
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
      
      // Check product titles
      for (const product of products) {
        if (product.title.toLowerCase().includes('916') || 
            product.title.toLowerCase().includes('am-916')) {
          
          for (const variant of product.variants) {
            titleMatches.push({
              sku: variant.sku || '',
              title: product.title,
              price: variant.price,
              productId: product.id,
              variantId: variant.id
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
  
  console.log(`✅ Found ${titleMatches.length} products with "916" in title`)
  return titleMatches
}

// --- MAIN SEARCH ---
;(async () => {
  console.log(`🚀 BROAD SKU SEARCH`)
  console.log(`Looking for products similar to: gf-am-916-b-s-0`)
  console.log('=' * 60)
  
  try {
    // 1. Broad search for similar SKUs
    const similarProducts = await broadSearchForSimilarSKUs()
    
    if (similarProducts.length > 0) {
      console.log(`\n📋 PRODUCTS WITH SIMILAR SKUs (${similarProducts.length}):`)
      similarProducts.forEach(item => {
        const priceStatus = parseFloat(item.price) === 0 ? '💰 R 0.00' : `💵 R ${item.price}`
        console.log(`   ${item.sku} - ${item.title} (${priceStatus})`)
      })
    }
    
    // 2. Search for all GF-AM products
    const gfamProducts = await searchGFAMProducts()
    
    if (gfamProducts.length > 0) {
      console.log(`\n📋 ALL GF-AM PRODUCTS (first 20):`)
      gfamProducts.slice(0, 20).forEach(item => {
        const priceStatus = parseFloat(item.price) === 0 ? '💰 R 0.00' : `💵 R ${item.price}`
        console.log(`   ${item.sku} - ${item.title} (${priceStatus})`)
      })
      
      if (gfamProducts.length > 20) {
        console.log(`   ... and ${gfamProducts.length - 20} more GF-AM products`)
      }
      
      // Show zero-price GF-AM products
      const zeroGFAM = gfamProducts.filter(p => parseFloat(p.price) === 0)
      if (zeroGFAM.length > 0) {
        console.log(`\n💰 GF-AM PRODUCTS WITH R 0.00 (${zeroGFAM.length}):`)
        zeroGFAM.forEach(item => {
          console.log(`   ${item.sku} - ${item.title}`)
        })
      }
    }
    
    // 3. Search by title
    const titleMatches = await searchByTitle()
    
    if (titleMatches.length > 0) {
      console.log(`\n📋 PRODUCTS WITH "916" IN TITLE (${titleMatches.length}):`)
      titleMatches.forEach(item => {
        const priceStatus = parseFloat(item.price) === 0 ? '💰 R 0.00' : `💵 R ${item.price}`
        console.log(`   ${item.sku || 'NO SKU'} - ${item.title} (${priceStatus})`)
      })
    }
    
    console.log(`\n📊 SEARCH SUMMARY:`)
    console.log(`   Products with similar SKUs: ${similarProducts.length}`)
    console.log(`   Total GF-AM products: ${gfamProducts.length}`)
    console.log(`   GF-AM with R 0.00: ${gfamProducts.filter(p => parseFloat(p.price) === 0).length}`)
    console.log(`   Products with "916" in title: ${titleMatches.length}`)
    
    console.log(`\n💡 NEXT STEPS:`)
    console.log(`   1. Check the exact SKU format from the results above`)
    console.log(`   2. Look for the product that matches your description`)
    console.log(`   3. Note any formatting differences (spaces, dashes, etc.)`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
})()