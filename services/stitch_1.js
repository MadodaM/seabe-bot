// services/stitch.js
const axios = require('axios');

// 1. SETTINGS
// ⚠️ REPLACE THESE WITH YOUR REAL CREDENTIALS FROM STITCH DASHBOARD
const ACCOUNT_SID = process.env.STITCH CLIENT_ID || 'Place_Holder_For_Code';
const AUTH_TOKEN = process.env.STITCH_SECRET || 'Place_Holder_For_Code';
const TOKEN_URL = 'https://secure.stitch.money/connect/token';
const API_URL = 'https://api.stitch.money/graphql';

// 2. HELPER: Get the Access Token
async function getAccessToken() {
    try {
        const response = await axios.post(TOKEN_URL, new URLSearchParams({
            'grant_type': 'client_credentials',
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'scope': 'client_paymentrequest'
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        return response.data.access_token;
    } catch (error) {
        console.error("❌ Auth Error:", error.response ? error.response.data : error.message);
        throw new Error("Could not talk to Stitch");
    }
}

// 3. MAIN FUNCTION: Create the Link
// 👇 The word 'async' MUST be here for 'await' to work below

async function createPaymentLink(amount, compoundString) {
	// Unpack: "2782...__TITHE-1234"
    const [phone, shortRef] = compoundString.split('__');
	
    
    // This line caused your error because 'async' was missing above
    const token = await getAccessToken();
    
    const query = `
        mutation CreatePaymentRequest(
            $amount: MoneyInput!, 
            $payerReference: String!,
            $beneficiaryReference: String!,
            $externalReference: String
        ) {
            clientPaymentInitiationRequestCreate(input: {
                amount: $amount,
                payerReference: $payerReference,
                beneficiaryReference: $beneficiaryReference,
                externalReference: $externalReference,
                beneficiary: {
                    bankAccount: {
                        name: "Seabe Float",
                        bankId: "abs_212", 
                        accountNumber: "123456789" 
                    }
                }
            }) {
                paymentInitiationRequest {
                    id
                    url
                }
            }
        }
    `;
    
    // Ensure Reference is max 12 chars (Stitch Limit)
    const safeReference = paymentReference ? paymentReference.substring(0, 12) : "Seabe";

    const variables = {
        amount: { quantity: amount, currency: "ZAR" },
        payerReference: "Seabe App",
        beneficiaryReference: safeReference,
        externalReference: paymentReference + "__" + Date.now(),
        beneficiaryName: "Church Account",
        beneficiaryBankId: "abs_212", 
        beneficiaryAccountNumber: "1234567890"
		
    };

    try {
        const response = await axios.post(API_URL, { query, variables }, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.data.errors) {
            console.error("❌ Stitch API Error:", JSON.stringify(response.data.errors, null, 2));
            return null;
        }

        const result = response.data.data.clientPaymentInitiationRequestCreate;
        return result.paymentInitiationRequest.url;
    } catch (error) {
        console.error("❌ Payment Error:", error.response ? error.response.data : error.message);
        return null;
    }
}

module.exports = { createPaymentLink };