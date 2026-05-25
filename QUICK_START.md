# Quick Start - Sync v2.0

Get started with the new enhanced sync system in minutes.

## TL;DR

```bash
# 1. Test without making changes
DRY_RUN=true node sync-v2.js

# 2. Check results
cat logs/sync-summary.json | jq '.'

# 3. Run for real
node sync-v2.js
```

---

## 5-Minute Setup

### Step 1: Verify Configuration (30 seconds)

Your existing `.env` file should work as-is. Verify it has:

```bash
cat .env
```

Should show:
```
SHOPIFY_STORE_URL=https://your-store.myshopify.com
SHOPIFY_ADMIN_API_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2025-07
SHOPIFY_LOCATION_ID=your_location_id
AMROD_EMAIL=your-email@domain.com
AMROD_PASSWORD=your-amrod-password
AMROD_CUSTOMER_CODE=YOUR_CUSTOMER_CODE
```

✅ Looks good? Continue to Step 2.

### Step 2: Test Run (2-3 minutes)

Run a dry-run to see what would happen:

```bash
DRY_RUN=true node sync-v2.js
```

You'll see output like:
```
🚀 Starting Amrod → Shopify sync v2.0...

🔍 Fetching full Amrod catalog...
✅ Retrieved 2,847 products

🔍 Fetching stock (Type 2)...
✅ Loaded 15,234 stock entries

📋 SYNC SUMMARY:
   • Products to process: 2,847
   • DRY RUN: ✅ ENABLED (no changes will be made)

[1/2847] Processing: "Premium Pen - Blue"
[DRY RUN] Would CREATE "Premium Pen - Blue" - Status: ACTIVE
...
```

Wait for it to complete (3-5 minutes for ~3000 products).

### Step 3: Review Results (1 minute)

Check the summary:

```bash
cat logs/sync-summary.json
```

Look for:
- ✅ **total**: Should match your product count
- ✅ **failed**: Should be 0
- ✅ **statusBreakdown**: How many active vs draft
- ⚠️ **validationIssues**: Any problems found

Example good result:
```json
{
  "stats": {
    "total": 2847,
    "created": 47,
    "updated": 2800,
    "skipped": 0,
    "failed": 0        ← Should be 0
  },
  "statusBreakdown": {
    "active": 2156,
    "draft": 691
  }
}
```

### Step 4: Check for Issues (30 seconds)

```bash
# Any errors?
tail -20 logs/sync-errors.log

# Why are products draft?
tail -20 logs/sync-status-changes.log
```

If errors log is empty and status changes make sense → You're good! ✅

### Step 5: Run Live (2-3 minutes)

```bash
node sync-v2.js
```

Watch it run. It will now actually update Shopify.

### Step 6: Verify in Shopify (1 minute)

1. Open Shopify Admin → Products
2. Check a few products:
   - Prices look correct? ✅
   - Stock levels match Amrod? ✅
   - Draft products make sense? ✅
   - Tags applied (Promotions, Featured)? ✅

Done! 🎉

---

## Understanding the Output

### Console Output

**Creating a product:**
```
🆕 CREATE: "Premium Pen - Blue" (SKU: PEN-001-BL) - 1 variants 🟢 ACTIVE
✅ CREATED: "Premium Pen - Blue" (ID: 8123456789) - ACTIVE
📦 INVENTORY: Product 8123456789 - 1/1 variants updated
```

**Updating a product:**
```
🔄 UPDATE: "T-Shirt Classic" (SKU: SHIRT-100) via SKU - 12 variants 📝 DRAFT
🔄 Status Change: "T-Shirt Classic" active → DRAFT (Out of stock)
✅ UPDATED: "T-Shirt Classic" (ID: 8123456790) - DRAFT
```

**Skipping a product:**
```
⏭️  SKIP: Failed validation - "Broken Product" (SKU: BAD-001)
```

### Status Meanings

| Icon | Status | Meaning |
|------|--------|---------|
| 🟢 | ACTIVE | Product is live in store |
| 📝 | DRAFT | Product hidden, needs review |

### Why Products Go to Draft

Common reasons (check `logs/sync-status-changes.log`):

1. **"No valid price"** - All variants have $0.00 price
2. **"Out of stock"** - All variants have 0 inventory
3. **"No product images"** - No images provided by Amrod
4. **"Missing description"** - No product description
5. **"Hidden by Amrod"** - Amrod's behaviour flag = 2

---

## Common First-Run Issues

### Issue 1: Many Products Set to Draft

**What you see:**
```json
"statusBreakdown": {
  "active": 500,
  "draft": 2347    ← Way more than expected
}
```

**Why:**
- Products might have zero prices from Amrod
- Stock might not be loading correctly
- Images might be missing

**What to do:**
```bash
# Check why they're draft
grep "draft" logs/sync-status-changes.log | head -20

# Common reasons:
# "No valid price" → Check Amrod prices
# "Out of stock" → Check stock API
# "No images" → Check Amrod image data
```

**Quick fix for testing:**
Comment out strict rules in sync-v2.js (line ~490):

```javascript
// Temporarily disable stock rule for testing
// if (!hasStock) {
//   status = 'DRAFT';
//   reasons.push('Out of stock');
// }
```

### Issue 2: Zero Prices

**What you see:**
```
⏭️  SKIP: Failed validation - "Some Product" (SKU: ABC-123)
```

**Why:**
Amrod might have $0 cost prices for some products.

**What to do:**
```bash
# Check validation log
grep "zero price" logs/sync-validation.log
```

These products are automatically skipped (correct behavior).

### Issue 3: Authentication Errors

**What you see:**
```
❌ Missing AMROD_EMAIL in .env
```

**Fix:**
Check your `.env` file has all required fields.

---

## Quick Commands

### Check Last Sync Status
```bash
cat logs/sync-summary.json | jq '.stats'
```

### Find Errors
```bash
tail -50 logs/sync-errors.log
```

### See What Was Set to Draft
```bash
grep "DRAFT" logs/sync-status-changes.log | tail -20
```

### Count Products by Status
```bash
cat logs/sync-summary.json | jq '.statusBreakdown'
```

### Find Promotions
```bash
cat logs/sync-summary.json | jq '.promotions'
```

### Check Validation Issues
```bash
cat logs/sync-summary.json | jq '.validationIssues'
```

---

## What to Check After First Sync

### 1. Products Created/Updated ✅
```bash
cat logs/sync-summary.json | jq '.stats'
```

Should show:
- `created`: New products added
- `updated`: Existing products refreshed
- `failed`: Should be 0

### 2. Status Breakdown ✅
```bash
cat logs/sync-summary.json | jq '.statusBreakdown'
```

Reasonable split:
- Most products should be active
- Some draft is normal (out of stock, $0 price)

### 3. No Errors ✅
```bash
wc -l logs/sync-errors.log
```

Should be very small or 0 lines.

### 4. Promotions Tagged ✅
```bash
cat logs/sync-summary.json | jq '.promotions'
```

Should show counts for:
- On Promotion
- New Arrivals
- Clearance
- Featured

### 5. Spot Check in Shopify ✅

Open a few products:
- Prices correct? ✅
- Stock levels match? ✅
- Images loaded? ✅
- Tags applied? ✅
- Description present? ✅

---

## Daily Use

### Morning Routine (30 seconds)

```bash
# Run sync
node sync-v2.js

# Quick check
cat logs/sync-summary.json | jq '.stats'

# Any issues?
tail -10 logs/sync-errors.log
```

### Weekly Review (5 minutes)

```bash
# Check summary trends
cat logs/sync-summary.json

# Review draft products
grep "DRAFT" logs/sync-status-changes.log | wc -l

# Review validation issues
cat logs/sync-summary.json | jq '.validationIssues'

# Manually review some draft products in Shopify
# Activate any that should be live
```

---

## Automation

### Set Up Daily Sync

**Linux/Mac (cron):**
```bash
crontab -e

# Add this line (runs at 2 AM daily):
0 2 * * * cd /path/to/amrod-sync && node sync-v2.js >> logs/cron.log 2>&1
```

**Windows (Task Scheduler):**
1. Open Task Scheduler
2. Create Basic Task
3. Name: "Amrod Sync"
4. Trigger: Daily, 2:00 AM
5. Action: Start a program
   - Program: `node`
   - Arguments: `sync-v2.js`
   - Start in: `C:\path\to\amrod-sync`

---

## Getting Help

### Check Documentation

1. **General questions:** README.md
2. **Technical details:** SYNC_IMPLEMENTATION.md
3. **Amrod API questions:** AMROD_API_GUIDE.md
4. **Migration questions:** MIGRATION_GUIDE.md
5. **This guide:** QUICK_START.md

### Debug Steps

1. Check `logs/sync-errors.log`
2. Check `logs/sync-validation.log`
3. Check `logs/sync-summary.json`
4. Read relevant documentation
5. Run with `DRY_RUN=true` to test

### Common Solutions

**"GraphQL field not defined"**
- Fixed in v2.0 ✅

**"Too many draft products"**
- Check `logs/sync-status-changes.log` for reasons
- Adjust rules if needed

**"Products not updating"**
- Check `logs/sync-errors.log`
- Verify .env credentials
- Check Shopify API version

---

## Next Steps

### You're Ready! ✅

You now have:
- ✅ Comprehensive logging
- ✅ Intelligent status management
- ✅ Automatic promotion tagging
- ✅ Product validation
- ✅ Complete documentation

### Recommended Learning Order

1. **Today:** Run DRY_RUN, review logs
2. **Tomorrow:** Run live sync, verify Shopify
3. **This week:** Monitor daily, fine-tune rules
4. **Next week:** Set up automation

### Optional Enhancements

**Want to customize?**
- Read SYNC_IMPLEMENTATION.md section on customization
- Edit status rules in sync-v2.js
- Adjust validation in validateProduct()

**Want to monitor?**
- Set up daily cron job
- Monitor sync-summary.json
- Alert on high failure rate

**Want to integrate?**
- Parse sync-summary.json
- Build dashboard from logs
- Trigger alerts on errors

---

**Quick Start Version:** 1.0
**Last Updated:** 2025-10-21
**For Sync Version:** v2.0
**Time to Complete:** 5-10 minutes

---

**Ready to go? Run your first test!**

```bash
DRY_RUN=true node sync-v2.js
```
