import 'dotenv/config';
import axios from 'axios';

const AMROD_AUTH_URL = 'https://identity.amrod.co.za/VendorLogin';
const AMROD_BASE_URL = 'https://vendorapi.amrod.co.za/api/v1';
const PREFIX = 'SLAZ-11408-N'; // Or lowercased, depending on your data

async function main() {
  // Authenticate
  const { AMROD_EMAIL, AMROD_PASSWORD, AMROD_CUSTOMER_CODE } = process.env;
  const auth = await axios.post(AMROD_AUTH_URL, {
    UserName: AMROD_EMAIL,
    Password: AMROD_PASSWORD,
    CustomerCode: AMROD_CUSTOMER_CODE
  });
  const token = auth.data.token || auth.data.access_token;
  console.log('✅ Got Amrod token');

  // Fetch all prices
  const priceRes = await axios.get(
    `${AMROD_BASE_URL}/Prices`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const prices = Array.isArray(priceRes.data) ? priceRes.data : priceRes.data.Prices || [];

  // Show only ones matching the product/variant codes
  const filtered = prices.filter(p =>
    (p.simplecode && p.simplecode.toUpperCase().startsWith(PREFIX)) ||
    (p.fullCode   && p.fullCode.toUpperCase().startsWith(PREFIX))
  );

  if (filtered.length === 0) {
    console.log('No prices found for', PREFIX);
  } else {
    filtered.forEach(p => {
      console.log(`Code: ${p.fullCode||p.simplecode}, Price: ${p.price}`);
    });
  }
}

main();
