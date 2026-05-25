// bearerToken.js (ES module compliant)
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const raw = JSON.stringify({
  UserName: process.env.AMROD_EMAIL,
  Password: process.env.AMROD_PASSWORD,
  CustomerCode: process.env.AMROD_CUSTOMER_CODE
});

const requestOptions = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: raw,
  redirect: 'follow'
};

fetch("https://identity.amrod.co.za/VendorLogin", requestOptions)
  .then(response => response.json())
  .then(result => {
    console.log("✅ Bearer Token:", result.token);
  })
  .catch(error => console.error('❌ Error fetching token:', error));
