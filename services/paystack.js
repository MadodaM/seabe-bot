const axios = require('axios');

// ==========================================
// 1. PAYSTACK CONFIGURATION
// ==========================================
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY; 

const paystackApi = axios.create({
    baseURL: 'https://api.paystack.co',
    headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
    }
});

// ==========================================
// 2. SUBACCOUNT MAPPING
// Paste your actual Paystack SUB_ codes here
// ==========================================
const SUBACCOUNTS = {
    tithes: 'SUB_xxxxxxxxxxxxxxx',     
    offerings: 'SUB_xxxxxxxxxxxxxxx',  
    building: 'SUB_xxxxxxxxxxxxxxx'    
};

// ==========================================
// 3. STANDARD PAYMENT LINK
// ==========================================
async function createPaymentLink(amount, ref, email, accountType = null, userPhone = null) {
    try {
        const payload = {
            amount: amount * 100, 
            email: email,
            reference: ref,
            callback_url: 'https://seabe-test.onrender.com/payment-success',
            
            // 🔴 CRITICAL: Metadata links the payment to the WhatsApp number
            metadata: {
                whatsapp_number: userPhone,
                custom_fields: [
                    {
                        display_name: "Payment Type",
                        variable_name: "payment_type",
                        value: accountType || "General Donation"
                    }
                ]
            }
        };

        // Route to subaccount if specified
        if (accountType && SUBACCOUNTS[accountType]) {
            payload.subaccount = SUBACCOUNTS[accountType];
        }

        const response = await paystackApi.post('/transaction/initialize', payload);
        return response.data.data.authorization_url;
    } catch (error) {
        console.error("❌ Paystack Error:", error.response?.data || error.message);
        return null; 
    }
}

// ==========================================
// 4. MONTHLY SUBSCRIPTION LINK
// ==========================================
async function createSubscriptionLink(amount, ref, email, accountType = null, userPhone = null) {
    try {
        let planCode = await getOrCreatePlan(amount);

        const payload = {
            amount: amount * 100, 
            email: email,
            reference: ref,
            plan: planCode,
            callback_url: 'https://seabe-test.onrender.com/payment-success',

            // 🔴 CRITICAL: Metadata for PDF Receipts
            metadata: {
                whatsapp_number: userPhone,
                custom_fields: [
                    {
                        display_name: "Payment Type",
                        variable_name: "payment_type",
                        value: accountType || "Monthly Tithes"
                    }
                ]
            }
        };

        // Route to subaccount
        if (accountType && SUBACCOUNTS[accountType]) {
            payload.subaccount = SUBACCOUNTS[accountType];
        }

        const response = await paystackApi.post('/transaction/initialize', payload);
        return response.data.data.authorization_url;
    } catch (error) {
        console.error("❌ Paystack Sub Error:", error.response?.data || error.message);
        return null;
    }
}

// ==========================================
// 5. PLAN GENERATOR (HELPER)
// ==========================================
async function getOrCreatePlan(amount) {
    const planName = `Seabe Monthly - R${amount}`;
    try {
        const res = await paystackApi.post('/plan', {
            name: planName,
            amount: amount * 100,
            interval: 'monthly'
        });
        return res.data.data.plan_code;
    } catch (e) {
        return null;
    }
}

// ==========================================
// 6. WEBHOOK VERIFIER (FOR PDF GENERATION)
// ==========================================
async function verifyPayment(reference) {
    try {
        const response = await paystackApi.get(`/transaction/verify/${reference}`);
        return response.data.data;
    } catch (error) {
        console.error("❌ Paystack Verification Error:", error.message);
        return null;
    }
}

module.exports = { createPaymentLink, createSubscriptionLink, verifyPayment };