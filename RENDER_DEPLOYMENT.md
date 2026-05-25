# Deploying to Render.com

A guide for deploying the Amrod daily sync scripts to Render.com as an automated cron job.

## Prerequisites

1. GitHub account
2. Render.com account (free tier works)
3. Git installed locally

## Step 1: Push to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/amrod-shopify-sync.git
git branch -M main
git push -u origin main
```

## Step 2: Create a Cron Job on Render

1. Render Dashboard → **New +** → **Cron Job**
2. Connect your GitHub repository
3. Configure:

```
Name:          amrod-daily-sync
Environment:   Node
Build Command: npm install
Start Command: node daily-sync.js
Schedule:      0 3 * * *   (3 AM UTC daily)
```

## Step 3: Add Environment Variables

In the Render dashboard, add each variable from your `.env.example`:

| Variable | Description |
|---|---|
| `SHOPIFY_STORE_URL` | Your Shopify store URL |
| `SHOPIFY_ADMIN_API_TOKEN` | Shopify Admin API token (never share this) |
| `SHOPIFY_API_VERSION` | e.g. `2025-07` |
| `SHOPIFY_LOCATION_ID` | Your store's location ID |
| `AMROD_EMAIL` | Your Amrod vendor account email |
| `AMROD_PASSWORD` | Your Amrod vendor password (never share this) |
| `AMROD_CUSTOMER_CODE` | Your Amrod customer code |
| `MARKUP` | Price markup multiplier (e.g. `0.43` for 43%) |
| `DRY_RUN` | Set to `false` for production |

> ⚠️ **Never commit real credentials.** All secrets belong in Render's environment variable dashboard only.

## Step 4: Verify

1. Render Dashboard → your cron job → **Trigger Job** (manual run)
2. Check logs to confirm a successful sync

## Alternative Schedules

```yaml
# Every 6 hours
schedule: "0 */6 * * *"

# Twice daily
schedule: "0 3,15 * * *"

# Weekly on Sunday
schedule: "0 2 * * 0"
```

## Troubleshooting

- **Auth errors**: Rotate your Shopify API token and update the env var in Render
- **Cron not running**: Check Render logs and verify schedule syntax
- **Missing products**: Run `node amrodDryRun.js` locally first to verify the data

---

See also: [Render Cron Job docs](https://render.com/docs/cronjobs)
