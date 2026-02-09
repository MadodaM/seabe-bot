const axios = require('axios');
require('dotenv').config();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const paystackApi = axios.create({
    baseURL: 'https://api.paystack.co',
    headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
    }
});

// ==========================================
// 🛠️ HELPER: MONEY SANITIZER
// ==========================================
function sanitizeMoney(amount) {
    // 1. Convert to String & Replace comma with dot (70,15 -> 70.15)
    let cleanString = amount.toString().replace(/,/g, '.');
    
    // 2. Remove anything that isn't a number or dot (R70.15 -> 70.15)
    cleanString = cleanString.replace(/[^\d.]/g, '');

    // 3. Convert to Float
    let numericAmount = parseFloat(cleanString);

    // 4. Validate
    if (isNaN(numericAmount) || numericAmount <= 0) {
        console.error(`❌ Invalid Amount: ${amount}`);
        return 0;
    }

    // 5. Convert to Cents (Integer)
    return Math.round(numericAmount * 100);
}

// ==========================================
// 1. STANDARD PAYMENT LINK
// ==========================================
async function createPaymentLink(amount, ref, email, subaccount, userPhone, churchName) {
    try {
        // 🧹 Clean the money first!
        const amountInCents = sanitizeMoney(amount);
        if (amountInCents === 0) return null;

        const payload = {
            amount: amountInCents, 
            email: email,
            reference: ref,
            callback_url: `https://${process.env.HOST_URL}/payment-success`,
            metadata: {
                whatsapp_number: userPhone,
                church_name: churchName || "Seabe Digital", 
                custom_fields: [
                    { display_name: "Payment Type", variable_name: "payment_type", value: "Donation" }
                ]
            }
        };

        if (subaccount && subaccount !== 'PENDING') {
            payload.subaccount = subaccount;
            payload.bearer = "subaccount"; 
        }

        const response = await paystackApi.post('/transaction/initialize', payload);
        return response.data.data.authorization_url;
    } catch (error) {
        console.error("❌ Paystack Link Error:", error.response?.data || error.message);
        return null; 
    }
}

// ==========================================
// 2. SUBSCRIPTION LINK
// ==========================================
async function createSubscriptionLink(amount, ref, email, subaccount, userPhone, churchName) {
    try {
        // 🧹 Clean the money first!
        const amountInCents = sanitizeMoney(amount);
        if (amountInCents === 0) return null;

        const payload = {
            amount: amountInCents,
            email: email,
            reference: ref,
            metadata: {
                whatsapp_number: userPhone,
                church_name: churchName || "Seabe Digital"
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

// ==========================================
// 3. VERIFY PAYMENT
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

// ==========================================
// 4. TRANSACTION HISTORY
// ==========================================
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

// ==========================================
// 5. HELPER: Get Customer ID
// ==========================================
async function getCustomer(email) {
    try {
        const response = await paystackApi.get(`/customer/${email}`);
        if (response.data && response.data.status) {
            return response.data.data;
        }
        return null;
    } catch (error) {
        if (error.response?.status !== 404) console.error("Get Customer Error:", error.message);
        return null;
    }
}

// ==========================================
// 6. LIST ACTIVE SUBSCRIPTIONS
// ==========================================
async function listActiveSubscriptions(email) {
    try {
        const customer = await getCustomer(email);
        if (!customer) return [];

        const response = await paystackApi.get(`/subscription?customer=${customer.id}`);
        const allSubs = response.data.data;

        return allSubs.filter(sub => sub.status === 'active');
    } catch (error) {
        console.error("List Subs Error:", error.message);
        return [];
    }
}

// ==========================================
// 7. CANCEL SUBSCRIPTION
// ==========================================
async function cancelSubscription(code, token) {
    try {
        const response = await paystackApi.post('/subscription/disable', {
            code: code,
            token: token 
        });
        return response.data.status; 
    } catch (error) {
        console.error("Cancel Sub Error:", error.response?.data || error.message);
        return false;
    }
}

module.exports = { 
    createPaymentLink, 
    createSubscriptionLink, 
    verifyPayment, 
    getTransactionHistory,
    listActiveSubscriptions, 
    cancelSubscription 
};