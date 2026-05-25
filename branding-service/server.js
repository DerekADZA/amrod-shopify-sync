import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Blob } from 'buffer';

dotenv.config();

const {
  SHOPIFY_STORE_URL,
  SHOPIFY_ADMIN_API_TOKEN,
  AUTH_SECRET,
  EMAIL_TO,
  EMAIL_FROM,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  PORT = 4000,
} = process.env;

if (!SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_API_TOKEN) {
  throw new Error('Missing Shopify credentials in environment variables.');
}

if (!AUTH_SECRET) {
  throw new Error('Missing AUTH_SECRET in environment variables.');
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per file
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Simple shared-secret auth layer so the theme can call the API.
app.use((req, res, next) => {
  const token = req.headers['x-branding-auth'];
  if (!token || token !== AUTH_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function shopifyGraphQL(query, variables = {}) {
  const response = await fetch(
    `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/2025-07/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(
      `Shopify GraphQL error: ${JSON.stringify(json.errors || json)}`,
    );
  }
  return json.data;
}

async function createStagedUpload(filename, mimeType) {
  const mutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    input: [
      {
        resource: 'FILE',
        filename,
        mimeType,
        httpMethod: 'POST',
      },
    ],
  };

  const data = await shopifyGraphQL(mutation, variables);
  const target = data.stagedUploadsCreate.stagedTargets?.[0];

  if (!target) {
    throw new Error(
      `Unable to create staged upload: ${JSON.stringify(
        data.stagedUploadsCreate.userErrors,
      )}`,
    );
  }

  return target;
}

async function uploadFileToStagedTarget(target, file) {
  const form = new FormData();
  target.parameters.forEach((param) => {
    form.append(param.name, param.value);
  });

  const blob = new Blob([file.buffer], { type: file.mimetype });
  form.append('file', blob, file.originalname);

  const res = await fetch(target.url, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Staged upload failed: ${res.status} ${text}`);
  }

  return target.resourceUrl;
}

async function finalizeShopifyFile(resourceUrl, filename, mimeType) {
  const mutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on GenericFile {
            id
            url
            createdAt
          }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    files: [
      {
        originalSource: resourceUrl,
        filename,
        contentType: 'FILE',
        mimeType,
      },
    ],
  };

  const data = await shopifyGraphQL(mutation, variables);
  const file = data.fileCreate.files?.[0];

  if (!file) {
    throw new Error(
      `fileCreate failed: ${JSON.stringify(data.fileCreate.userErrors)}`,
    );
  }

  return file;
}

app.post('/api/uploads', upload.single('artwork'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const stagedTarget = await createStagedUpload(
      req.file.originalname,
      req.file.mimetype || 'application/octet-stream',
    );
    const resourceUrl = await uploadFileToStagedTarget(stagedTarget, req.file);
    const file = await finalizeShopifyFile(
      resourceUrl,
      req.file.originalname,
      req.file.mimetype,
    );

    return res.json({
      fileId: file.id,
      url: file.url,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedAt: file.createdAt,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// Temporary in-memory catalog until a real data source is wired in.
const sampleCatalog = {
  'EMB-A': {
    sku: 'EMB-A',
    title: 'Embroidery A',
    priceBreaks: [
      { quantity: 1, unitPrice: 25.0, setupFee: 0 },
      { quantity: 100, unitPrice: 20.0, setupFee: 0 },
      { quantity: 250, unitPrice: 18.0, setupFee: 0 },
    ],
    positions: [
      { code: 'CHEST', name: 'Left Chest', allowedMethods: ['EMB-A'] },
      { code: 'SLEEVE', name: 'Sleeve', allowedMethods: ['EMB-A'] },
    ],
    guides: [
      {
        type: 'full',
        url: 'https://cdn.shopify.com/s/files/sample-branding-guide.pdf',
      },
    ],
  },
};

app.get('/api/catalog', (req, res) => {
  const { sku } = req.query;
  if (!sku) {
    return res
      .status(400)
      .json({ error: 'Missing sku query parameter (branding code).' });
  }

  const record = sampleCatalog[sku.toUpperCase()];
  if (!record) {
    return res.status(404).json({ error: 'Branding code not found.' });
  }

  return res.json(record);
});

function buildTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_FROM || !EMAIL_TO) {
    console.warn(
      'Gmail credentials not fully configured. Emails will be logged to stdout.',
    );
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
}

const mailer = buildTransporter();

app.post('/api/quote', async (req, res) => {
  const { customer, quote, branding, products, files } = req.body || {};

  if (!customer || !customer.email || !quote) {
    return res.status(400).json({
      error: 'Missing customer email or quote payload.',
    });
  }

  const attachments =
    files?.filter((f) => f?.url).map((f) => ({
      filename: f.fileName || 'artwork',
      path: f.url,
    })) ?? [];

  const reference = quote.reference || `WBS-${Date.now()}`;

  const html = `
    <h2>Branding Quote #${reference}</h2>
    <p><strong>Name:</strong> ${customer.name || ''}</p>
    <p><strong>Email:</strong> ${customer.email}</p>
    <p><strong>Phone:</strong> ${customer.phone || ''}</p>
    <p><strong>Company:</strong> ${customer.company || ''}</p>
    ${
      branding
        ? `<h3>Branding Summary</h3><pre>${JSON.stringify(branding, null, 2)}</pre>`
        : ''
    }
    ${
      products
        ? `<h3>Selected Products</h3><pre>${JSON.stringify(products, null, 2)}</pre>`
        : ''
    }
    <h3>Quote Breakdown</h3>
    <pre>${JSON.stringify(quote, null, 2)}</pre>
  `;

  if (!mailer) {
    console.log('Quote email (simulated):', {
      to: EMAIL_TO,
      from: EMAIL_FROM,
      subject: `Branding Quote ${reference}`,
      html,
      attachments,
    });
    return res.json({ success: true, reference, simulated: true });
  }

  try {
    await mailer.sendMail({
      to: EMAIL_TO,
      from: EMAIL_FROM,
      replyTo: customer.email,
      subject: `Branding Quote ${reference}`,
      html,
      cc: customer.cc ? [].concat(customer.cc) : undefined,
      attachments,
    });

    return res.json({ success: true, reference });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: 'Failed to send email.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Branding service listening on port ${PORT}`);
});
