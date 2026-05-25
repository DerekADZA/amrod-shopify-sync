// generateCollectionsWithBreadcrumbs.js
require('dotenv').config();
const axios = require('axios');

const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';
const SHOPIFY_BASE_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}`;

const amrodClient = axios.create({
  baseURL: AMROD_BASE_URL,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
});

const shopifyClient = axios.create({
  baseURL: SHOPIFY_BASE_URL,
  headers: {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

function slugify(text) {
  const slug = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s/-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'missing-handle';
}

function collectImageURLs(obj, set) {
  if (!obj || typeof obj !== 'object') return;
  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && val.includes('http') && val.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/i)) {
      if (!val.includes('_default_upload_bucket')) set.add(val);
    } else if (typeof val === 'object') {
      collectImageURLs(val, set);
    }
  }
}

async function getAmrodToken() {
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  if (!AMROD_EMAIL || !AMROD_PASSWORD || !AMROD_CUSTOMER_CODE) {
    console.error('❌ Missing Amrod .env credentials');
    process.exit(1);
  }
  try {
    const res = await axios.post(AMROD_AUTH_URL, {
      UserName: AMROD_EMAIL,
      Password: AMROD_PASSWORD,
      CustomerCode: AMROD_CUSTOMER_CODE
    });
    return res.data.token || res.data.access_token;
  } catch (err) {
    console.error('❌ Amrod auth failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

async function fetchAmrodProducts(token) {
  const res = await amrodClient.get('/Products/GetProductsAndBranding', {
    headers: { Authorization: `Bearer ${token}` }
  });
  return Array.isArray(res.data) ? res.data : res.data.Products || [];
}

async function fetchShopifyCollections() {
  const res = await shopifyClient.get('/custom_collections.json?limit=250');
  return res.data.custom_collections.map(c => ({
    id: c.id,
    handle: c.handle,
    title: c.title,
    image: c.image,
    body_html: c.body_html
  }));
}

async function updateCollection(id, updates) {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    await shopifyClient.put(`/custom_collections/${id}.json`, {
      custom_collection: { id, ...updates }
    });
  } catch (err) {
    console.error('❌ Failed to update collection:', err.response?.data || err.message);
  }
}

async function setMetafield(collectionId, namespace, key, value) {
  try {
    await shopifyClient.post(`/metafields.json`, {
      metafield: {
        namespace,
        key,
        value,
        type: 'single_line_text_field',
        owner_id: collectionId,
        owner_resource: 'custom_collection'
      }
    });
    console.log(`🔗 Set metafield breadcrumbs.parent = "${value}" for collection ID: ${collectionId}`);
  } catch (err) {
    console.error(`❌ Failed to set metafield for ID ${collectionId}:`, err.response?.data || err.message);
  }
}

async function createShopifyCollection(title, handle, imageSrc = null) {
  const collectionData = {
    title,
    handle,
    published: true
  };
  if (imageSrc) {
    collectionData.image = { src: imageSrc };
  }
  try {
    const res = await shopifyClient.post('/custom_collections.json', {
      custom_collection: collectionData
    });
    console.log(`✅ Created collection: ${title} (Handle: ${handle})`);
    return res.data.custom_collection.id;
  } catch (err) {
    console.error(`❌ Failed to create collection "${title}" (Handle: ${handle}):`, err.response?.data || err.message);
    return null;
  }
}

(async () => {
  try {
    console.log('📦 Syncing collections + breadcrumbs...');
    const token = await getAmrodToken();
    const amrodProducts = await fetchAmrodProducts(token);
    const existingCollections = await fetchShopifyCollections();
    const existingHandles = new Set(existingCollections.map(c => c.handle));

    const categoryMap = new Map(); // name → { parent, image }

    for (const product of amrodProducts) {
      const images = new Set();
      [product.Images, product.colourImages, product.BrandingImages, product.components].forEach(source => {
        if (Array.isArray(source)) source.forEach(obj => collectImageURLs(obj, images));
        else if (typeof source === 'object') collectImageURLs(source, images);
      });
      collectImageURLs(product, images);
      const imageArr = Array.from(images);
      const image = imageArr.length > 0 ? imageArr[0] : null;

      if (Array.isArray(product.categories)) {
        for (const cat of product.categories) {
          const segments = cat?.path?.split('/')?.map(s => s.trim()).filter(Boolean) || [];
          for (let i = 0; i < segments.length; i++) {
            const name = segments[i];
            const parent = i > 0 ? segments[i - 1] : null;
            if (!categoryMap.has(name)) {
              categoryMap.set(name, { parent, image });
            }
          }
        }
      }
    }

    const allCategories = Array.from(categoryMap.entries());

    for (let i = 0; i < allCategories.length; i += 5) {
      const batch = allCategories.slice(i, i + 5);
      for (const [name, meta] of batch) {
        const handle = slugify(name);
        let existing = existingCollections.find(c => c.handle === handle);
        let collectionId = existing?.id;

        if (!existing) {
          console.log(`🔧 Creating collection: "${name}" → "${handle}"`);
          collectionId = await createShopifyCollection(name, handle, meta.image);
        } else {
          const updates = {};
          if (!existing.image && meta.image) updates.image = { src: meta.image };
          if (!existing.body_html) updates.body_html = `Products related to ${name}`;
          if (Object.keys(updates).length > 0) {
            await updateCollection(existing.id, updates);
            console.log(`🔁 Updated collection: ${name}`);
          } else {
            console.log(`↪ Collection already up to date: ${name}`);
          }
        }

        if (collectionId && meta.parent) {
          await setMetafield(collectionId, 'breadcrumbs', 'parent', meta.parent);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('🎉 Collection & breadcrumb sync complete');
  } catch (err) {
    console.error('❌ Fatal error:', err);
  }
})();
