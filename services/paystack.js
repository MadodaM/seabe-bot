const axios = require('axios');
require('dotenv').config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET;

async function createPaymentLink(amount, reference, email) {
    try {
        // Paystack needs amount in CENTS (e.g., R100.00 = 10000)
        const amountInCents = Math.round(parseFloat(amount) * 100);

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: email, // Paystack requires an email
                amount: amountInCents,
                reference: reference,
                currency: 'ZAR',
                channels: ['eft', 'card_payment', 'qr'], // Allow Card & EFT
                callback_url: 'https://seabe-bot.onrender.com/payment-success' // Optional redirect
            },
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