// services/netcash.js
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config();

// 🚀 Import the Pricing Engine
const { calculateTransaction } = require('./pricingEngine');

// 🔑 NETCASH CONFIGURATION
const PAYNOW_SERVICE_KEY = process.env.NETCASH_PAYNOW_KEY;
const DEBIT_ORDER_KEY = process.env.NETCASH_DEBIT_ORDER_KEY;
const VENDOR_KEY = '24ade73c-98cf-47b3-99be-cc7b867b3080'; // 🚀 COMPLIANCE: Official Netcash ISV Key
const PAYNOW_URL = "https://paynow.netcash.co.za/site/paynow.aspx";

// ==========================================
// 🛠️ HELPER: MONEY SANITIZER
// ==========================================
function sanitizeMoney(amount) {
    let cleanString = amount.toString().replace(/,/g, '.').replace(/[^\d.]/g, '');
    let numericAmount = parseFloat(cleanString);
    if (isNaN(numericAmount) || numericAmount <= 0) return "0.00";
    return numericAmount.toFixed(2); 
}

// ==========================================
// 1. GENERATE COMPLIANT POST FORM (Auto-Submit)
// 🚀 This replaces the old GET redirect to ensure ISV Compliance
// ==========================================
function generateAutoPostForm(txData) {
    const amount = sanitizeMoney(txData.amount);
    
    // We render a full HTML page that automatically submits the form upon loading
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Secure Payment Redirect</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{display:flex;justify-content:center;align-items:center;height:100vh;background:#f4f7f6;font-family:sans-serif;}.loader{border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;width:30px;height:30px;animation:spin 1s linear infinite;}@keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}</style>
    </head>
    <body onload="document.forms['netcash_pay'].submit()">
        <div style="text-align:center;">
            <div class="loader" style="margin:0 auto 15px auto;"></div>
            <p><strong>Securing connection to Netcash...</strong></p>
            <p style="font-size:12px; color:#7f8c8d;">Please do not close this window.</p>
        </div>
        
        <form name="netcash_pay" action="${PAYNOW_URL}" method="POST" target="_top">
            <input type="hidden" name="M1" value="${PAYNOW_SERVICE_KEY}">
            <input type="hidden" name="M2" value="${VENDOR_KEY}"> <input type="hidden" name="p2" value="${txData.reference}">
            <input type="hidden" name="p3" value="${txData.description}">
            <input type="hidden" name="p4" value="${amount}">
            <input type="hidden" name="Budget" value="Y"> <input type="hidden" name="p11" value="${txData.phone}">
        </form>
    </body>
    </html>
    `;
}

// ==========================================
// 2. STANDARD PAYMENT LINK (Wrapper)
// ==========================================
async function createPaymentLink(finalAmount, ref, userPhone, orgName) {
    try {
        const cleanAmount = sanitizeMoney(finalAmount);
        if (cleanAmount == 0) return null;

        if (!PAYNOW_SERVICE_KEY) {
            console.error("❌ MISSING NETCASH PAYNOW KEY");
            return null;
        }

        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        
        // 🚀 COMPLIANCE UPDATE:
        // Instead of sending the user directly to Netcash (GET), we send them to OUR internal route (GET).
        // Our internal route (routes/link.js) will then render the POST form (generateAutoPostForm).
        // We pass the parameters securely in the URL query string.
        const encodedOrg = encodeURIComponent(orgName);
        return `${host}/pay/redirect/${ref}?a=${cleanAmount}&p=${userPhone}&o=${encodedOrg}`;

    } catch (error) {
        console.error("❌ NetCash Link Error:", error.message);
        return null; 
    }
}

// ==========================================
// 3. VERIFY PAYMENT (Deprecated/Polling)
// ==========================================
async function verifyPayment(reference) {
    try {
        // ⚠️ DEPRECATED FOR PRODUCTION
        // We now rely 100% on the `routes/webhooks.js` file (ITN) to verify payments.
        // Polling is inefficient. We return null here to force the system to wait for the Webhook.
        console.log(`ℹ️ Payment verification for ${reference} deferred to Webhook.`);
        return null; 
    } catch (error) {
        console.error("❌ NetCash Verification Error:", error.message);
        return null;
    }
}

// ==========================================
// 4. TRANSACTION HISTORY
// ==========================================
async function getTransactionHistory(memberId) {
    try {
        const transactions = await prisma.transaction.findMany({
            where: { memberId: parseInt(memberId), status: 'SUCCESS' },
            orderBy: { date: 'desc' },
            take: 5
        });

        if (transactions.length === 0) return "You have no recent giving history.";

        let historyMessage = "📜 *Your Last 5 Contributions:*\n\n";
        transactions.forEach((tx, index) => {
            const date = new Date(tx.date).toLocaleDateString('en-ZA');
            historyMessage += `${index + 1}. *R${tx.amount.toFixed(2)}* - ${tx.type || 'Payment'} (${date})\n`;
        });
        return historyMessage;
    } catch (error) {
        console.error("❌ DB History Error:", error.message);
        return "⚠️ Sorry, we couldn't fetch your history right now.";
    }
}

// ==========================================
// 5. DEBIT ORDERS (Mandates)
// ==========================================
async function setupDebitOrderMandate(baseAmount, userPhone, orgName, ref) {
    try {
        // 🚀 PRICING ENGINE INTERCEPTION (ASYNC UPDATE)
        const pricing = await calculateTransaction(baseAmount, 'STANDARD', 'DEBIT_ORDER', true);

        console.log(`💳 Generating Netcash Mandate for ${userPhone}. Base: R${baseAmount} -> Monthly Total: R${pricing.totalChargedToUser}`);

        // Netcash Debit Order API integration goes here.
        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        const mandateUrl = `${host}/mandate/sign?ref=${ref}&amount=${pricing.totalChargedToUser}&phone=${userPhone}&org=${encodeURIComponent(orgName)}`;
        
        return {
            mandateUrl: mandateUrl,
            pricing: pricing
        };
    } catch (error) {
        console.error("❌ Mandate Setup Error:", error.message);
        return null;
    }
}

async function listActiveSubscriptions(phone) {
    // Placeholder: This requires a separate API call to Netcash NIF
    return "To view or cancel active debit orders, please contact your administrator directly.";
}

module.exports = { 
    createPaymentLink, 
    generateAutoPostForm, // 🚀 New Export
    verifyPayment, 
    getTransactionHistory,
    setupDebitOrderMandate,
    listActiveSubscriptions
};