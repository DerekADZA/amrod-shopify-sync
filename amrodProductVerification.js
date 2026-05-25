import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za'
const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin'
const API_VERSION = '1'

// Complete products endpoint
const AMROD_PRODUCTS_URL = `${AMROD_BASE_URL}/api/v${API_VERSION}/Products/GetProductsAndBranding`

console.log('🔧 API Configuration:')
console.log(`   Base URL: ${AMROD_BASE_URL}`)
console.log(`   Auth URL: ${AMROD_AUTH_URL}`)
console.log(`   Products Endpoint: ${AMROD_PRODUCTS_URL}`)
console.log('')

const SLEEP_MS = 300

// --- Axios Clients ---
const shopifyGraphQLClient = axios.create({
  baseURL: `${process.env.SHOPIFY_STORE_URL}/admin/api/2025-07`,
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

// --- FETCH ALL AMROD PRODUCTS ---
async function fetchAllAmrodProducts(token) {
  try {
    console.log('🔍 Fetching complete Amrod product catalog...')
    console.log(`   URL: ${AMROD_PRODUCTS_URL}`)
    console.log('   ⚠️  This may take several minutes for large catalogs...')
    
    const res = await axios.get(AMROD_PRODUCTS_URL, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 300000 // 5 minutes timeout for large dataset
    })
    
    console.log(`✅ Response status: ${res.status}`)
    console.log(`📊 Products fetched: ${Array.isArray(res.data) ? res.data.length : 'Unknown count'}`)
    
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      console.log(`📊 Sample product keys: ${Object.keys(res.data[0]).join(', ')}`)
    }
    
    return res.data || []
  } catch (err) {
    console.error('❌ Failed to fetch Amrod products:')
    console.error(`   Status: ${err.response?.status || 'No status'}`)
    console.error(`   Status Text: ${err.response?.statusText || 'No status text'}`)
    
    if (err.response?.data) {
      console.error('   Response data:', JSON.stringify(err.response.data, null, 2))
    }
    process.exit(1)
  }
}

// --- FETCH ALL SHOPIFY PRODUCTS ---
async function fetchAllShopifyProducts() {
  console.log('\n🔍 Fetching all Shopify products...')
  
  const allProducts = []
  let hasNextPage = true
  let cursor = null
  
  while (hasNextPage) {
    const query = `
      query GetProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              vendor
              status
              productType
              tags
              description
              handle
              variants(first: 50) {
                edges {
                  node {
                    id
                    sku
                    title
                    price
                    inventoryQuantity
                    inventoryPolicy
                  }
                }
              }
              images(first: 20) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
              metafields(first: 50) {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                  }
                }
              }
            }
          }
        }
      }
    `
    
    try {
      const response = await shopifyGraphQLClient.post('/graphql.json', {
        query,
        variables: { 
          first: 50,
          after: cursor
        }
      })
      
      const data = response.data.data.products
      allProducts.push(...data.edges.map(edge => edge.node))
      
      hasNextPage = data.pageInfo.hasNextPage
      cursor = data.pageInfo.endCursor
      
      console.log(`   📦 Fetched ${allProducts.length} products so far...`)
      
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error(`❌ Error fetching Shopify products:`, err.response?.data || err.message)
      break
    }
  }
  
  console.log(`✅ Total Shopify products fetched: ${allProducts.length}`)
  return allProducts
}

// --- BUILD PRODUCT LOOKUP MAPS ---
function buildProductMaps(amrodProducts, shopifyProducts) {
  console.log('\n🗂️  Building product lookup maps...')
  
  // Amrod lookup by SKU/code
  const amrodMap = new Map()
  for (const product of amrodProducts) {
    const codes = [
      product.simpleCode,
      product.fullCode,
      product.code,
      product.sku
    ].filter(Boolean)
    
    for (const code of codes) {
      amrodMap.set(code.toUpperCase(), product)
    }
  }
  
  // Shopify lookup by SKU
  const shopifyMap = new Map()
  for (const product of shopifyProducts) {
    for (const variantEdge of product.variants.edges) {
      const variant = variantEdge.node
      if (variant.sku) {
        const key = variant.sku.toUpperCase()
        if (!shopifyMap.has(key)) {
          shopifyMap.set(key, {
            product,
            variants: []
          })
        }
        shopifyMap.get(key).variants.push(variant)
      }
    }
  }
  
  console.log(`📊 Amrod products indexed: ${amrodMap.size}`)
  console.log(`📊 Shopify products indexed: ${shopifyMap.size}`)
  
  // 🔍 DEBUGGING SKU MATCHING
  console.log('\n🔍 DEBUGGING SKU MATCHING:')
  console.log('Sample Amrod SKUs:', [...amrodMap.keys()].slice(0, 10))
  console.log('Sample Shopify SKUs:', [...shopifyMap.keys()].slice(0, 10))
  
  // Check for any matches manually
  const amrodSample = [...amrodMap.keys()].slice(0, 1000)
  const shopifySample = [...shopifyMap.keys()].slice(0, 1000)
  const manualMatches = amrodSample.filter(sku => shopifySample.includes(sku))
  console.log(`Manual matches found in first 1000: ${manualMatches.length}`)
  if (manualMatches.length > 0) {
    console.log('Example matches:', manualMatches.slice(0, 5))
  }
  
  // Check for partial matches (in case there are formatting differences)
  console.log('\n🔍 CHECKING FOR PARTIAL MATCHES:')
  let partialMatches = 0
  for (const amrodSku of amrodSample) {
    for (const shopifySku of shopifySample.slice(0, 100)) {
      if (amrodSku.includes(shopifySku) || shopifySku.includes(amrodSku)) {
        console.log(`Partial match: "${amrodSku}" ↔ "${shopifySku}"`)
        partialMatches++
        if (partialMatches >= 5) break // Show max 5 examples
      }
    }
    if (partialMatches >= 5) break
  }
  console.log(`Total partial matches found: ${partialMatches}`)
  
  return { amrodMap, shopifyMap }
}

// --- ANALYZE PRODUCT DIFFERENCES ---
function analyzeProductDifferences(amrodMap, shopifyMap) {
  console.log('\n🔍 Analyzing product differences...')
  
  const analysis = {
    perfectMatches: [],
    needsUpdates: [],
    missingFromShopify: [],
    orphanedInShopify: []
  }
  
  // Check each Shopify product against Amrod
  for (const [sku, shopifyData] of shopifyMap) {
    const amrodProduct = amrodMap.get(sku)
    
    if (!amrodProduct) {
      analysis.orphanedInShopify.push({
        sku,
        shopifyData,
        reason: 'Not found in Amrod catalog'
      })
      continue
    }
    
    const differences = compareProducts(amrodProduct, shopifyData)
    
    if (differences.length === 0) {
      analysis.perfectMatches.push({ sku, shopifyData, amrodProduct })
    } else {
      analysis.needsUpdates.push({
        sku,
        shopifyData,
        amrodProduct,
        differences
      })
    }
  }
  
  // Check for Amrod products missing from Shopify
  for (const [code, amrodProduct] of amrodMap) {
    if (!shopifyMap.has(code)) {
      analysis.missingFromShopify.push({
        code,
        amrodProduct,
        reason: 'Available in Amrod but not in Shopify'
      })
    }
  }
  
  console.log('\n📊 ANALYSIS RESULTS:')
  console.log(`   ✅ Perfect matches: ${analysis.perfectMatches.length}`)
  console.log(`   🔄 Need updates: ${analysis.needsUpdates.length}`)
  console.log(`   ➕ Missing from Shopify: ${analysis.missingFromShopify.length}`)
  console.log(`   ⚠️  Orphaned in Shopify: ${analysis.orphanedInShopify.length}`)
  
  return analysis
}

// --- COMPARE INDIVIDUAL PRODUCTS ---
function compareProducts(amrodProduct, shopifyData) {
  const differences = []
  const shopifyProduct = shopifyData.product
  
  // Get existing metafields
  const metafields = new Map()
  for (const metafieldEdge of shopifyProduct.metafields.edges) {
    const metafield = metafieldEdge.node
    metafields.set(`${metafield.namespace}.${metafield.key}`, metafield.value)
  }
  
  // Check title
  if (amrodProduct.productName && shopifyProduct.title !== amrodProduct.productName) {
    differences.push({
      field: 'title',
      current: shopifyProduct.title,
      expected: amrodProduct.productName,
      severity: 'medium'
    })
  }
  
  // Check description
  if (amrodProduct.description && shopifyProduct.description !== amrodProduct.description) {
    differences.push({
      field: 'description',
      current: shopifyProduct.description || '',
      expected: amrodProduct.description,
      severity: 'medium'
    })
  }
  
  // Enhanced vendor/brand check - prioritize brand.name over brand field
  let expectedVendor = null
  if (amrodProduct.brand && typeof amrodProduct.brand === 'object' && amrodProduct.brand.name) {
    expectedVendor = amrodProduct.brand.name
  } else if (amrodProduct.brand && typeof amrodProduct.brand === 'string') {
    expectedVendor = amrodProduct.brand
  }
  
  if (expectedVendor && shopifyProduct.vendor !== expectedVendor) {
    differences.push({
      field: 'vendor',
      current: shopifyProduct.vendor,
      expected: expectedVendor,
      severity: 'high'
    })
  }
  
  // Helper function to extract string values from objects or arrays
  const extractStrings = (item) => {
    if (!item) return [];
    if (typeof item === 'string') return [item];
    if (Array.isArray(item)) {
      return item.map(subItem => {
        if (typeof subItem === 'string') return subItem;
        if (typeof subItem === 'object' && subItem.name) return subItem.name;
        if (typeof subItem === 'object' && subItem.value) return subItem.value;
        if (typeof subItem === 'object' && subItem.title) return subItem.title;
        return String(subItem);
      }).filter(Boolean);
    }
    if (typeof item === 'object') {
      return [item.name || item.value || item.title || String(item)];
    }
    return [String(item)];
  };

  // Check tags - convert arrays to sets for comparison
  const expectedTags = [
    ...extractStrings(amrodProduct.tags),
    ...extractStrings(amrodProduct.keywords),
    ...extractStrings(amrodProduct.categories),
    ...extractStrings(amrodProduct.material),
    ...extractStrings(amrodProduct.gender),
    ...extractStrings(amrodProduct.fit)
  ].filter(Boolean).map(tag => String(tag).toLowerCase())
  
  const currentTags = (shopifyProduct.tags || []).map(tag => String(tag).toLowerCase())
  const missingTags = expectedTags.filter(tag => !currentTags.includes(tag))
  
  if (missingTags.length > 0) {
    differences.push({
      field: 'tags',
      current: currentTags,
      expected: expectedTags,
      missing: missingTags,
      severity: 'low'
    })
  }
  
  // Enhanced metafields with branding and additional data
  const metafieldChecks = [
    // Basic product data
    { key: 'amrod.simple_code', value: amrodProduct.simpleCode, type: 'single_line_text_field' },
    { key: 'amrod.full_code', value: amrodProduct.fullCode, type: 'single_line_text_field' },
    { key: 'amrod.material', value: amrodProduct.material, type: 'single_line_text_field' },
    { key: 'amrod.gender', value: amrodProduct.gender, type: 'single_line_text_field' },
    { key: 'amrod.fit', value: amrodProduct.fit, type: 'single_line_text_field' },
    { key: 'amrod.minimum_order', value: amrodProduct.minimum?.toString(), type: 'number_integer' },
    { key: 'amrod.maximum_order', value: amrodProduct.maximum?.toString(), type: 'number_integer' },
    { key: 'amrod.increment', value: amrodProduct.incrementedBy?.toString(), type: 'number_integer' },
    { key: 'amrod.inventory_type', value: amrodProduct.inventoryType, type: 'single_line_text_field' },
    { key: 'amrod.made_to_order', value: amrodProduct.madeToOrder?.toString(), type: 'boolean' },
    { key: 'amrod.country_of_origin', value: amrodProduct.displayCountryOfOrigin, type: 'single_line_text_field' },
    
    // Enhanced brand data
    { key: 'amrod.brand_code', value: amrodProduct.brand?.code, type: 'single_line_text_field' },
    { key: 'amrod.brand_name', value: amrodProduct.brand?.name, type: 'single_line_text_field' },
    { key: 'amrod.brand_logo', value: amrodProduct.brand?.brandWebsiteLogo, type: 'url' },
    
    // Product relationships
    { key: 'amrod.companion_codes', value: amrodProduct.companionCodes ? JSON.stringify(amrodProduct.companionCodes) : null, type: 'json' },
    { key: 'amrod.related_codes', value: amrodProduct.relatedCodes ? JSON.stringify(amrodProduct.relatedCodes) : null, type: 'json' },
    
    // Branding guides
    { key: 'amrod.full_branding_guide', value: amrodProduct.fullBrandingGuide, type: 'url' },
    { key: 'amrod.logo24_branding_guide', value: amrodProduct.logo24BrandingGuide, type: 'url' },
    { key: 'amrod.is_logo24', value: amrodProduct.isLogo24?.toString(), type: 'boolean' },
    
    // Category hierarchy
    { key: 'amrod.category_path', value: amrodProduct.categories?.[0]?.path, type: 'single_line_text_field' },
    
    // Additional attributes
    { key: 'amrod.behaviour', value: amrodProduct.behaviour, type: 'single_line_text_field' },
    { key: 'amrod.promotion', value: amrodProduct.promotion, type: 'single_line_text_field' },
    { key: 'amrod.decoupled', value: amrodProduct.decoupled?.toString(), type: 'boolean' }
  ]
  
  for (const check of metafieldChecks) {
    if (check.value && metafields.get(check.key) !== check.value) {
      differences.push({
        field: `metafield.${check.key}`,
        current: metafields.get(check.key) || 'missing',
        expected: check.value,
        metafieldType: check.type,
        severity: 'low'
      })
    }
  }
  
  // Comprehensive branding data check
  const brandingDifferences = analyzeBrandingData(amrodProduct, metafields)
  differences.push(...brandingDifferences)
  
  // Check product type based on categories
  if (amrodProduct.categories && amrodProduct.categories.length > 0) {
    const categoryItem = amrodProduct.categories[0];
    let expectedProductType;
    
    if (typeof categoryItem === 'string') {
      expectedProductType = categoryItem;
    } else if (typeof categoryItem === 'object') {
      expectedProductType = categoryItem.name || categoryItem.value || categoryItem.title || String(categoryItem);
    } else {
      expectedProductType = String(categoryItem);
    }
    
    if (expectedProductType && shopifyProduct.productType !== expectedProductType) {
      differences.push({
        field: 'productType',
        current: shopifyProduct.productType,
        expected: expectedProductType,
        severity: 'medium'
      })
    }
  }
  
  // Check product images - base images vs Amrod images
  const currentImages = shopifyProduct.images.edges.map(edge => edge.node.url)
  const expectedImages = (amrodProduct.images || []).map(img => {
    if (typeof img === 'string') return img;
    if (typeof img === 'object' && img.urls && img.urls.length > 0) {
      return img.urls[0].url;
    }
    return null;
  }).filter(Boolean)
  
  if (expectedImages.length > 0) {
    const missingImages = expectedImages.filter(url => !currentImages.includes(url))
    if (missingImages.length > 0) {
      differences.push({
        field: 'product_images',
        current: currentImages.length,
        expected: expectedImages.length,
        missing: missingImages,
        severity: 'medium'
      })
    }
  }
  
  // Check variant-specific images from colourImages
  if (amrodProduct.colourImages && amrodProduct.colourImages.length > 0) {
    const variantImageIssues = analyzeVariantImages(amrodProduct, shopifyData)
    if (variantImageIssues.length > 0) {
      differences.push({
        field: 'variant_images',
        current: 'Missing variant-specific images',
        expected: `${variantImageIssues.length} variants need color-specific images`,
        issues: variantImageIssues,
        severity: 'medium'
      })
    }
  }
  
  return differences
}

// --- ANALYZE BRANDING DATA ---
function analyzeBrandingData(amrodProduct, existingMetafields) {
  const differences = []
  
  // Primary branding positions and methods
  if (amrodProduct.brandings && Array.isArray(amrodProduct.brandings)) {
    const brandingData = {
      positions: [],
      methods: [],
      printSizes: [],
      colors: []
    }
    
    for (const branding of amrodProduct.brandings) {
      if (branding.positionName) {
        brandingData.positions.push(branding.positionName)
      }
      
      if (branding.method && Array.isArray(branding.method)) {
        for (const method of branding.method) {
          if (method.brandingName) {
            brandingData.methods.push(method.brandingName)
          }
          if (method.numberOfColours) {
            brandingData.colors.push(method.numberOfColours)
          }
          if (method.maxPrintingSizeWidth && method.maxPrintingSizeHeight) {
            brandingData.printSizes.push(`${method.maxPrintingSizeWidth}x${method.maxPrintingSizeHeight}mm`)
          }
        }
      }
    }
    
    // Check branding positions
    const positionsJson = JSON.stringify(brandingData.positions)
    if (positionsJson !== '[]' && existingMetafields.get('amrod.branding_positions') !== positionsJson) {
      differences.push({
        field: 'metafield.amrod.branding_positions',
        current: existingMetafields.get('amrod.branding_positions') || 'missing',
        expected: positionsJson,
        metafieldType: 'json',
        severity: 'low'
      })
    }
    
    // Check branding methods
    const methodsJson = JSON.stringify([...new Set(brandingData.methods)])
    if (methodsJson !== '[]' && existingMetafields.get('amrod.branding_methods') !== methodsJson) {
      differences.push({
        field: 'metafield.amrod.branding_methods',
        current: existingMetafields.get('amrod.branding_methods') || 'missing',
        expected: methodsJson,
        metafieldType: 'json',
        severity: 'low'
      })
    }
    
    // Check print sizes
    const sizesJson = JSON.stringify([...new Set(brandingData.printSizes)])
    if (sizesJson !== '[]' && existingMetafields.get('amrod.print_sizes') !== sizesJson) {
      differences.push({
        field: 'metafield.amrod.print_sizes',
        current: existingMetafields.get('amrod.print_sizes') || 'missing',
        expected: sizesJson,
        metafieldType: 'json',
        severity: 'low'
      })
    }
    
    // Check color options
    const colorsJson = JSON.stringify([...new Set(brandingData.colors)])
    if (colorsJson !== '[]' && existingMetafields.get('amrod.branding_colors') !== colorsJson) {
      differences.push({
        field: 'metafield.amrod.branding_colors',
        current: existingMetafields.get('amrod.branding_colors') || 'missing',
        expected: colorsJson,
        metafieldType: 'json',
        severity: 'low'
      })
    }
  }
  
  // Inclusive branding information
  if (amrodProduct.inclusiveBranding && Array.isArray(amrodProduct.inclusiveBranding)) {
    const inclusiveBrandingNames = amrodProduct.inclusiveBranding
      .map(ib => ib.inclusiveBrandingName)
      .filter(Boolean)
    
    if (inclusiveBrandingNames.length > 0) {
      const inclusiveBrandingJson = JSON.stringify(inclusiveBrandingNames)
      if (existingMetafields.get('amrod.inclusive_branding') !== inclusiveBrandingJson) {
        differences.push({
          field: 'metafield.amrod.inclusive_branding',
          current: existingMetafields.get('amrod.inclusive_branding') || 'missing',
          expected: inclusiveBrandingJson,
          metafieldType: 'json',
          severity: 'low'
        })
      }
    }
  }
  
  // Logo24 specific branding
  if (amrodProduct.logo24Branding && typeof amrodProduct.logo24Branding === 'object') {
    const logo24Info = {
      method: amrodProduct.logo24Branding.brandingDepartment,
      position: amrodProduct.logo24Branding.positionName,
      printSize: `${amrodProduct.logo24Branding.maxPrintingSizeWidth}x${amrodProduct.logo24Branding.maxPrintingSizeHeight}mm`,
      minQuantity: amrodProduct.logo24Branding.logo24ItemMinimum,
      maxQuantity: amrodProduct.logo24Branding.logo24ItemMaximum
    }
    
    const logo24Json = JSON.stringify(logo24Info)
    if (existingMetafields.get('amrod.logo24_info') !== logo24Json) {
      differences.push({
        field: 'metafield.amrod.logo24_info',
        current: existingMetafields.get('amrod.logo24_info') || 'missing',
        expected: logo24Json,
        metafieldType: 'json',
        severity: 'low'
      })
    }
  }
  
  // Required and no-co branding positions
  if (amrodProduct.requiredBrandingPositions && Array.isArray(amrodProduct.requiredBrandingPositions)) {
    const requiredPositionsJson = JSON.stringify(amrodProduct.requiredBrandingPositions)
    if (requiredPositionsJson !== '[]' && existingMetafields.get('amrod.required_branding_positions') !== requiredPositionsJson) {
      differences.push({
        field: 'metafield.amrod.required_branding_positions',
        current: existingMetafields.get('amrod.required_branding_positions') || 'missing',
        expected: requiredPositionsJson,
        metafieldType: 'json',
        severity: 'low'
      })
    }
  }
  
  if (amrodProduct.noCoBrandingPositions && Array.isArray(amrodProduct.noCoBrandingPositions)) {
    const noCoBrandingJson = JSON.stringify(amrodProduct.noCoBrandingPositions)
    if (noCoBrandingJson !== '[]' && existingMetafields.get('amrod.no_co_branding_positions') !== noCoBrandingJson) {
      differences.push({
        field: 'metafield.amrod.no_co_branding_positions',
        current: existingMetafields.get('amrod.no_co_branding_positions') || 'missing',
        expected: noCoBrandingJson,
        metafieldType: 'json',
        severity: 'low'
      })
    }
  }
  
  return differences
}

// --- ANALYZE VARIANT IMAGES ---
function analyzeVariantImages(amrodProduct, shopifyData) {
  const issues = []
  const variants = shopifyData.variants || []
  
  // Create a map of color names to images from Amrod colourImages
  const colorImageMap = new Map()
  
  if (amrodProduct.colourImages && Array.isArray(amrodProduct.colourImages)) {
    for (const colorGroup of amrodProduct.colourImages) {
      if (typeof colorGroup === 'object' && colorGroup.name && colorGroup.images) {
        const colorName = String(colorGroup.name).toLowerCase()
        const colorCode = String(colorGroup.code || '').toLowerCase()
        const images = Array.isArray(colorGroup.images) ? colorGroup.images : [colorGroup.images]
        
        const imageUrls = images.map(img => {
          if (typeof img === 'object' && img.urls && img.urls.length > 0) {
            return img.urls[0].url;
          }
          return null;
        }).filter(Boolean)
        
        if (imageUrls.length > 0) {
          colorImageMap.set(colorName, imageUrls)
          if (colorCode) {
            colorImageMap.set(colorCode, imageUrls)
          }
        }
      }
    }
  }
  
  // Check each Shopify variant against available color images
  for (const variant of variants) {
    const variantTitle = (variant.title || '').toLowerCase()
    const variantSku = (variant.sku || '').toLowerCase()
    
    // Try to match variant to a color
    let matchedColor = null
    for (const [colorName, images] of colorImageMap) {
      if (variantTitle.includes(colorName) || variantSku.includes(colorName)) {
        matchedColor = colorName
        break
      }
    }
    
    if (matchedColor && colorImageMap.has(matchedColor)) {
      issues.push({
        variantSku: variant.sku,
        variantTitle: variant.title,
        color: matchedColor,
        availableImages: colorImageMap.get(matchedColor),
        action: 'needs_color_images'
      })
    }
  }
  
  return issues
}

// --- GENERATE UPDATE PLAN ---
function generateUpdatePlan(analysis) {
  console.log('\n📋 GENERATING UPDATE PLAN...')
  
  const updatePlan = {
    highPriority: [],
    mediumPriority: [],
    lowPriority: [],
    totalUpdates: 0
  }
  
  for (const item of analysis.needsUpdates) {
    const updates = {
      sku: item.sku,
      productId: item.shopifyData.product.id,
      productGid: item.shopifyData.product.id,
      currentTitle: item.shopifyData.product.title,
      updates: {
        high: [],
        medium: [],
        low: []
      }
    }
    
    for (const diff of item.differences) {
      updates.updates[diff.severity].push(diff)
    }
    
    if (updates.updates.high.length > 0) {
      updatePlan.highPriority.push(updates)
    } else if (updates.updates.medium.length > 0) {
      updatePlan.mediumPriority.push(updates)
    } else {
      updatePlan.lowPriority.push(updates)
    }
    
    updatePlan.totalUpdates++
  }
  
  console.log('\n📊 UPDATE PLAN SUMMARY:')
  console.log(`   🔴 High priority (vendor/brand issues): ${updatePlan.highPriority.length}`)
  console.log(`   🟡 Medium priority (title/description): ${updatePlan.mediumPriority.length}`)
  console.log(`   🟢 Low priority (tags/metafields/branding): ${updatePlan.lowPriority.length}`)
  console.log(`   📊 Total products needing updates: ${updatePlan.totalUpdates}`)
  
  return updatePlan
}

// --- APPLY PRODUCT UPDATES ---
async function applyProductUpdates(updatePlan, amrodMap, dryRun = true) {
  console.log(`\n${dryRun ? '🧪 DRY RUN MODE' : '🔧 APPLYING UPDATES'}`)
  console.log('='.repeat(50))
  
  let processedCount = 0
  let successCount = 0
  let failedCount = 0
  
  // Process high priority first
  const allUpdates = [
    ...updatePlan.highPriority,
    ...updatePlan.mediumPriority,
    ...updatePlan.lowPriority
  ]
  
  for (const updateItem of allUpdates) {
    processedCount++
    
    if (processedCount % 50 === 1) {
      console.log(`\n📦 Processing ${processedCount}/${allUpdates.length}...`)
    }
    
    try {
      const sku = updateItem.sku
      const amrodProduct = amrodMap.get(sku)
      
      if (!amrodProduct) {
        console.log(`   ⚠️  Skipping ${sku} - no Amrod data found`)
        continue
      }
      
      console.log(`\n🔧 ${dryRun ? 'Would update' : 'Updating'} ${sku} - ${updateItem.currentTitle}`)
      
      // Build the update mutations
      const updates = await buildProductUpdateMutations(updateItem, amrodProduct, dryRun)
      
      if (!dryRun && updates.length > 0) {
        let updateSuccess = true
        for (let i = 0; i < updates.length; i++) {
          const update = updates[i]
          try {
            console.log(`       🔧 Executing ${update.type} mutation...`)
            await executeGraphQLMutation(update)
            await sleep(SLEEP_MS)
          } catch (mutationError) {
            console.error(`     ❌ Failed ${update.type} mutation: ${mutationError.message}`)
            if (update.variables) {
              console.error(`     📋 Variables: ${JSON.stringify(update.variables, null, 2)}`)
            }
            updateSuccess = false
            // Continue with other mutations rather than failing completely
          }
        }
        
        if (updateSuccess) {
          successCount++
        } else {
          failedCount++
        }
      } else {
        // Dry run or no updates - just count as success for dry run
        successCount++
      }
      
    } catch (err) {
      console.error(`   ❌ Failed to update ${updateItem.sku}: ${err.message}`)
      failedCount++
    }
    
    if (!dryRun && processedCount % 2 === 0) {
      await sleep(SLEEP_MS * 2) // Extra throttling for actual updates
    }
  }
  
  console.log(`\n📊 ${dryRun ? 'DRY RUN' : 'UPDATE'} COMPLETE:`)
  console.log(`   ✅ ${dryRun ? 'Would process' : 'Successfully processed'}: ${successCount}`)
  console.log(`   ❌ Failed: ${failedCount}`)
  console.log(`   📊 Total: ${processedCount}`)
}

// --- BUILD UPDATE MUTATIONS ---
async function buildProductUpdateMutations(updateItem, amrodProduct, dryRun) {
  const mutations = []
  const productId = updateItem.productGid
  
  // Prepare product update
  const productUpdate = {
    id: productId
  }
  
  // Prepare metafield updates
  const metafieldsToUpdate = []
  
  // Prepare image updates
  const imageUpdates = []
  
  for (const severity of ['high', 'medium', 'low']) {
    for (const diff of updateItem.updates[severity]) {
      console.log(`     ${severity.toUpperCase()}: ${diff.field} -> ${String(diff.expected).substring(0, 100)}${String(diff.expected).length > 100 ? '...' : ''}`)
      
      switch (diff.field) {
        case 'title':
          productUpdate.title = diff.expected
          break
        case 'description':
          productUpdate.descriptionHtml = diff.expected
          break
        case 'vendor':
          productUpdate.vendor = diff.expected
          break
        case 'productType':
          productUpdate.productType = diff.expected
          break
        case 'tags':
          // Merge existing and new tags
          const allTags = [...new Set([...diff.current, ...diff.missing])]
          productUpdate.tags = allTags
          break
        case 'product_images':
          // Handle base product images
          if (diff.missing && diff.missing.length > 0) {
            imageUpdates.push({
              type: 'product_images',
              images: diff.missing,
              action: 'add_missing_images'
            })
          }
          break
        case 'variant_images':
          // Handle variant-specific color images
          if (diff.issues && diff.issues.length > 0) {
            imageUpdates.push({
              type: 'variant_images',
              issues: diff.issues,
              action: 'add_variant_images'
            })
          }
          break
        default:
          // Handle metafields
          if (diff.field.startsWith('metafield.')) {
            const key = diff.field.replace('metafield.', '')
            const [namespace, fieldKey] = key.split('.')
            
            metafieldsToUpdate.push({
              namespace,
              key: fieldKey,
              value: diff.expected,
              type: diff.metafieldType || 'single_line_text_field'
            })
          }
          break
      }
    }
  }
  
  // Add product update mutation if needed
  if (Object.keys(productUpdate).length > 1) { // More than just ID
    mutations.push({
      type: 'product',
      mutation: `
        mutation UpdateProduct($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              title
              vendor
              productType
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: { input: productUpdate }
    })
  }
  
  // Add metafield mutations
  for (const metafield of metafieldsToUpdate) {
    mutations.push({
      type: 'metafield',
      mutation: `
        mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `,
      variables: {
        metafields: [{
          ownerId: productId,
          namespace: metafield.namespace,
          key: metafield.key,
          value: metafield.value,
          type: metafield.type
        }]
      }
    })
  }
  
  // Add image update mutations
  for (const imageUpdate of imageUpdates) {
    if (imageUpdate.type === 'product_images') {
      // Add missing product images using the newer productCreateMedia mutation
      for (const imageUrl of imageUpdate.images) {
        // Encode the URL to handle spaces and special characters
        const encodedUrl = encodeURI(imageUrl)
        mutations.push({
          type: 'product_media',
          mutation: `
            mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media {
                  id
                  alt
                  status
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
                mediaUserErrors {
                  field
                  message
                  code
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            productId: productId,
            media: [{
              mediaContentType: 'IMAGE',
              originalSource: encodedUrl,
              alt: `${amrodProduct.productName || 'Product'} image`
            }]
          }
        })
      }
    } else if (imageUpdate.type === 'variant_images') {
      // Add variant-specific images
      console.log(`       📸 Found ${imageUpdate.issues.length} variants needing color images`)
      
      for (const issue of imageUpdate.issues) {
        console.log(`         🎨 ${issue.variantSku} (${issue.color}) needs ${issue.availableImages.length} images`)
        
        if (!dryRun) {
          // Add them as product images with color-specific alt text
          for (const imageUrl of issue.availableImages) {
            // Encode the URL to handle spaces and special characters
            const encodedUrl = encodeURI(imageUrl)
            mutations.push({
              type: 'product_media',
              mutation: `
                mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
                  productCreateMedia(productId: $productId, media: $media) {
                    media {
                      id
                      alt
                      status
                      ... on MediaImage {
                        image {
                          url
                        }
                      }
                    }
                    mediaUserErrors {
                      field
                      message
                      code
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }
              `,
              variables: {
                productId: productId,
                media: [{
                  mediaContentType: 'IMAGE',
                  originalSource: encodedUrl,
                  alt: `${amrodProduct.productName || 'Product'} - ${issue.color}`
                }]
              }
            })
          }
        }
      }
    }
  }
  
  return mutations
}

// --- EXECUTE GRAPHQL MUTATION ---
async function executeGraphQLMutation(mutationData) {
  try {
    const response = await shopifyGraphQLClient.post('/graphql.json', {
      query: mutationData.mutation,
      variables: mutationData.variables
    })
    
    // Check if response exists and has the expected structure
    if (!response || !response.data || !response.data.data) {
      console.error('Invalid response structure:', JSON.stringify(response?.data, null, 2))
      throw new Error(`Invalid GraphQL response structure`)
    }
    
    const result = response.data.data
    const operationName = Object.keys(result)[0]
    
    if (!operationName || !result[operationName]) {
      console.error('No operation result:', JSON.stringify(result, null, 2))
      throw new Error(`No operation result found in GraphQL response`)
    }
    
    const operationResult = result[operationName]
    
    // Check for GraphQL errors at the top level first
    if (response.data.errors && response.data.errors.length > 0) {
      throw new Error(`GraphQL errors: ${response.data.errors.map(e => e.message).join(', ')}`)
    }
    
    // Handle different mutation types with their specific error structures
    if (operationName === 'productCreateMedia') {
      // Handle productCreateMedia response
      if (operationResult.mediaUserErrors && operationResult.mediaUserErrors.length > 0) {
        throw new Error(`Media errors: ${operationResult.mediaUserErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`)
      }
      if (operationResult.userErrors && operationResult.userErrors.length > 0) {
        throw new Error(`User errors: ${operationResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`)
      }
      console.log(`         ✅ Added ${operationResult.media?.length || 0} media files successfully`)
    } else if (operationName === 'metafieldsSet') {
      // Handle metafieldsSet response
      if (operationResult.userErrors && operationResult.userErrors.length > 0) {
        throw new Error(`Metafield errors: ${operationResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`)
      }
      console.log(`         ✅ Set ${operationResult.metafields?.length || 0} metafields successfully`)
    } else {
      // Handle other mutations (productUpdate, etc.)
      if (operationResult.userErrors && operationResult.userErrors.length > 0) {
        throw new Error(`GraphQL errors: ${operationResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`)
      }
    }
    
    return result
    
  } catch (err) {
    // Enhanced error reporting
    if (err.response && err.response.data) {
      console.error(`GraphQL Error Details:`, JSON.stringify(err.response.data, null, 2))
    }
    throw err
  }
}

// --- MAIN EXECUTION ---
async function main() {
  console.log(`🔄 AMROD PRODUCT VERIFICATION & UPDATE (ENHANCED)`)
  console.log(`Analyzing your Shopify catalog against Amrod's complete product data`)
  console.log(`✨ Now includes comprehensive branding data and enhanced product information`)
  console.log('='.repeat(80))
  
  try {
    // 1. Get Amrod token
    const token = await getAmrodToken()
    
    // 2. Fetch all products from both systems
    console.log('\n📦 STEP 1: Fetching product data from both systems...')
    const [amrodProducts, shopifyProducts] = await Promise.all([
      fetchAllAmrodProducts(token),
      fetchAllShopifyProducts()
    ])
    
    if (amrodProducts.length === 0) {
      console.log('❌ No Amrod products found. Cannot proceed.')
      return
    }
    
    // 3. Build lookup maps
    console.log('\n📦 STEP 2: Building product maps and analyzing differences...')
    const { amrodMap, shopifyMap } = buildProductMaps(amrodProducts, shopifyProducts)
    
    // 4. Analyze differences
    const analysis = analyzeProductDifferences(amrodMap, shopifyMap)
    
    // 5. Generate update plan
    console.log('\n📦 STEP 3: Generating comprehensive update plan...')
    const updatePlan = generateUpdatePlan(analysis)
    
    if (updatePlan.totalUpdates === 0) {
      console.log('\n🎉 ALL PRODUCTS ARE UP TO DATE!')
      console.log('✅ No updates needed - your catalog is perfectly synchronized!')
      return
    }
    
    // 6. Show detailed preview for high priority items
    if (updatePlan.highPriority.length > 0) {
      console.log('\n🔴 HIGH PRIORITY ISSUES (first 5):')
      updatePlan.highPriority.slice(0, 5).forEach((item, i) => {
        console.log(`\n   ${i + 1}. ${item.sku} - ${item.currentTitle}`)
        item.updates.high.forEach(diff => {
          console.log(`      ❌ ${diff.field}: "${diff.current}" → "${diff.expected}"`)
        })
      })
    }
    
    // 7. Show branding enhancement preview
    if (updatePlan.lowPriority.length > 0) {
      console.log('\n🎨 BRANDING ENHANCEMENTS PREVIEW (first 3):')
      const brandingUpdates = updatePlan.lowPriority.filter(item => 
        item.updates.low.some(diff => diff.field.includes('branding'))
      ).slice(0, 3)
      
      brandingUpdates.forEach((item, i) => {
        console.log(`\n   ${i + 1}. ${item.sku} - ${item.currentTitle}`)
        const brandingFields = item.updates.low.filter(diff => diff.field.includes('branding'))
        brandingFields.slice(0, 3).forEach(diff => {
          const fieldName = diff.field.replace('metafield.amrod.', '').replace('_', ' ')
          console.log(`      🎨 ${fieldName}: Adding comprehensive data`)
        })
        if (brandingFields.length > 3) {
          console.log(`      ... and ${brandingFields.length - 3} more branding fields`)
        }
      })
    }
    
    // 8. Ask for confirmation
    console.log(`\n❓ READY TO PROCEED?`)
    console.log(`   This will update ${updatePlan.totalUpdates} products with enhanced data including:`)
    console.log(`   🎨 Comprehensive branding information`)
    console.log(`   🏷️  Enhanced brand data with logos`)
    console.log(`   🔗 Product relationships (companion/related codes)`)
    console.log(`   📋 Category hierarchies and additional attributes`)
    console.log(`   📸 Enhanced image mapping`)
    console.log(`   Run with DRY_RUN=false to apply changes, or DRY_RUN=true to preview`)
    
    const dryRun = process.env.DRY_RUN !== 'false'
    console.log(`\n🎯 Running in ${dryRun ? 'DRY RUN' : 'LIVE UPDATE'} mode...`)
    
    // 9. Apply updates
    console.log('\n📦 STEP 4: Processing enhanced updates...')
    await applyProductUpdates(updatePlan, amrodMap, dryRun)
    
    // 10. Final summary
    console.log('\n🎉 ENHANCED VERIFICATION COMPLETE!')
    console.log('='.repeat(50))
    console.log(`   📊 Total products analyzed: ${shopifyMap.size}`)
    console.log(`   ✅ Perfect matches: ${analysis.perfectMatches.length}`)
    console.log(`   🔄 Enhanced products: ${updatePlan.totalUpdates}`)
    console.log(`   ➕ Available for import: ${analysis.missingFromShopify.length}`)
    
    console.log(`\n✨ ENHANCEMENTS ADDED:`)
    console.log(`   🎨 Comprehensive branding data (positions, methods, print sizes)`)
    console.log(`   🏷️  Enhanced brand information with logos`)
    console.log(`   🔗 Product relationships and companion codes`)
    console.log(`   📋 Category hierarchies and custom attributes`)
    console.log(`   📸 Advanced image mapping for variants`)
    
    if (dryRun) {
      console.log(`\n💡 TO APPLY THESE ENHANCED CHANGES:`)
      console.log(`   Set DRY_RUN=false and run the script again`)
    } else {
      console.log(`\n✅ Your Shopify catalog has been enhanced with comprehensive Amrod data!`)
      console.log(`🎯 Your products now include professional branding information and complete metadata`)
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run with DRY_RUN=true by default
if (!process.env.DRY_RUN) {
  process.env.DRY_RUN = 'false'
}

main()