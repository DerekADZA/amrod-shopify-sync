import 'dotenv/config'
import axios from 'axios'

async function findBrokenMetafields() {
  const SHOP    = process.env.SHOPIFY_STORE_URL
  const API_VER = process.env.SHOPIFY_API_VERSION
  const TOKEN   = process.env.SHOPIFY_ADMIN_API_TOKEN

  const client = axios.create({
    baseURL: `https://${SHOP}/admin/api/${API_VER}`,
    headers: { 'X-Shopify-Access-Token': TOKEN }
  })

  const limit = 250
  let sinceId = null
  let totalProcessed = 0
  const broken = []

  while (true) {
    const params = { limit }
    if (sinceId) params.since_id = sinceId
    console.log(`Fetching variants batch, since_id=${sinceId}`)

    const { data } = await client.get('/variants.json', { params })
    const variants = data.variants
    if (!variants || variants.length === 0) {
      console.log('No more variants to process.')
      break
    }
    console.log(`Fetched ${variants.length} variants in this batch.`)

    for (const v of variants) {
      totalProcessed++
      console.log(`Processing variant #${totalProcessed}: ID=${v.id}, product_id=${v.product_id}`)

      // check variant metafields
      const { data: vf } = await client.get(`/variants/${v.id}/metafields.json`)
      vf.metafields.forEach(m => {
        if (m.value === '[object Object],[object Object]') {
          broken.push({ resource: 'variant', id: v.id, metafieldId: m.id, key: m.key })
          console.warn(`  → Broken variant metafield key='${m.key}', id=${m.id}`)
        }
      })

      // check product metafields
      const { data: pf } = await client.get(`/products/${v.product_id}/metafields.json`)
      pf.metafields.forEach(m => {
        if (m.value === '[object Object],[object Object]') {
          broken.push({ resource: 'product', id: v.product_id, metafieldId: m.id, key: m.key })
          console.warn(`  → Broken product metafield key='${m.key}', id=${m.id}`)
        }
      })
    }

    // Prepare next batch
    if (variants.length < limit) {
      console.log('Reached last batch.')
      break
    }
    sinceId = variants[variants.length - 1].id
  }

  console.log(`Total variants processed: ${totalProcessed}`)
  if (broken.length === 0) {
    console.log('✅ No broken metafields found')
  } else {
    console.warn(`⚠️ Broken metafields found (${broken.length}):`)
    broken.forEach(b => console.log(b))
  }
}

findBrokenMetafields().catch(err => console.error(err))
