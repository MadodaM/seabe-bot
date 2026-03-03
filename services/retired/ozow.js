// services/ozow.js
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

// Ozow requires specific keys for generating secure hashes
const SITE_CODE = process.env.OZOW_SITE_CODE || 'TEST_SITE_CODE';
const PRIVATE_KEY = process.env.OZOW_PRIVATE_KEY || 'TEST_PRIVATE_KEY';
const API_KEY = process.env.OZOW_API_KEY || 'TEST_API_KEY';

// ==========================================
// 🛠️ HELPER: MONEY SANITIZER
// ==========================================
function sanitizeMoney(amount) {
    let cleanString = amount.toString().replace(/,/g, '.').replace(/[^\d.]/g, '');
    let numericAmount = parseFloat(cleanString);
    if (isNaN(numericAmount) || numericAmount <= 0) return 0;
    return numericAmount.toFixed(2); // Ozow expects decimal format (e.g., 100.00), NOT cents
}

// ==========================================
// 🛠️ HELPER: OZOW HASH GENERATOR
// ==========================================
function generateOzowHash(payload) {
    // Ozow requires all payload values to be concatenated in lowercase, then hashed with the Private Key
    const stringToHash = Object.values(payload).join('').toLowerCase() + PRIVATE_KEY.toLowerCase();
    return crypto.createHash('sha512').update(stringToHash).digest('hex');
}

// ==========================================
// 1. STANDARD PAYMENT LINK
// ==========================================
async function createPaymentLink(amount, ref, userPhone, orgName) {
    try {
        const cleanAmount = sanitizeMoney(amount);
        if (cleanAmount == 0) return null;

        // 🛑 We are currently returning the Sandbox Preview page for the demo.
        // When you get your live Ozow keys, uncomment the payload logic below!
        
        /*
        const payload = {
            siteCode: SITE_CODE,
            countryCode: "ZA",
            currencyCode: "ZAR",
            amount: cleanAmount,
            transactionReference: ref,
            bankReference: `SEABE-${orgName.substring(0,5)}`,
            cancelUrl: `https://${process.env.HOST_URL}/payment-cancel`,
            errorUrl: `https://${process.env.HOST_URL}/payment-error`,
            successUrl: `https://${process.env.HOST_URL}/payment-success`,
            notifyUrl: `https://${process.env.HOST_URL}/api/webhooks/ozow`,
            isTest: true // Set to false in production
        };
        
        payload.hashCheck = generateOzowHash(payload);

        // POST to Ozow API to generate the actual link
        // const response = await axios.post('https://api.ozow.com/postpayment', payload);
        // return response.data.url;
        */

        // Returning the Sandbox Preview for now
        return 'https://seabe.tech/ozow-sandbox-preview';

    } catch (error) {
        console.error("❌ Ozow Link Error:", error.message);
        return null; 
    }
}

// ==========================================
// 2. VERIFY PAYMENT
// ==========================================
async function verifyPayment(reference) {
    try {
        // Ozow verifies via a GET request with your API Key
        // const response = await axios.get(`https://api.ozow.com/GetTransactionByReference?siteCode=${SITE_CODE}&transactionReference=${reference}`, {
        //     headers: { 'ApiKey': API_KEY }
        // });
        // return response.data;

        // Mock verification for the Sandbox phase
        return { status: 'Complete', amount: 100.00, reference: reference };
    } catch (error) {
        console.error("❌ Ozow Verification Error:", error.message);
        return null;
    }
}

// ==========================================
// 3. TRANSACTION HISTORY (From Local DB)
// ==========================================
async function getTransactionHistory(phone) {
    const prisma = require('./prisma');
    try {
        // Ozow does not store customer history like Paystack. 
        // We must pull this from your own Seabe Transaction ledger.
        const transactions = await prisma.transaction.findMany({
            where: { phone: phone, status: 'SUCCESS' },
            orderBy: { date: 'desc' },
            take: 5
        });

        if (transactions.length === 0) return "You have no recent giving history.";

        let historyMessage = "📜 *Your Last 5 Contributions (Ozow):*\n\n";
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
// 4. RECURRING EFT (Tokenization)
// ==========================================
async function listActiveSubscriptions(phone) {
    // Ozow handles subscriptions via "Tokenized EFTs". 
    // This will pull tokenized records from your DB once implemented.
    return "Ozow recurring EFTs are currently in Sandbox mode. No active mandates found.";
}

module.exports = { 
    createPaymentLink, 
    verifyPayment, 
    getTransactionHistory,
    listActiveSubscriptions
};