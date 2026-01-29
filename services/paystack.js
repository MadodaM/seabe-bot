// services/paystack.js
const axios = require('axios');
require('dotenv').config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET;

// SEABE FEE PERCENTAGE (5.5%)
const PLATFORM_FEE_PERCENTAGE = 0.055; 

async function createPaymentLink(amount, reference, email, subaccountCode) {
    try {
        const amountInCents = Math.round(parseFloat(amount) * 100);
        
        // Calculate Seabe's Fee (The 5.5% you keep)
        // Note: Paystack takes their fee out of THIS amount usually.
        let transactionCharge = 0;
        let bearer = 'account'; // Default: You (Main Account) pay fees

        if (subaccountCode) {
            transactionCharge = Math.round(amountInCents * PLATFORM_FEE_PERCENTAGE);
            bearer = 'subaccount'; // The Church pays the Paystack fees out of their share
        }

        const payload = {
            email: email,
            amount: amountInCents,
            reference: reference,
            currency: 'ZAR',
            channels: ['card', 'eft', 'qr', 'bank_transfer'],
            callback_url: 'https://seabe-bot.onrender.com/payment-success'
        };

        // If a Church Subaccount exists, add the Split Logic
        if (subaccountCode) {
            payload.subaccount = subaccountCode;
            payload.transaction_charge = transactionCharge; // Seabe keeps this amount
            payload.bearer = 'subaccount'; // Church bears the Paystack fees
        }

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            payload,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data.data.authorization_url;
    } catch (error) {
        console.error("❌ Paystack Error:", error.response ? error.response.data : error.message);
        return null;
    }
}

module.exports = { createPaymentLink };