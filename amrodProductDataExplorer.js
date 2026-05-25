import 'dotenv/config'
import axios from 'axios'
import fs from 'fs'

// --- CONFIG ---
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za'
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const API_VERSION = '1'

// Complete products endpoint
const AMROD_PRODUCTS_URL = `${AMROD_BASE_URL}/api/v${API_VERSION}/Products/GetProductsAndBranding`

console.log('🔍 AMROD PRODUCT DATA EXPLORER')
console.log('Analyzing complete product structure from Amrod API')
console.log('='.repeat(80))

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

// --- FETCH SAMPLE PRODUCTS ---
async function fetchSampleProducts(token, limit = 10) {
  try {
    console.log(`\n🔍 Fetching ${limit} sample products for analysis...`)
    
    const res = await axios.get(AMROD_PRODUCTS_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 120000
    })
    
    const allProducts = res.data || []
    console.log(`✅ Total products available: ${allProducts.length}`)
    
    // Get a diverse sample
    const sampleProducts = []
    const step = Math.floor(allProducts.length / limit)
    
    for (let i = 0; i < limit && i * step < allProducts.length; i++) {
      sampleProducts.push(allProducts[i * step])
    }
    
    console.log(`📊 Selected ${sampleProducts.length} sample products for analysis`)
    return { sampleProducts, totalCount: allProducts.length }
  } catch (err) {
    console.error('❌ Failed to fetch products:', err.response?.status, err.response?.statusText)
    process.exit(1)
  }
}

// --- ANALYZE PRODUCT STRUCTURE ---
function analyzeProductStructure(products) {
  console.log('\n🔍 ANALYZING PRODUCT DATA STRUCTURE...')
  console.log('='.repeat(50))
  
  const allKeys = new Set()
  const keyTypes = new Map()
  const keyExamples = new Map()
  const keyCounts = new Map()
  
  // Analyze all products
  for (const product of products) {
    analyzeObject(product, '', allKeys, keyTypes, keyExamples, keyCounts)
  }
  
  // Sort keys alphabetically
  const sortedKeys = Array.from(allKeys).sort()
  
  console.log(`\n📊 COMPLETE FIELD ANALYSIS (${sortedKeys.length} unique fields):`)
  console.log('='.repeat(80))
  
  for (const key of sortedKeys) {
    const count = keyCounts.get(key) || 0
    const percentage = ((count / products.length) * 100).toFixed(1)
    const types = Array.from(keyTypes.get(key) || []).join(' | ')
    const example = keyExamples.get(key)
    
    console.log(`\n🔑 ${key}`)
    console.log(`   📊 Present in: ${count}/${products.length} products (${percentage}%)`)
    console.log(`   📝 Type(s): ${types}`)
    
    if (example !== undefined && example !== null) {
      let exampleStr = JSON.stringify(example)
      if (exampleStr.length > 100) {
        exampleStr = exampleStr.substring(0, 97) + '...'
      }
      console.log(`   💡 Example: ${exampleStr}`)
    }
  }
  
  return { allKeys: sortedKeys, keyTypes, keyExamples, keyCounts }
}

// --- RECURSIVE OBJECT ANALYZER ---
function analyzeObject(obj, prefix, allKeys, keyTypes, keyExamples, keyCounts, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) return
  
  if (Array.isArray(obj)) {
    const key = prefix || 'root'
    allKeys.add(key)
    
    if (!keyTypes.has(key)) keyTypes.set(key, new Set())
    keyTypes.get(key).add('array')
    
    if (!keyExamples.has(key) && obj.length > 0) {
      keyExamples.set(key, `[${obj.length} items] ${JSON.stringify(obj[0])}`.substring(0, 100))
    }
    
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1)
    
    // Analyze array items
    if (obj.length > 0) {
      analyzeObject(obj[0], `${key}[0]`, allKeys, keyTypes, keyExamples, keyCounts, depth + 1)
    }
    
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      allKeys.add(fullKey)
      
      if (!keyTypes.has(fullKey)) keyTypes.set(fullKey, new Set())
      if (!keyCounts.has(fullKey)) keyCounts.set(fullKey, 0)
      
      keyCounts.set(fullKey, keyCounts.get(fullKey) + 1)
      
      if (value === null) {
        keyTypes.get(fullKey).add('null')
      } else if (Array.isArray(value)) {
        keyTypes.get(fullKey).add('array')
        if (!keyExamples.has(fullKey) && value.length > 0) {
          keyExamples.set(fullKey, `[${value.length} items]`)
        }
        if (value.length > 0) {
          analyzeObject(value[0], `${fullKey}[0]`, allKeys, keyTypes, keyExamples, keyCounts, depth + 1)
        }
      } else if (typeof value === 'object') {
        keyTypes.get(fullKey).add('object')
        analyzeObject(value, fullKey, allKeys, keyTypes, keyExamples, keyCounts, depth + 1)
      } else {
        keyTypes.get(fullKey).add(typeof value)
        if (!keyExamples.has(fullKey)) {
          keyExamples.set(fullKey, value)
        }
      }
    }
  }
}

// --- FOCUS ON BRANDING DATA ---
function analyzeBrandingData(products) {
  console.log('\n🎨 DETAILED BRANDING ANALYSIS')
  console.log('='.repeat(50))
  
  const brandingFields = [
    'brandings', 'fullBrandingGuide', 'logo24BrandingGuide', 
    'isLogo24', 'logo24Branding', 'inclusiveBranding',
    'requiredBrandingPositions', 'noCoBrandingPositions', 'brandingTemplates'
  ]
  
  for (const field of brandingFields) {
    console.log(`\n🔍 Analyzing: ${field}`)
    
    const productsWithField = products.filter(p => p[field] !== undefined && p[field] !== null)
    console.log(`   📊 Found in ${productsWithField.length}/${products.length} products`)
    
    if (productsWithField.length > 0) {
      const sample = productsWithField[0][field]
      console.log(`   📝 Sample structure:`)
      
      if (Array.isArray(sample)) {
        console.log(`      Array with ${sample.length} items`)
        if (sample.length > 0) {
          console.log(`      First item: ${JSON.stringify(sample[0], null, 6)}`)
        }
      } else if (typeof sample === 'object') {
        console.log(`      Object keys: ${Object.keys(sample).join(', ')}`)
        console.log(`      Sample: ${JSON.stringify(sample, null, 6)}`)
      } else {
        console.log(`      Value: ${sample}`)
      }
    }
  }
}

// --- ANALYZE IMAGES AND VARIANTS ---
function analyzeImagesAndVariants(products) {
  console.log('\n🖼️  DETAILED IMAGES & VARIANTS ANALYSIS')
  console.log('='.repeat(50))
  
  const imageFields = ['images', 'colourImages']
  const variantFields = ['variants']
  
  // Analyze images
  for (const field of imageFields) {
    console.log(`\n📸 Analyzing: ${field}`)
    
    const productsWithField = products.filter(p => p[field] !== undefined && p[field] !== null)
    console.log(`   📊 Found in ${productsWithField.length}/${products.length} products`)
    
    if (productsWithField.length > 0) {
      const sample = productsWithField[0][field]
      console.log(`   📝 Sample structure:`)
      
      if (Array.isArray(sample) && sample.length > 0) {
        console.log(`      Array with ${sample.length} items`)
        console.log(`      First item: ${JSON.stringify(sample[0], null, 6)}`)
        
        if (sample.length > 1) {
          console.log(`      Second item: ${JSON.stringify(sample[1], null, 6)}`)
        }
      }
    }
  }
  
  // Analyze variants
  for (const field of variantFields) {
    console.log(`\n🎯 Analyzing: ${field}`)
    
    const productsWithField = products.filter(p => p[field] !== undefined && p[field] !== null)
    console.log(`   📊 Found in ${productsWithField.length}/${products.length} products`)
    
    if (productsWithField.length > 0) {
      const sample = productsWithField[0][field]
      console.log(`   📝 Sample structure:`)
      
      if (Array.isArray(sample) && sample.length > 0) {
        console.log(`      Array with ${sample.length} items`)
        console.log(`      First item keys: ${Object.keys(sample[0]).join(', ')}`)
        console.log(`      First item: ${JSON.stringify(sample[0], null, 6)}`)
      }
    }
  }
}

// --- EXPORT DETAILED SAMPLES ---
function exportDetailedSamples(products) {
  console.log('\n💾 EXPORTING DETAILED SAMPLES...')
  
  // Export full product samples
  const sampleData = {
    timestamp: new Date().toISOString(),
    productCount: products.length,
    samples: products.slice(0, 3).map((product, index) => ({
      index,
      productName: product.productName,
      simpleCode: product.simpleCode,
      fullStructure: product
    }))
  }
  
  try {
    fs.writeFileSync('amrod_product_samples.json', JSON.stringify(sampleData, null, 2))
    console.log('✅ Exported detailed samples to: amrod_product_samples.json')
  } catch (err) {
    console.error('❌ Failed to export samples:', err.message)
  }
  
  // Export field analysis
  const fieldAnalysis = {
    timestamp: new Date().toISOString(),
    totalProducts: products.length,
    fields: {}
  }
  
  // Simple field presence analysis
  for (const product of products) {
    for (const [key, value] of Object.entries(product)) {
      if (!fieldAnalysis.fields[key]) {
        fieldAnalysis.fields[key] = {
          count: 0,
          type: typeof value,
          hasData: false
        }
      }
      fieldAnalysis.fields[key].count++
      if (value !== null && value !== undefined && value !== '') {
        fieldAnalysis.fields[key].hasData = true
      }
    }
  }
  
  try {
    fs.writeFileSync('amrod_field_analysis.json', JSON.stringify(fieldAnalysis, null, 2))
    console.log('✅ Exported field analysis to: amrod_field_analysis.json')
  } catch (err) {
    console.error('❌ Failed to export field analysis:', err.message)
  }
}

// --- MAIN EXECUTION ---
async function main() {
  try {
    // 1. Get Amrod token
    const token = await getAmrodToken()
    
    // 2. Fetch sample products
    const { sampleProducts, totalCount } = await fetchSampleProducts(token, 50)
    
    if (sampleProducts.length === 0) {
      console.log('❌ No products found for analysis')
      return
    }
    
    // 3. Analyze complete product structure
    const analysis = analyzeProductStructure(sampleProducts)
    
    // 4. Focus on branding data
    analyzeBrandingData(sampleProducts)
    
    // 5. Focus on images and variants
    analyzeImagesAndVariants(sampleProducts)
    
    // 6. Export detailed samples for manual inspection
    exportDetailedSamples(sampleProducts)
    
    console.log('\n🎉 ANALYSIS COMPLETE!')
    console.log('='.repeat(50))
    console.log(`📊 Analyzed ${sampleProducts.length} products out of ${totalCount} total`)
    console.log(`🔑 Found ${analysis.allKeys.length} unique data fields`)
    console.log(`💾 Exported detailed samples for manual review`)
    console.log(`\n💡 Review the exported JSON files to see the complete data structure`)
    console.log(`   Then we can enhance the verification script with any missing fields!`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

main()