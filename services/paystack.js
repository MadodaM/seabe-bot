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

// 2. STANDARD PAYMENT LINK (Now accepts churchName)
async function createPaymentLink(amount, ref, email, subaccount, userPhone, churchName) {
    try {
        const payload = {
            amount: amount * 100, 
            email: email,
            reference: ref,
            callback_url: `https://${process.env.HOST_URL}/payment-success`,
            
            // ✅ METADATA: Now stores the Church Name safely
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
        console.error("❌ Paystack Error:", error.response?.data || error.message);
        return null; 
    }
}

// 3. SUBSCRIPTION LINK (Now accepts churchName)
async function createSubscriptionLink(amount, ref, email, subaccount, userPhone, churchName) {
    try {
        const payload = {
            amount: amount * 100, 
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
// 5. Transaction History
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


// 6. HELPER: Get Customer ID from Email
async function getCustomer(email) {
    try {
        const response = await paystackApi.get(`/customer/${email}`);
        if (response.data && response.data.status) {
            return response.data.data;
        }
        return null;
    } catch (error) {
        // Only log if it's a real error, not just "customer not found"
        if (error.response?.status !== 404) console.error("Get Customer Error:", error.message);
        return null;
    }
}

// 7. LIST ACTIVE SUBSCRIPTIONS
async function listActiveSubscriptions(email) {
    try {
        // First, find the customer ID
        const customer = await getCustomer(email);
        if (!customer) return [];

        // Fetch subscriptions for this customer
        const response = await paystackApi.get(`/subscription?customer=${customer.id}`);
        const allSubs = response.data.data;

        // Filter only the active ones
        return allSubs.filter(sub => sub.status === 'active');
    } catch (error) {
        console.error("List Subs Error:", error.message);
        return [];
    }
}

// 8. CANCEL SUBSCRIPTION
async function cancelSubscription(code, token) {
    try {
        const response = await paystackApi.post('/subscription/disable', {
            code: code,
            token: token // Paystack requires the email_token for security
        });
        return response.data.status; // Returns true if successful
    } catch (error) {
        console.error("Cancel Sub Error:", error.response?.data || error.message);
        return false;
    }
}

// 🔴 UPDATE EXPORTS
module.exports = { 
    createPaymentLink, 
    createSubscriptionLink, 
    verifyPayment, 
    getTransactionHistory,
    listActiveSubscriptions, // New
    cancelSubscription       // New
};
