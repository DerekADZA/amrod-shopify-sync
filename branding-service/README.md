# Branding Calculator Companion Service

Small Express application that exposes REST endpoints the Shopify theme can use for:

- Uploading artwork assets to Shopify Files.
- Serving canonical branding/pricing data for calculator lookups.
- Sending quote emails via Gmail.

## Prerequisites

- Node.js 18+ (uses the built‑in `fetch`/`FormData` APIs).
- Shopify Admin API access token with `write_files` and `read_products` scopes.
- Gmail account with either:
  - **App Password** (preferred) when 2FA is enabled.
  - or OAuth2 credentials (you can adapt the transporter if needed).
- A shared secret (`AUTH_SECRET`) that the storefront will include in `x-branding-auth` headers.

## Setup

1. Copy `.env.example` to `.env` and populate the values:

   ```bash
   cp .env.example .env
   ```

   | Variable | Purpose |
   |----------|---------|
   | `SHOPIFY_STORE_URL` | Your Shopify store URL (e.g. `https://your-store.myshopify.com`). |
   | `SHOPIFY_ADMIN_API_TOKEN` | Admin API token with `write_files`. |
   | `AUTH_SECRET` | Random string shared with the theme; protects the API. |
   | `EMAIL_FROM` / `EMAIL_TO` | Sender/recipient addresses for quote emails. |
   | `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Gmail credentials or app password for SMTP. |
   | `PORT` | Optional HTTP port (defaults to `4000`). |

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm run dev   # with nodemon
   # or
  npm start
   ```

   API will listen on `http://localhost:4000` (or the `PORT` specified).

## Endpoints

### `POST /api/uploads`

Uploads an artwork file to Shopify Files using the staged upload GraphQL workflow.

- **Headers:** `x-branding-auth: <AUTH_SECRET>`
- **Body:** `multipart/form-data` with `artwork` field.
- **Response:** JSON `{ fileId, url, fileName, mimeType, uploadedAt }`

### `GET /api/catalog?sku=CODE`

Placeholder branding/pricing data. Replace the `sampleCatalog` object with a real data source (Amrod API, database, etc.).

### `POST /api/quote`

Sends a quote email via Gmail.

- **Headers:** `Content-Type: application/json`, `x-branding-auth: <AUTH_SECRET>`
- **Body:** `{ customer, quote, branding, products, files }`
- **Files** should include the objects returned from `/api/uploads` (`url` values are attached to the email).

## Deploying

Deploy to any Node-friendly platform (Render, Railway, Fly, etc.). Remember to set all environment variables in the hosting dashboard.

When running behind HTTPS, update `SHOPIFY_STORE_URL` and whitelist the deployed domain if hitting a Shopify App Proxy.

## Connecting the Shopify theme

In `layout/theme.liquid` (or similar), expose the API base and secret to the calculator script:

```liquid
<script>
  window.BC_API_BASE = 'https://your-service.example.com/api';
  window.BC_AUTH = '{{ settings.branding_calculator_secret }}';
</script>
```

Then update the calculator JS to:

- POST uploads to `${window.BC_API_BASE}/uploads`.
- Fetch branding data from `${window.BC_API_BASE}/catalog?sku=...`.
- Send quotes to `${window.BC_API_BASE}/quote`.
- Include `x-branding-auth: window.BC_AUTH` on every request.

Finally, remove the old `/products.json` lookups and fake upload timeout so the calculator uses the service exclusively.

## Gmail notes

- For Gmail with app password: enable 2FA on the account → Security → App passwords → create one for “Mail”.
- For OAuth2: you’ll need to exchange the refresh token for an access token. Swap the transporter in `server.js` to use `type: 'OAuth2'`.
- Gmail has sending limits (≈500/day personal, more for Workspace). If volume grows, consider SendGrid/Mailgun.

---

This service is intentionally lightweight. Expand it with a database or real branding catalogue feed when you’re ready—all the integration points are in `server.js`.
