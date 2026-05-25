import 'dotenv/config'
import axios from 'axios'

// --- CONFIG ---
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-04`
const SLEEP_MS = 300

// --- Axios Clients ---
const shopifyGraphQLClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 60000
})

const sleep = ms => new Promise(r => setTimeout(r, ms))

// --- FIND PRODUCTS WITH DEFAULT VARIANTS ---
async function findProductsWithDefaultVariants() {
  console.log('🔍 Finding products with "Default" variants...')
  
  let problemProducts = []
  let hasNextPage = true
  let cursor = null
  let batchCount = 0
  
  const query = `
    query GetProductsWithVariants($first: Int!, $after: String) {
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
            publishedAt
            options {
              id
              name
              values
              position
            }
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
            variantsCount {
              count
            }
          }
        }
      }
    }
  `
  
  while (hasNextPage) {
    batchCount++
    console.log(`   📦 Scanning batch ${batchCount}...`)
    
    try {
      const variables = {
        first: 50,
        after: cursor
      }
      
      const response = await shopifyGraphQLClient.post('/graphql.json', {
        query,
        variables
      })
      
      const data = response.data.data
      const products = data.products.edges
      
      if (!products.length) break
      
      for (const productEdge of products) {
        const product = productEdge.node
        
        // Check if this product has problematic variants
        if (product.variantsCount.count === 1 && product.variants.edges.length > 0) {
          const variant = product.variants.edges[0].node
          const selectedOptions = variant.selectedOptions || []
          
          // Check for default-like variants
          const hasDefaultVariant = selectedOptions.some(option => 
            option.value.toLowerCase() === 'default' ||
            option.value.toLowerCase() === 'select colour' ||
            option.name.toLowerCase().includes('title') ||
            (option.name.toLowerCase() === 'color' && option.value.toLowerCase() === 'default') ||
            (option.name.toLowerCase() === 'colour' && option.value.toLowerCase() === 'default')
          )
          
          if (hasDefaultVariant || (product.options.length === 1 && 
                                   product.options[0].values.length === 1 && 
                                   product.options[0].values[0].toLowerCase() === 'default')) {
            problemProducts.push({
              productId: product.id.replace('gid://shopify/Product/', ''),
              productGid: product.id,
              title: product.title,
              vendor: product.vendor,
              status: product.status,
              published: product.publishedAt ? true : false,
              variant: {
                id: variant.id.replace('gid://shopify/ProductVariant/', ''),
                gid: variant.id,
                title: variant.title,
                sku: variant.sku,
                price: variant.price,
                selectedOptions: selectedOptions
              },
              options: product.options,
              reason: hasDefaultVariant ? 'Has default variant value' : 'Single option with default value'
            })
          }
        }
      }
      
      hasNextPage = data.products.pageInfo.hasNextPage
      cursor = data.products.pageInfo.endCursor
      
      await sleep(SLEEP_MS)
      
    } catch (err) {
      console.error('❌ Error scanning products:', err.response?.status, err.response?.data)
      break
    }
  }
  
  console.log(`✅ Found ${problemProducts.length} products with default variants`)
  return problemProducts
}

// --- CONVERT TO SIMPLE PRODUCT ---
async function convertToSimpleProduct(product) {
  console.log(`🔧 Converting "${product.title}" to simple product...`)
  
  try {
    // Step 1: Update the variant to remove the title and make it the default
    const updateVariantMutation = `
      mutation UpdateVariant($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
            title
            sku
            price
          }
          userErrors {
            field
            message
          }
        }
      }
    `
    
    const variantResponse = await shopifyGraphQLClient.post('/graphql.json', {
      query: updateVariantMutation,
      variables: {
        input: {
          id: product.variant.gid,
          title: null // This will reset the variant title to be auto-generated
        }
      }
    })
    
    if (variantResponse.data.data.productVariantUpdate.userErrors.length > 0) {
      console.error(`❌ Error updating variant for ${product.title}:`, variantResponse.data.data.productVariantUpdate.userErrors)
      return { success: false, error: 'Variant update failed' }
    }
    
    // Step 2: Delete the product options to convert to simple product
    const deleteOptionsMutation = `
      mutation DeleteProductOptions($productId: ID!, $options: [ID!]!) {
        productOptionsDelete(productId: $productId, options: $options) {
          product {
            id
            title
            options {
              id
              name
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `
    
    // Get option IDs to delete
    const optionIds = product.options.map(option => option.id)
    
    if (optionIds.length > 0) {
      const optionsResponse = await shopifyGraphQLClient.post('/graphql.json', {
        query: deleteOptionsMutation,
        variables: {
          productId: product.productGid,
          options: optionIds
        }
      })
      
      if (optionsResponse.data.data.productOptionsDelete.userErrors.length > 0) {
        console.error(`❌ Error deleting options for ${product.title}:`, optionsResponse.data.data.productOptionsDelete.userErrors)
        return { success: false, error: 'Option deletion failed' }
      }
    }
    
    console.log(`✅ Successfully converted "${product.title}" to simple product`)
    return { success: true }
    
  } catch (err) {
    console.error(`❌ Exception converting ${product.title}:`, err.message)
    return { success: false, error: err.message }
  }
}

// --- BATCH CONVERT PRODUCTS ---
async function batchConvertToSimpleProducts(products) {
  console.log(`\n🔄 BATCH CONVERSION TO SIMPLE PRODUCTS`)
  console.log('='.repeat(50))
  
  if (products.length === 0) {
    console.log('📝 No products need conversion')
    return { converted: 0, failed: 0 }
  }
  
  console.log(`📊 Products to convert: ${products.length}`)
  console.log(`💡 This will remove unnecessary variant options and convert to simple products`)
  
  let converted = 0
  let failed = 0
  
  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    console.log(`\n📦 Converting ${i + 1}/${products.length}: "${product.title}"`)
    console.log(`   SKU: ${product.variant.sku}`)
    console.log(`   Current variant: ${product.variant.title}`)
    console.log(`   Options: ${product.options.map(o => `${o.name}: [${o.values.join(', ')}]`).join(', ')}`)
    
    const result = await convertToSimpleProduct(product)
    
    if (result.success) {
      converted++
    } else {
      failed++
      console.log(`   ❌ Conversion failed: ${result.error}`)
    }
    
    // Rate limiting
    await sleep(SLEEP_MS)
    
    // Progress update
    if ((i + 1) % 10 === 0) {
      console.log(`\n📊 Progress: ${i + 1}/${products.length} processed (${converted} converted, ${failed} failed)`)
    }
  }
  
  console.log(`\n🎉 BATCH CONVERSION COMPLETE!`)
  console.log(`   ✅ Successfully converted: ${converted}`)
  console.log(`   ❌ Failed conversions: ${failed}`)
  console.log(`   📈 Success rate: ${((converted/(converted+failed))*100).toFixed(1)}%`)
  
  return { converted, failed }
}

// --- SHOW ANALYSIS RESULTS ---
function showAnalysisResults(products) {
  console.log(`\n📊 DEFAULT VARIANT ANALYSIS:`)
  console.log('='.repeat(60))
  
  console.log(`\n🎯 PRODUCTS WITH DEFAULT VARIANTS (${products.length}):`)
  console.log(`   These should be converted to simple products`)
  
  // Group by vendor for better analysis
  const byVendor = new Map()
  for (const product of products) {
    const vendor = product.vendor || 'No Vendor'
    if (!byVendor.has(vendor)) {
      byVendor.set(vendor, [])
    }
    byVendor.get(vendor).push(product)
  }
  
  console.log(`\n📈 BREAKDOWN BY VENDOR:`)
  for (const [vendor, vendorProducts] of byVendor) {
    console.log(`   ${vendor}: ${vendorProducts.length} products`)
  }
  
  console.log(`\n🔍 SAMPLE PRODUCTS (first 10):`)
  products.slice(0, 10).forEach((product, index) => {
    console.log(`   ${index + 1}. "${product.title}" (${product.vendor || 'No Vendor'})`)
    console.log(`      SKU: ${product.variant.sku}`)
    console.log(`      Variant: ${product.variant.title}`)
    console.log(`      Options: ${product.options.map(o => `${o.name}=[${o.values.join(', ')}]`).join(', ')}`)
    console.log(`      Reason: ${product.reason}`)
    console.log('')
  })
  
  if (products.length > 10) {
    console.log(`   ... and ${products.length - 10} more products`)
  }
  
  // Show different types of default variants
  const reasonCounts = new Map()
  for (const product of products) {
    const reason = product.reason
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
  }
  
  console.log(`\n🏷️  TYPES OF DEFAULT VARIANTS:`)
  for (const [reason, count] of reasonCounts) {
    console.log(`   ${reason}: ${count} products`)
  }
}

// --- MAIN EXECUTION ---
async function main() {
  console.log(`🔍 DEFAULT VARIANT FIXER`)
  console.log(`Finding and fixing products with unnecessary "Default" variants`)
  console.log(`This will convert them back to simple products without variants`)
  console.log('='.repeat(80))
  
  try {
    // 1. Find products with default variants
    const productsWithDefaults = await findProductsWithDefaultVariants()
    
    if (productsWithDefaults.length === 0) {
      console.log('\n🎉 NO DEFAULT VARIANTS FOUND!')
      console.log('✅ All products are properly configured!')
      return
    }
    
    // 2. Show analysis
    showAnalysisResults(productsWithDefaults)
    
    // 3. Summary
    console.log(`\n💡 CONVERSION SUMMARY:`)
    console.log('='.repeat(50))
    
    const total = productsWithDefaults.length
    
    console.log(`\n📊 BREAKDOWN:`)
    console.log(`   Total products with default variants: ${total}`)
    console.log(`   These will be converted to simple products`)
    console.log(`   (Removing unnecessary options and variant titles)`)
    
    console.log(`\n🎯 BENEFITS OF CONVERSION:`)
    console.log(`   ✅ Cleaner product structure`)
    console.log(`   ✅ No confusing "Select colour: Default" dropdowns`)
    console.log(`   ✅ Simpler inventory management`)
    console.log(`   ✅ Better customer experience`)
    
    // 4. Execute conversion
    console.log(`\n🚀 Starting automatic conversion...`)
    await batchConvertToSimpleProducts(productsWithDefaults)
    
    console.log(`\n✅ DEFAULT VARIANT CLEANUP COMPLETE!`)
    console.log(`   Your products now have proper simple product structure`)
    console.log(`   No more unnecessary "Default" variant dropdowns!`)
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run the main function
main()