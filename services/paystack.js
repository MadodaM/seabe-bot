const axios = require('axios');
require('dotenv').config();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// 1. PAYSTACK CONFIGURATION
const paystackApi = axios.create({
    baseURL: 'https://api.paystack.co',
    headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
    }
});

// 2. STANDARD PAYMENT LINK (Restored Metadata)
async function createPaymentLink(amount, ref, email, subaccount, userPhone) {
    try {
        const payload = {
            amount: amount * 100, 
            email: email,
            reference: ref,
            callback_url: `https://${process.env.HOST_URL}/payment-success`,
            
            // ✅ RESTORED: This tells the Webhook who to message
            metadata: {
                whatsapp_number: userPhone,
                custom_fields: [
                    { display_name: "Payment Type", variable_name: "payment_type", value: "Donation" }
                ]
            }
        };

        // Subaccount Logic
        if (subaccount && subaccount !== 'PENDING') {
            payload.subaccount = subaccount;
            payload.bearer = "subaccount"; 
        }

        const response = await paystackApi.post('/transaction/initialize', payload);
        return response.data.data.authorization_url;
    } catch (error) {
        console.error("❌ Paystack Error:", error.response?.data || error.message);
        return null; 
    }
}

// 3. MONTHLY SUBSCRIPTION LINK (Restored Metadata)
async function createSubscriptionLink(amount, ref, email, subaccount, userPhone) {
    try {
        const payload = {
            amount: amount * 100, 
            email: email,
            reference: ref,
            metadata: {
                whatsapp_number: userPhone // ✅ Vital for Recurring Receipt
            }
        };

        if (subaccount && subaccount !== 'PENDING') {
            payload.subaccount = subaccount;
            payload.bearer = "subaccount";
        }

        const response = await paystackApi.post('/transaction/initialize', payload);
        return response.data.data.authorization_url;
    } catch (error) {
        console.error("❌ Paystack Sub Error:", error.response?.data || error.message);
        return null;
    }
}

// 4. VERIFY PAYMENT
async function verifyPayment(reference) {
    try {
        const response = await paystackApi.get(`/transaction/verify/${reference}`);
        return response.data.data;
    } catch (error) {
        console.error("❌ Paystack Verification Error:", error.message);
        return null;
    }
}

// 5. FETCH USER HISTORY
async function getTransactionHistory(email) {
    try {
        const response = await paystackApi.get(`/transaction?email=${email}&perPage=5&status=success`);
        const transactions = response.data.data;

        if (!transactions || transactions.length === 0) return "You have no recent giving history.";

        let historyMessage = "📜 *Your Last 5 Contributions:*\n\n";
        transactions.forEach((tx, index) => {
            const date = new Date(tx.paid_at).toLocaleDateString('en-ZA');
            const amount = (tx.amount / 100).toFixed(2);
            const type = tx.metadata?.custom_fields?.[0]?.value || "Donation"; 
            historyMessage += `${index + 1}. *R${amount}* - ${type} (${date})\n`;
        });
        return historyMessage;
    } catch (error) {
        console.error("❌ Error fetching history:", error.message);
        return "⚠️ Sorry, we couldn't fetch your history right now.";
    }
}

module.exports = { 
    createPaymentLink, 
    createSubscriptionLink, 
    verifyPayment, 
    getTransactionHistory 
};