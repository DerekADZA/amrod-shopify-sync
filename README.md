# Amrod → Shopify Sync Engine

![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![Shopify](https://img.shields.io/badge/Shopify-Admin%20API-96BF48?logo=shopify&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer-headless%20chrome-40B5A4?logo=googlechrome&logoColor=white)

A comprehensive Node.js automation engine that synchronises the full [Amrod](https://www.amrod.co.za) promotional-products catalogue to a Shopify store — handling products, variants, images, pricing, collections, and metafields.

> **Built for:** South African promotional merchandise retailers who stock Amrod products and need their Shopify catalogue kept in sync automatically.

---

## ✨ Features

- **Full product sync** — creates Amrod products in Shopify with variants, images, and rich descriptions
- **Daily incremental sync** — detects only changed products/prices/stock for fast, minimal-API-usage updates
- **Configurable price markup** — applies a multiplier to all Amrod wholesale prices at sync time
- **Collection generation** — maps Amrod's category tree to Shopify smart collections automatically
- **Menu scraping** — uses Puppeteer to extract Amrod's live navigation structure (no official category API)
- **Metafield sync** — pushes structured product data (materials, dimensions, compliance info) as Shopify metafields
- **SKU normalisation** — cleans and aligns SKU formats across both platforms
- **Bulk operations** — batch processing with rate-limit handling and automatic retries
- **Dry run mode** — preview all changes before applying them to production

---

## 🏗️ Architecture

```
amrod-sync/
├── index.js                  # Full product creation sync (main entry)
├── sync.js / sync-v2.js      # Core sync orchestration
├── amrodDailySync.js         # Incremental daily sync (cron-ready)
├── shopifyClient.js          # Shopify Admin API client wrapper
├── bearerToken.js            # Amrod JWT authentication
├── priceSync.js              # Price-only sync pass
├── bulkSync.js               # Batch product operations
├── collectionsUpdate.js      # Collection membership updates
├── generateCollections.js    # Build Shopify collections from Amrod categories
├── scrapeMenu.js             # Puppeteer: scrape Amrod's live menu tree
├── metaUpdate.js             # Push metafields to Shopify
├── metafieldMap.js           # Amrod → Shopify metafield schema mapping
├── skuComparison.js          # Diff Amrod SKUs vs Shopify SKUs
├── catalog-diff.js           # Full catalogue comparison report
└── brandingCalculator.js     # Branding cost calculation logic
```

**Data flow:**
```
Amrod REST API ──► bearerToken.js (JWT auth)
                          │
                          ▼
               index.js / sync-v2.js
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    Products +       Collections     Metafields
    Variants +       + Menu tree     + Branding
    Images                                │
          │                               │
          └───────────────┬───────────────┘
                          ▼
              shopifyClient.js ──► Shopify Admin API
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- A Shopify store with Admin API access
- An Amrod vendor account

### Installation

```bash
git clone https://github.com/DerekADZA/amrod-shopify-sync.git
cd amrod-shopify-sync
npm install
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Shopify
SHOPIFY_STORE_URL=https://your-store.myshopify.com
SHOPIFY_ADMIN_API_TOKEN=shpat_xxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-01
SHOPIFY_LOCATION_ID=12345678901

# Amrod
AMROD_EMAIL=your@email.com
AMROD_PASSWORD=yourpassword
AMROD_CUSTOMER_CODE=YOURCUSTCODE

# Pricing
PRICE_MARKUP=1.43    # 43% markup over Amrod wholesale price
DRY_RUN=false        # Set true to preview without writing to Shopify
```

---

## 📋 Available Scripts

| Script | Description |
|---|---|
| `node index.js` | Full product creation sync (initial catalogue load) |
| `node amrodDailySync.js` | Incremental sync — changed products only |
| `node sync-v2.js` | Full sync v2 with improved error recovery |
| `node priceSync.js` | Price-only update pass |
| `node collectionsUpdate.js` | Sync collection memberships |
| `node generateCollections.js` | Rebuild Shopify collections from Amrod categories |
| `node scrapeMenu.js` | Scrape Amrod's live navigation tree via Puppeteer |
| `node skuComparison.js` | Diff Amrod SKUs vs Shopify catalogue |
| `node catalog-diff.js` | Full catalogue comparison report |
| `node amrodDryRun.js` | Preview sync actions without writing |

---

## 🔄 Deployment as a Daily Cron Job

Deploy `amrodDailySync.js` as a scheduled service on [Render.com](https://render.com):

| Setting | Value |
|---|---|
| Service type | Cron Job |
| Build command | `npm install` |
| Start command | `node amrodDailySync.js` |
| Schedule | `30 23 * * *` (01:30 SAST) |

Set all environment variables in the Render dashboard — never commit `.env`.

---

## 🔐 Authentication Flow

Amrod uses JWT bearer tokens issued by a vendor identity endpoint:

```
POST https://identity.amrod.co.za/VendorLogin
{ email, password, customerCode }
→ { token: "eyJ..." }
```

The token is injected into all subsequent Amrod API calls. `bearerToken.js` handles acquisition and storage.

---

## 📦 Key Dependencies

| Package | Purpose |
|---|---|
| `@shopify/shopify-api` | Official Shopify Admin API client |
| `puppeteer` | Headless Chrome for scraping Amrod's menu tree |
| `axios` | HTTP client for Amrod REST API |
| `xlsx` | Parse/export spreadsheet data for bulk operations |
| `json2csv` | Export sync reports as CSV |
| `dotenv` | Environment variable management |

---

## License

MIT © [Derek Whitton](https://github.com/DerekADZA)
