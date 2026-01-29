// services/paystack.js
const axios = require('axios');
require('dotenv').config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET;
const PLATFORM_FEE_PERCENTAGE = 0.055; 

// 1. STANDARD ONE-TIME PAYMENT
async function createPaymentLink(amount, reference, email, subaccountCode) {
    try {
        const amountInCents = Math.round(parseFloat(amount) * 100);
        let transactionCharge = 0;
        let bearer = 'account'; 

        if (subaccountCode) {
            transactionCharge = Math.round(amountInCents * PLATFORM_FEE_PERCENTAGE);
            bearer = 'subaccount'; 
        }

        const payload = {
            email: email,
            amount: amountInCents,
            reference: reference,
            currency: 'ZAR',
            channels: ['card', 'eft', 'qr', 'bank_transfer'],
            callback_url: 'https://seabe-bot.onrender.com/payment-success'
        };

        if (subaccountCode) {
            payload.subaccount = subaccountCode;
            payload.transaction_charge = transactionCharge; 
            payload.bearer = 'subaccount'; 
        }

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            payload,
            { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
        );

        return response.data.data.authorization_url;
    } catch (error) {
        console.error("❌ Paystack Error:", error.response ? error.response.data : error.message);
        return null;
    }
}

// 2. 👇 NEW: RECURRING SUBSCRIPTION
async function createSubscriptionLink(amount, reference, email, subaccountCode) {
    try {
        const amountInCents = Math.round(parseFloat(amount) * 100);
        
        // A. First, create a "Plan" on the fly for this amount
        // Note: In production, you might want to reuse plans to avoid clutter, 
        // but creating one-off plans is easier for custom donation amounts.
        const planResponse = await axios.post(
            'https://api.paystack.co/plan',
            {
                name: `Monthly Tithe R${amount}`,
                amount: amountInCents,
                interval: 'monthly',
                currency: 'ZAR'
            },
            { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
        );

        const planCode = planResponse.data.data.plan_code;

        // B. Initialize transaction with this Plan Code
        // This tells Paystack: "Charge this user now, and then auto-charge this Plan monthly"
        let transactionCharge = 0;
        
        const payload = {
            email: email,
            amount: amountInCents, // Initial charge
            reference: reference,
            plan: planCode, // 👈 THE MAGIC KEY
            channels: ['card'], // Recurring usually only works well with Cards
            callback_url: 'https://seabe-bot.onrender.com/payment-success'
        };

        if (subaccountCode) {
            transactionCharge = Math.round(amountInCents * PLATFORM_FEE_PERCENTAGE);
            payload.subaccount = subaccountCode;
            payload.transaction_charge = transactionCharge;
            payload.bearer = 'subaccount';
        }

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            payload,
            { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
        );

        return response.data.data.authorization_url;

    } catch (error) {
        console.error("❌ Subscription Error:", error.response ? error.response.data : error.message);
        return null;
    }
}

module.exports = { createPaymentLink, createSubscriptionLink };