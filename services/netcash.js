// services/netcash.js
const axios = require('axios');
require('dotenv').config();

// NetCash uses specific Service Keys for different features
const PAYNOW_SERVICE_KEY = process.env.NETCASH_PAYNOW_KEY || 'TEST_PAYNOW_KEY';
const DEBIT_ORDER_KEY = process.env.NETCASH_DEBIT_ORDER_KEY || 'TEST_DEBIT_ORDER_KEY';

// ==========================================
// 🛠️ HELPER: MONEY SANITIZER
// ==========================================
function sanitizeMoney(amount) {
    let cleanString = amount.toString().replace(/,/g, '.').replace(/[^\d.]/g, '');
    let numericAmount = parseFloat(cleanString);
    if (isNaN(numericAmount) || numericAmount <= 0) return 0;
    return numericAmount.toFixed(2); // NetCash also expects standard decimal format
}

// ==========================================
// 1. STANDARD PAYMENT LINK (Pay Now)
// ==========================================
async function createPaymentLink(amount, ref, userPhone, orgName) {
    try {
        const cleanAmount = sanitizeMoney(amount);
        if (cleanAmount == 0) return null;

        // 🛑 We are currently returning the Sandbox Preview page.
        // When NetCash approves your account, you will generate the live link below!
        
        /*
        // NetCash Pay Now requires passing data via query parameters or a form POST
        const baseUrl = "https://paynow.netcash.co.za/site/paynow.aspx";
        const paymentUrl = \`\${baseUrl}?Method=8&ServiceKey=\${PAYNOW_SERVICE_KEY}&p2=\${ref}&p3=Payment to \${orgName}&p4=\${cleanAmount}&p11=\${userPhone}\`;
        
        return paymentUrl;
        */

        // Returning a mock Sandbox Preview for now (You can duplicate your Ozow web route for this!)
        return 'https://seabe.tech/netcash-sandbox-preview';

    } catch (error) {
        console.error("❌ NetCash Link Error:", error.message);
        return null; 
    }
}

// ==========================================
// 2. VERIFY PAYMENT
// ==========================================
async function verifyPayment(reference) {
    try {
        // NetCash Pay Now verification usually happens via an inbound Webhook (Postback)
        // or by polling their statement API using the Account Service Key.
        
        // Mock verification for the Sandbox phase
        return { status: 'Complete', amount: 100.00, reference: reference };
    } catch (error) {
        console.error("❌ NetCash Verification Error:", error.message);
        return null;
    }
}

// ==========================================
// 3. TRANSACTION HISTORY (From Local DB)
// ==========================================
async function getTransactionHistory(phone) {
    const prisma = require('./prisma');
    try {
        const transactions = await prisma.transaction.findMany({
            where: { phone: phone, status: 'SUCCESS' },
            orderBy: { date: 'desc' },
            take: 5
        });

        if (transactions.length === 0) return "You have no recent giving history.";

        let historyMessage = "📜 *Your Last 5 Contributions (NetCash):*\n\n";
        transactions.forEach((tx, index) => {
            const date = new Date(tx.date).toLocaleDateString('en-ZA');
            historyMessage += `${index + 1}. *R${tx.amount}* - ${tx.type} (${date})\n`;
        });
        return historyMessage;
    } catch (error) {
        console.error("❌ DB History Error:", error.message);
        return "⚠️ Sorry, we couldn't fetch your history right now.";
    }
}

// ==========================================
// 4. DEBIT ORDERS (Mandates)
// ==========================================
async function listActiveSubscriptions(phone) {
    // NetCash dominates the Debit Order space. 
    // This function will eventually pull active NetCash mandates.
    return "NetCash Debit Order mandates are currently in Sandbox mode. No active mandates found.";
}

module.exports = { 
    createPaymentLink, 
    verifyPayment, 
    getTransactionHistory,
    listActiveSubscriptions
};