import 'dotenv/config';
import axios from 'axios';

// Config
const AMROD_AUTH_URL   = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL   = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}`;

// Sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Text helpers
function slugify(text) {
  return String(text||'').toLowerCase().trim()
    .replace(/\s+/g,'-')
    .replace(/[^\w-]+/g,'')
    .replace(/-+/g,'-');
}

// HTTP clients
const amrodClient = axios.create({
  baseURL: AMROD_BASE_URL,
  headers:{ 'Content-Type':'application/json','Accept':'application/json' }
});
const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers:{
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type':'application/json',
    'Accept':'application/json'
  },
  timeout:60000
});

// Auth functions (from your template)
async function testAuth() {
  console.log('▶ testAuth');
  try {
    const res = await shopifyClient.get('/shop.json');
    console.log('✅ Shopify auth OK:', res.data.shop.name);
  } catch (err) {
    console.error('❌ Shopify auth failed:', err.response?.data||err.message);
    process.exit(1);
  }
}

async function getAmrodToken() {
  console.log('▶ getAmrodToken');
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  if (!AMROD_EMAIL||!AMROD_PASSWORD||!AMROD_CUSTOMER_CODE) {
    console.error('❌ Missing Amrod credentials');
    process.exit(1);
  }
  try {
    const res = await axios.post(AMROD_AUTH_URL, {
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    });
    const token = res.data.token||res.data.access_token;
    if (!token) throw new Error('No token returned');
    console.log('✅ Amrod token received');
    return token;
  } catch (err) {
    console.error('❌ Amrod auth failed:', err.response?.data||err.message);
    process.exit(1);
  }
}

// Fetch branding prices from Amrod
async function fetchBrandingPrices(token) {
  console.log('▶ fetchBrandingPrices');
  const res = await amrodClient.get('/BrandingPrices', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = Array.isArray(res.data) ? res.data : res.data.BrandingPrices || [];
  console.log(`✅ ${data.length} branding price items fetched`);
  return data;
}

// Method type classification
function getMethodType(brandingCode) {
  const code = String(brandingCode || '').toUpperCase();
  
  // Embroidery codes
  if (code.startsWith('EM') || code.startsWith('EMB')) {
    return 'embroidery';
  }
  
  // Screen Print codes  
  if (code.startsWith('SP') || code.startsWith('SA') || code.startsWith('SB') || 
      code.startsWith('SC') || code.startsWith('SW')) {
    return 'screenprint';
  }
  
  // Pad Print codes
  if (code.startsWith('PA') || code.startsWith('PB') || code.startsWith('PC') || 
      code.startsWith('PW')) {
    return 'padprint';
  }
  
  // Laser codes
  if (code.startsWith('LA') || code.startsWith('LB') || code.startsWith('LC') || 
      code.startsWith('LG') || code.startsWith('LS')) {
    return 'laser';
  }
  
  // Digital codes
  if (code.startsWith('DA') || code.startsWith('DB') || code.startsWith('DC') || 
      code.startsWith('DDT') || code.startsWith('DP') || code.startsWith('DTC') || 
      code.startsWith('DV') || code.startsWith('DNB') || code.startsWith('DCB') || 
      code.startsWith('DCP') || code.startsWith('DD')) {
    return 'digital';
  }
  
  // Everything else
  return 'other';
}

// Group pricing data by method type
function groupBrandingByMethodType(brandingPrices) {
  const groups = {
    embroidery: new Map(),
    screenprint: new Map(), 
    padprint: new Map(),
    laser: new Map(),
    digital: new Map(),
    other: new Map(),
    setupFees: new Set()
  };
  
  brandingPrices.forEach(item => {
    const brandingCode = item.brandingCode;
    const methodType = getMethodType(brandingCode);
    
    // Process each price break
    item.data.forEach(priceBreak => {
      const unitPrice = parseFloat(priceBreak.price) || 0;
      const setupCost = parseFloat(priceBreak.setup) || 0;
      
      // Round branding price to nearest R1.00, keep setup exact
      const roundedPrice = Math.ceil(unitPrice);
      
      // Add setup cost to set (will be deduplicated)
      if (setupCost > 0) {
        groups.setupFees.add(setupCost);
      }
      
      // Create variant key: code + rounded price
      const variantKey = `${brandingCode}-R${roundedPrice}`;
      
      // Skip R0 branding (likely inclusive pricing)
      if (roundedPrice === 0) return;
      
      // Store in appropriate method group
      if (!groups[methodType].has(variantKey)) {
        groups[methodType].set(variantKey, {
          brandingCode,
          brandingMethod: item.brandingMethod,
          roundedPrice,
          originalPrice: unitPrice,
          variantTitle: `${item.brandingMethod} - ${brandingCode} - R${roundedPrice}`,
          sku: `BRANDING-${brandingCode}-${roundedPrice * 100}` // price in cents for SKU
        });
      }
    });
  });
  
  return groups;
}

// Create setup fees product
async function createSetupFeesProduct(setupCosts) {
  console.log('▶ Creating Setup Fees product');
  
  const variants = Array.from(setupCosts).sort((a, b) => a - b).map(setupCost => ({
    title: `Setup Fee - R${setupCost.toFixed(2)}`,
    sku: `SETUP-${Math.round(setupCost * 100)}`, // price in cents
    price: setupCost.toFixed(2),
    inventory_management: null, // No inventory tracking for services
    inventory_quantity: 0,
    requires_shipping: false,
    taxable: true,
    option1: `R${setupCost.toFixed(2)}`
  }));
  
  const payload = {
    product: {
      title: 'Setup Fees',
      body_html: 'One-time setup fees for branding services. This fee is charged once per branding method regardless of quantity.',
      vendor: 'Amrod',
      handle: 'setup-fees',
      tags: ['branding', 'setup', 'service', 'amrod'],
      product_type: 'Service',
      published: false, // Hidden from storefront
      options: [{ name: 'Fee Amount' }],
      variants
    }
  };
  
  try {
    const res = await shopifyClient.post('/products.json', payload);
    console.log(`✅ Setup Fees product created with ${variants.length} variants (ID: ${res.data.product.id})`);
    return res.data.product.id;
  } catch (err) {
    if (err.response?.status === 422 && err.response?.data?.errors?.handle) {
      console.log('ℹ️ Setup Fees product already exists, skipping...');
      return null;
    }
    console.error('❌ Setup Fees creation failed:', err.response?.data || err.message);
    throw err;
  }
}

// Create branding service product for a method type
async function createBrandingProduct(methodType, brandingVariants) {
  const methodNames = {
    embroidery: 'Embroidery Services',
    screenprint: 'Screen Print Services',
    padprint: 'Pad Print Services', 
    laser: 'Laser Engraving Services',
    digital: 'Digital Printing Services',
    other: 'Other Branding Services'
  };
  
  const productName = methodNames[methodType];
  const handle = slugify(productName);
  
  console.log(`▶ Creating ${productName} with ${brandingVariants.size} variants`);
  
  if (brandingVariants.size === 0) {
    console.log(`⚠️ No variants for ${productName}, skipping...`);
    return null;
  }
  
  if (brandingVariants.size > 100) {
    console.warn(`⚠️ ${productName} has ${brandingVariants.size} variants (>100 limit). Creating first 100...`);
  }
  
  const variants = Array.from(brandingVariants.values())
    .slice(0, 100) // Shopify limit
    .map(variant => ({
      title: variant.variantTitle,
      sku: variant.sku,
      price: variant.roundedPrice.toFixed(2),
      inventory_management: null, // No inventory tracking for services
      inventory_quantity: 0,
      requires_shipping: false,
      taxable: true,
      option1: variant.variantTitle
    }));
  
  const descriptions = {
    embroidery: 'Professional embroidery services for logos and designs. High-quality stitching on various materials.',
    screenprint: 'Screen printing services for vibrant, durable prints. Perfect for large quantities and bold designs.',
    padprint: 'Precision pad printing for detailed logos on small surfaces and promotional items.',
    laser: 'Laser engraving and etching services for permanent, precise markings on various materials.',
    digital: 'Digital printing services for full-color, photographic quality prints and transfers.',
    other: 'Specialized branding services including foiling, embossing, sublimation and other techniques.'
  };
  
  const payload = {
    product: {
      title: productName,
      body_html: descriptions[methodType],
      vendor: 'Amrod',
      handle,
      tags: ['branding', 'service', methodType, 'amrod'],
      product_type: 'Service',
      published: false, // Hidden from storefront
      options: [{ name: 'Service Type' }],
      variants
    }
  };
  
  try {
    const res = await shopifyClient.post('/products.json', payload);
    console.log(`✅ ${productName} created with ${variants.length} variants (ID: ${res.data.product.id})`);
    return res.data.product.id;
  } catch (err) {
    if (err.response?.status === 422 && err.response?.data?.errors?.handle) {
      console.log(`ℹ️ ${productName} already exists, skipping...`);
      return null;
    }
    console.error(`❌ ${productName} creation failed:`, err.response?.data || err.message);
    throw err;
  }
}

// Find product by handle  
async function findProductByHandle(handle) {
  try {
    const res = await shopifyClient.get('/products.json', {
      params: { handle }
    });
    return res.data.products?.[0] || null;
  } catch (err) {
    return null;
  }
}

// Main execution
(async () => {
  console.log('🚀 Starting Branding Services Generator');
  console.log('=====================================');
  
  await testAuth();
  const token = await getAmrodToken();
  const brandingPrices = await fetchBrandingPrices(token);
  
  // Group pricing data
  const groups = groupBrandingByMethodType(brandingPrices);
  
  console.log('\n📊 Summary:');
  console.log(`• Embroidery variants: ${groups.embroidery.size}`);
  console.log(`• Screen Print variants: ${groups.screenprint.size}`);
  console.log(`• Pad Print variants: ${groups.padprint.size}`);
  console.log(`• Laser variants: ${groups.laser.size}`);
  console.log(`• Digital variants: ${groups.digital.size}`);
  console.log(`• Other variants: ${groups.other.size}`);
  console.log(`• Unique setup fees: ${groups.setupFees.size}`);
  
  const totalVariants = groups.embroidery.size + groups.screenprint.size + 
                       groups.padprint.size + groups.laser.size + 
                       groups.digital.size + groups.other.size;
  console.log(`• Total branding variants: ${totalVariants}`);
  
  // Create products
  console.log('\n🏗️ Creating Products:');
  
  const createdProducts = [];
  
  // Create branding service products
  for (const [methodType, variants] of Object.entries(groups)) {
    if (methodType === 'setupFees') continue;
    
    if (variants.size > 0) {
      await sleep(1000); // Rate limiting
      const productId = await createBrandingProduct(methodType, variants);
      if (productId) {
        createdProducts.push({ type: methodType, id: productId, variants: variants.size });
      }
    }
  }
  
  // Create setup fees product
  if (groups.setupFees.size > 0) {
    await sleep(1000);
    const setupProductId = await createSetupFeesProduct(groups.setupFees);
    if (setupProductId) {
      createdProducts.push({ type: 'setupFees', id: setupProductId, variants: groups.setupFees.size });
    }
  }
  
  console.log('\n🎉 Generation Complete!');
  console.log('======================');
  console.log(`✅ Created ${createdProducts.length} products`);
  createdProducts.forEach(p => {
    console.log(`   • ${p.type}: ${p.variants} variants (ID: ${p.id})`);
  });
  
  console.log('\n💡 Next Steps:');
  console.log('• Update branding calculator to use these product IDs');
  console.log('• Test the cart integration with sample orders');
  console.log('• Verify pricing calculations match Amrod data');
  
})().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});