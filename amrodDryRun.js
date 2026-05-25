import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za'
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const API_VERSION = '1'

// Updated products endpoint
const AMROD_UPDATED_PRODUCTS_URL = `${AMROD_BASE_URL}/api/v${API_VERSION}/Products/GetUpdatedProductsAndBranding`

console.log('🔧 DRY RUN - No changes will be made to Shopify')
console.log('🔧 API Configuration:')
console.log(`   Base URL: ${AMROD_BASE_URL}`)
console.log(`   Auth URL: ${AMROD_AUTH_URL}`)
console.log(`   Updated Products Endpoint: ${AMROD_UPDATED_PRODUCTS_URL}`)
console.log('')

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

// --- FETCH UPDATED PRODUCTS ---
async function fetchUpdatedProducts(token) {
  try {
    console.log('🔍 Fetching updated products from Amrod (changes since yesterday)...')
    console.log(`   URL: ${AMROD_UPDATED_PRODUCTS_URL}`)
    
    const res = await axios.get(AMROD_UPDATED_PRODUCTS_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    })
    
    console.log(`✅ Response status: ${res.status}`)
    console.log(`📊 Response data type: ${typeof res.data}`)
    console.log(`📊 Response data length: ${Array.isArray(res.data) ? res.data.length : 'Not an array'}`)
    
    // Debug the response structure
    if (res.data && typeof res.data === 'object') {
      if (Array.isArray(res.data)) {
        console.log(`📊 Array with ${res.data.length} items`)
        
        // Sample first item if it exists
        if (res.data.length > 0) {
          console.log(`📊 First item keys: ${Object.keys(res.data[0]).join(', ')}`)
          console.log(`📊 First item sample:`)
          const sample = res.data[0]
          
          // Show key fields
          console.log(`     simpleCode: ${sample.simpleCode || 'N/A'}`)
          console.log(`     fullCode: ${sample.fullCode || 'N/A'}`)
          console.log(`     productName: ${sample.productName || 'N/A'}`)
          console.log(`     actionType: ${sample.actionType !== undefined ? sample.actionType : sample.ActionType || 'N/A'}`)
          console.log(`     type: ${sample.type || 'N/A'}`)
        }
      } else {
        console.log(`📊 Object keys: ${Object.keys(res.data).join(', ')}`)
      }
    }
    
    const updatedProducts = res.data || []
    console.log(`✅ Successfully fetched ${Array.isArray(updatedProducts) ? updatedProducts.length : 'unknown count'} updated products`)
    return updatedProducts
  } catch (err) {
    console.error('❌ Failed to fetch updated products:')
    console.error(`   Status: ${err.response?.status || 'No status'}`)
    console.error(`   Status Text: ${err.response?.statusText || 'No status text'}`)
    
    if (err.response?.data) {
      console.error('   Response data:', JSON.stringify(err.response.data, null, 2))
    }
    
    if (err.code) {
      console.error(`   Error code: ${err.code}`)
    }
    
    if (err.message) {
      console.error(`   Error message: ${err.message}`)
    }
    
    process.exit(1)
  }
}

// --- ANALYZE UPDATED PRODUCTS ---
function analyzeUpdatedProducts(updatedProducts) {
  console.log('\n🔍 ANALYZING UPDATED PRODUCTS...')
  
  const analysis = {
    created: [],      // ActionType: 0
    updated: [],      // ActionType: 1  
    removed: [],      // ActionType: 2
    unknown: []       // Any other ActionType
  }
  
  // Track action types we see
  const actionTypeCounts = new Map()
  
  for (const product of updatedProducts) {
    const actionType = product.actionType !== undefined ? product.actionType : product.ActionType
    
    // Count action types
    actionTypeCounts.set(actionType, (actionTypeCounts.get(actionType) || 0) + 1)
    
    switch(actionType) {
      case 0:
        analysis.created.push(product)
        break
      case 1:
        analysis.updated.push(product)
        break
      case 2:
        analysis.removed.push(product)
        break
      default:
        analysis.unknown.push(product)
        break
    }
  }
  
  console.log(`📊 Updated products breakdown:`)
  console.log(`   🆕 Created (ActionType 0): ${analysis.created.length}`)
  console.log(`   🔄 Updated (ActionType 1): ${analysis.updated.length}`)
  console.log(`   🗑️  Removed (ActionType 2): ${analysis.removed.length}`)
  console.log(`   ❓ Unknown action: ${analysis.unknown.length}`)
  
  console.log(`\n📊 All ActionTypes found:`)
  for (const [actionType, count] of actionTypeCounts) {
    console.log(`   ActionType ${actionType}: ${count} products`)
  }
  
  return analysis
}

// --- SHOW DETAILED SAMPLES ---
function showDetailedSamples(analysis) {
  console.log('\n📋 DETAILED SAMPLES:')
  console.log('='.repeat(60))
  
  // Show created products
  if (analysis.created.length > 0) {
    console.log(`\n🆕 CREATED PRODUCTS (${analysis.created.length} total):`)
    console.log('   These are NEW products added to Amrod catalog')
    
    analysis.created.slice(0, 5).forEach((product, index) => {
      console.log(`\n   ${index + 1}. ${product.simpleCode || product.fullCode || 'No Code'}`)
      console.log(`      Product Name: ${product.productName || 'N/A'}`)
      console.log(`      Type: ${product.type || 'N/A'}`)
      console.log(`      ActionType: ${product.actionType !== undefined ? product.actionType : product.ActionType}`)
      
      if (product.variants && product.variants.length > 0) {
        console.log(`      Variants: ${product.variants.length}`)
        console.log(`      First variant: ${product.variants[0].code || 'No code'}`)
      }
    })
    
    if (analysis.created.length > 5) {
      console.log(`   ... and ${analysis.created.length - 5} more created products`)
    }
  }
  
  // Show updated products
  if (analysis.updated.length > 0) {
    console.log(`\n🔄 UPDATED PRODUCTS (${analysis.updated.length} total):`)
    console.log('   These products have CHANGES (pricing, info, etc.)')
    
    analysis.updated.slice(0, 5).forEach((product, index) => {
      console.log(`\n   ${index + 1}. ${product.simpleCode || product.fullCode || 'No Code'}`)
      console.log(`      Product Name: ${product.productName || 'N/A'}`)
      console.log(`      Type: ${product.type || 'N/A'}`)
      console.log(`      ActionType: ${product.actionType !== undefined ? product.actionType : product.ActionType}`)
      
      if (product.variants && product.variants.length > 0) {
        console.log(`      Variants: ${product.variants.length}`)
        console.log(`      First variant: ${product.variants[0].code || 'No code'}`)
      }
    })
    
    if (analysis.updated.length > 5) {
      console.log(`   ... and ${analysis.updated.length - 5} more updated products`)
    }
  }
  
  // Show removed products
  if (analysis.removed.length > 0) {
    console.log(`\n🗑️ REMOVED PRODUCTS (${analysis.removed.length} total):`)
    console.log('   These products have been REMOVED from Amrod catalog')
    
    analysis.removed.slice(0, 5).forEach((product, index) => {
      console.log(`\n   ${index + 1}. ${product.simpleCode || product.fullCode || 'No Code'}`)
      console.log(`      Product Name: ${product.productName || 'N/A'}`)
      console.log(`      Type: ${product.type || 'N/A'}`)
      console.log(`      ActionType: ${product.actionType !== undefined ? product.actionType : product.ActionType}`)
    })
    
    if (analysis.removed.length > 5) {
      console.log(`   ... and ${analysis.removed.length - 5} more removed products`)
    }
  }
  
  // Show unknown action types
  if (analysis.unknown.length > 0) {
    console.log(`\n❓ UNKNOWN ACTION TYPES (${analysis.unknown.length} total):`)
    
    analysis.unknown.slice(0, 3).forEach((product, index) => {
      console.log(`\n   ${index + 1}. ${product.simpleCode || product.fullCode || 'No Code'}`)
      console.log(`      Product Name: ${product.productName || 'N/A'}`)
      console.log(`      ActionType: ${product.actionType !== undefined ? product.actionType : product.ActionType}`)
    })
  }
}

// --- EXPORT TO JSON ---
function exportToJson(updatedProducts) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `amrod-daily-updates-${timestamp}.json`
    
    // In a real implementation, you'd write to file
    // For now, we'll just show the structure
    console.log(`\n💾 EXPORT INFO:`)
    console.log(`   Would save to: ${filename}`)
    console.log(`   Total records: ${updatedProducts.length}`)
    console.log(`   Sample structure saved for review`)
    
    // Show first item structure for reference
    if (updatedProducts.length > 0) {
      console.log(`\n📋 Sample JSON structure:`)
      console.log(JSON.stringify(updatedProducts[0], null, 2))
    }
    
  } catch (err) {
    console.error('❌ Error exporting:', err.message)
  }
}

// --- MAIN EXECUTION ---
async function main() {
  console.log(`🔍 AMROD DAILY SYNC - DRY RUN`)
  console.log(`Fetching and analyzing daily updates WITHOUT making changes`)
  console.log(`This will show you what would be processed in a real sync`)
  console.log('='.repeat(80))
  
  try {
    // 1. Get Amrod token
    const token = await getAmrodToken()
    
    // 2. Fetch updated products
    console.log('\n📦 STEP 1: Fetching daily updates from Amrod...')
    const updatedProducts = await fetchUpdatedProducts(token)
    
    if (updatedProducts.length === 0) {
      console.log('\n🎉 NO UPDATES FOUND!')
      console.log('✅ No products were changed in Amrod since yesterday')
      console.log('💡 This means your catalog would already be up to date')
      return
    }
    
    // 3. Analyze the updates
    console.log('\n📦 STEP 2: Analyzing updates...')
    const analysis = analyzeUpdatedProducts(updatedProducts)
    
    // 4. Show detailed samples
    showDetailedSamples(analysis)
    
    // 5. Export for review
    exportToJson(updatedProducts)
    
    // 6. Summary and next steps
    console.log(`\n📋 DRY RUN SUMMARY:`)
    console.log('='.repeat(50))
    console.log(`   📊 Total products with changes: ${updatedProducts.length}`)
    console.log(`   🆕 New products to consider: ${analysis.created.length}`)
    console.log(`   🔄 Products needing updates: ${analysis.updated.length}`)
    console.log(`   🗑️ Products to deactivate: ${analysis.removed.length}`)
    
    console.log(`\n💡 WHAT WOULD HAPPEN IN REAL SYNC:`)
    if (analysis.created.length > 0) {
      console.log(`   🆕 ${analysis.created.length} new products would be flagged for manual review`)
    }
    if (analysis.updated.length > 0) {
      console.log(`   🔄 ${analysis.updated.length} existing products would have prices updated`)
    }
    if (analysis.removed.length > 0) {
      console.log(`   🗑️ ${analysis.removed.length} products would be deactivated in Shopify`)
    }
    
    console.log(`\n🎯 NEXT STEPS:`)
    console.log(`   1. Review the samples above`)
    console.log(`   2. If everything looks good, run the full sync script`)
    console.log(`   3. The full script will make actual changes to Shopify`)
    
    console.log(`\n✅ DRY RUN COMPLETE!`)
    console.log(`🔒 No changes were made to your Shopify store`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run the main function
main()