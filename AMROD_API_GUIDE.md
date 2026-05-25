# Amrod API Guide

Complete reference for the Amrod Vendor API used in this sync system.

## Table of Contents
- [API Endpoints](#api-endpoints)
- [Product Structure](#product-structure)
- [Update Frequency](#update-frequency)
- [Categories](#categories)
- [Promotion & Behavior Flags](#promotion--behavior-flags)
- [Product Dimensions & Attributes](#product-dimensions--attributes)
- [Images](#images)
- [Branding](#branding)
- [Linked Products](#linked-products)
- [Components (Giftsets)](#components-giftsets)

---

## API Endpoints

### Authentication
**POST** `https://identity.amrod.co.za/VendorLogin`

**Request Body:**
```json
{
  "UserName": "your-email@domain.com",
  "Password": "your-password",
  "CustomerCode": "YOUR_CUSTOMER_CODE"
}
```

**Response:**
```json
{
  "token": "Bearer_token_here",
  "access_token": "alternative_token_field"
}
```

### Products

#### Get Products with Branding (Recommended)
**GET** `https://vendorapi.amrod.co.za/api/v1/Products/GetProductsAndBranding`

Returns full product information including branding positions, methods, and exclusions.

**Headers:**
```
Authorization: Bearer {token}
Accept: application/json
Content-Type: application/json
```

#### Get Products without Branding
**GET** `https://vendorapi.amrod.co.za/api/v1/Products/GetProducts`

Returns basic product information without branding details. Smaller payload.

### Stock Information
**GET** `https://vendorapi.amrod.co.za/api/v1/Stock/`

Returns stock levels for all products.

**Stock Types:**
- Type 1: Base product stock (not used)
- Type 2: Variant stock (ACTUAL sellable items - USE THIS)

**Filter to Type 2 only:**
```javascript
const variantStock = stockData.filter(s => Number(s.stockType) === 2);
```

### Categories
**GET** `https://vendorapi.amrod.co.za/api/v1/Products/GetCategories`

Returns full category tree structure.

---

## Product Structure

### Base vs Variant Concept

Every Amrod product consists of **TWO elements**:

#### 1. BASE Product
- Default/shared information
- Contains branding options common to ALL variants
- **Cannot be purchased directly**
- Think of it as a "template" or "family"

**Example:** A t-shirt product (base) - you can't buy just "a t-shirt", you need size and colour.

#### 2. VARIANT
- The **actual sellable item**
- Combination of colour + size
- Has specific SKU, price, and stock
- **This is what customers purchase**

**Example:** If a t-shirt comes in 3 colours × 4 sizes = 12 variants

```
T-SHIRT (BASE)
├── Red - Small (VARIANT: TS-001-R-S)
├── Red - Medium (VARIANT: TS-001-R-M)
├── Red - Large (VARIANT: TS-001-R-L)
├── Red - XL (VARIANT: TS-001-R-XL)
├── Blue - Small (VARIANT: TS-001-B-S)
├── Blue - Medium (VARIANT: TS-001-B-M)
... and so on
```

### Decoupled Products

**What is "Decoupled"?**

Sometimes Amrod separates a variant from its base product family. This happens when:
- A specific colour is on clearance
- End-of-life for one colour only
- Special promotion on specific variant
- Discontinued colour but others still active

**How to Identify:**
```javascript
if (product.decoupled === true) {
  // This is a decoupled product
  // Treat as its own separate product
  // It's NO LONGER linked to the main base
}
```

**Example:**
```
Original Product:
T-SHIRT (5 colours × 6 sizes = 30 variants)

After Decoupling RED colour:
T-SHIRT (4 colours × 6 sizes = 24 variants)
T-SHIRT-RED-CLEARANCE (1 colour × 6 sizes = 6 variants) ← Decoupled
```

**In Shopify:**
- Create decoupled products as **separate Shopify products**
- Add "Clearance" or "Special" tags
- Link back to original in metafields for reference

---

## Update Frequency

⚠️ **IMPORTANT:** Amrod updates product information **ONCE PER DAY**

**Recommendation:**
- Run sync once daily (overnight)
- Don't poll more frequently - data won't change
- Check for stock updates more frequently if needed (stock API is separate)

---

## Categories

Products can belong to **multiple categories**.

**Category Structure:**
```javascript
{
  "categories": [
    {
      "id": 123,              // Unique category ID
      "name": "T-Shirts",     // Category name
      "path": "Clothing > Apparel > T-Shirts"  // Full path from root
    }
  ]
}
```

**Full Category Tree:**
Use `/Products/GetCategories` endpoint to get complete hierarchy.

**For Shopify:**
- Use `path` as the product_type or collection
- Use `name` for tags
- Map `id` to custom metafield for tracking

---

## Promotion & Behavior Flags

### Promotion Flag
Indicates if product has special promotion status.

| Value | Meaning | Shopify Action |
|-------|---------|----------------|
| 0 | Normal | No special tag |
| 1 | On Promotion | Add "On Promotion" tag |
| 2 | New Product | Add "New Arrival" tag |
| 3 | Clearance | Add "Clearance" tag, consider draft status |

**Usage:**
```javascript
const promotionTags = {
  0: null,
  1: 'On Promotion',
  2: 'New Arrival',
  3: 'Clearance'
};

if (product.promotion > 0) {
  product.tags.push(promotionTags[product.promotion]);
}
```

### Behavior Flag
Controls product visibility and featuring.

| Value | Meaning | Shopify Action |
|-------|---------|----------------|
| 0 | Normal | Active (if other criteria met) |
| 1 | Featured | Active + "Featured" tag |
| 2 | Hidden | **Force DRAFT status** |

**Usage:**
```javascript
if (product.behaviour === 2) {
  shopifyProduct.status = 'draft';  // Always draft
  logStatusChange('Hidden by Amrod');
}

if (product.behaviour === 1) {
  shopifyProduct.tags.push('Featured');
}
```

---

## Product Dimensions & Attributes

### Product Dimensions
Individual variant dimensions (per item).

```javascript
{
  "length": 25.5,    // cm
  "width": 18.0,     // cm
  "height": 2.0,     // cm
  "weight": 0.15     // kg (note: sometimes in grams, check!)
}
```

### Package Dimensions
Carton/bulk packaging information.

```javascript
{
  "piecesPerCarton": 50,
  "cartonDimensions": {
    "length": 60,    // cm
    "width": 40,     // cm
    "height": 30     // cm
  },
  "cartonWeight": 7.5  // kg
}
```

### Product Attributes
Key-value pairs describing variant specifics.

**Examples:**
- T-Shirts: `{ "1/2 Chest": "52cm" }`
- Pants: `{ "Length": "102cm", "Waist": "82cm" }`
- Bags: `{ "Capacity": "20L", "Material": "Polyester" }`

**Varies by product type** - not standardized across all products.

**For Shopify:**
Store as metafields or variant options depending on importance.

---

## Images

### Image Types

**Base Images** (`images` array)
- Showcases the overall product
- Generic/lifestyle shots
- Product without specific colour

**Variant Images** (`colourImages` array)
- Grouped by colour
- Shows specific colour variant
- Multiple angles per colour

### Image Metadata

```javascript
{
  "url": "https://cdn.amrod.co.za/images/product-1024x1024.jpg",
  "isDefault": true,      // First/primary image
  "hasLogo": false        // Contains branding example
}
```

### Image Sizes

All images available in multiple sizes. Default URL contains `1024x1024`.

**Available Sizes (Width × Height in pixels):**
- `151x141` - Thumbnail
- `46x45` - Mini thumbnail
- `260x250` - Small
- `270x150` - Small wide
- `460x350` - Medium
- `1024x1024` - Large (default)

**How to Get Different Sizes:**
```javascript
const originalUrl = "https://cdn.amrod.co.za/images/product-1024x1024.jpg";

// Replace 1024x1024 with desired size
const thumbnailUrl = originalUrl.replace('1024x1024', '151x141');
const mediumUrl = originalUrl.replace('1024x1024', '460x350');
```

**⚠️ IMPORTANT:**
- The 'X' between dimensions is **UPPERCASE** and **case-sensitive**
- Must use exact sizes listed above
- Sizes cannot be reversed (460x350 ✅, 350x460 ❌)
- No spaces or underscores in size string

---

## Branding

### Structure

Branding is provided in a tree structure:
```
Positions (where to brand)
  └─ Methods (how to brand)
       └─ Exclusions (colours where this method NOT allowed)
```

### Positions

Where branding can be applied on the product.

```javascript
{
  "positionCode": "A",
  "positionName": "Left Chest",
  "positionMultiplier": 2  // Can brand 2 times (left AND right)
}
```

**Position Multiplier:**
- `1` = Single position (e.g., "Center back")
- `2` = Dual position (e.g., "Left or Right chest" creates A-1 and A-2)

### Methods

Branding techniques available per position.

```javascript
{
  "methodCode": "EMB",
  "methodName": "Embroidery",
  "maxPrintSize": "100x100mm",
  "numberOfColours": 6,
  "exclusions": "BL,BK"  // NOT allowed on Black or Blue variants
}
```

### Exclusions

**Critical:** Some branding methods don't work on certain colours.

```javascript
// If method has exclusions: "BL,BK,R"
// This method is available on ALL variants EXCEPT:
// - All "BL" (Blue) colour variants
// - All "BK" (Black) colour variants
// - All "R" (Red) colour variants

// If exclusions are empty ("") or null:
// Method is available on ALL variants
```

### Special Branding Fields

**Required Branding Positions:**
```javascript
product.requiredBrandingPositions = "A,B"  // Positions A and B are mandatory
```

**No Co-Branding Positions:**
```javascript
product.noCoBrandingPositions = "C"  // Position C is fixed, cannot customize
```

This means Amrod will apply branding to position C with a fixed design - you cannot provide custom artwork for this position.

### Branding Guide

Always provided regardless of API endpoint choice:
```javascript
product.brandingGuideUrl = "https://cdn.amrod.co.za/branding/product-guide.pdf"
```

This PDF shows visual representation of positions, methods, and specifications.

---

## Linked Products

### Companion Products
Items that go well together.

```javascript
product.companionCodes = ["PEN-001", "NOTE-055", "BAG-234"]
```

**Examples:**
- Notebook → Companion: Pen
- T-Shirt → Companion: Pants, Cap
- Mug → Companion: Coaster, Gift Box

**Use Case:** "Customers also bought" or "Complete the set" sections.

### Related Products
Similar products in same category.

```javascript
product.relatedCodes = ["TS-002", "TS-003", "TS-015"]
```

**Examples:**
- T-Shirt Model A → Related: T-Shirt Model B, C, D
- Basic Pen → Related: Premium Pen, Pen Set

**Use Case:** "You may also like" or alternative options.

### Matching Products
Gender-matched equivalents.

```javascript
product.matchingCodes = ["TS-100-M"]  // Men's version
product.gender = "Ladies"
```

**Examples:**
- Ladies T-Shirt → Matching: Men's T-Shirt (same style)
- Women's Jacket → Matching: Men's Jacket

**Use Case:** "Shop Men's Version" or couple/team ordering.

### Grouping Codes
Products that belong to the same collection/series.

```javascript
product.groupingCodes = ["CORP-001", "CORP-002", "CORP-003"]
```

**Examples:**
- Corporate Gift Set 1, 2, 3
- Uniform Collection items

---

## Components (Giftsets)

Only applies to products with `type: "Giftset"`.

### Structure
```javascript
{
  "type": "Giftset",
  "components": [
    {
      "productCode": "PEN-001",
      "quantity": 1,
      "brandingPositions": ["A", "B"]  // Can brand these positions on this component
    },
    {
      "productCode": "NOTE-055",
      "quantity": 1,
      "brandingPositions": ["A"]
    }
  ]
}
```

### How It Works
- A giftset is a bundle of multiple products
- Each component can be branded individually
- Components have their own branding position options
- Giftset has its own price (not sum of components)

### For Shopify
Options:
1. Create as bundle product with metafields listing components
2. Use Shopify bundles app
3. Store component codes in metafields for reference

**Do NOT try to sync components as separate variants** - they are separate products.

---

## Best Practices

### 1. Always Check Stock Type
```javascript
// ✅ Correct
const stock = stockData.filter(s => s.stockType === 2);

// ❌ Wrong
const stock = stockData.filter(s => s.stockType === 1);  // Base stock, not sellable
```

### 2. Handle Decoupled Products
```javascript
if (product.decoupled) {
  // Create separate Shopify product
  // Add special tags
  // Link to original base in metafields
}
```

### 3. Respect Update Frequency
- Sync products once daily maximum
- Stock can be checked more frequently
- Cache data where possible

### 4. Use Correct Image Sizes
```javascript
// For product page: 1024x1024
// For collection grid: 460x350
// For thumbnails: 151x141
```

### 5. Map All Flags
```javascript
// Always map both flags
const tags = [];
if (product.promotion) tags.push(getPromotionTag(product.promotion));
if (product.behaviour === 1) tags.push('Featured');

const status = product.behaviour === 2 ? 'draft' : 'active';
```

---

## Common Pitfalls

### ❌ Don't Do This
1. Poll API every hour (data only updates daily)
2. Ignore `decoupled` flag (creates duplicate products)
3. Use Type 1 stock (not the actual variant stock)
4. Ignore behaviour flag = 2 (shows hidden products)
5. Create variants from components (they're separate products)

### ✅ Do This
1. Sync once daily, cache results
2. Check decoupled flag, handle separately
3. Always use Type 2 stock for variants
4. Set hidden products (behaviour=2) to draft
5. Store component references in metafields

---

## Quick Reference

### Essential Fields Checklist
- [ ] `productCode` - Base product code
- [ ] `fullCode` - Variant SKU
- [ ] `productName` - Title
- [ ] `description` - Body HTML
- [ ] `price` - Variant price
- [ ] `stock` (from Stock API, Type 2)
- [ ] `colour` - Variant option 1
- [ ] `size` - Variant option 2
- [ ] `images` - Product images
- [ ] `colourImages` - Variant images
- [ ] `promotion` - Map to tags
- [ ] `behaviour` - Map to status/tags
- [ ] `decoupled` - Handle separately
- [ ] `categories` - Map to collections

---

## Support

For API issues or questions:
- Amrod Vendor Support: [vendor-support@amrod.co.za](mailto:vendor-support@amrod.co.za)
- API Documentation: Check your vendor portal

---

**Document Version:** 1.0
**Last Updated:** 2025-10-21
**Sync Script Version:** 2.0
