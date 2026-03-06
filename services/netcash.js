// services/netcash.js
// VERSION: 10.3 (Production Stable - Manual Fallback + Sanitization)
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config();

// 🚀 Import the Pricing Engine
const { calculateTransaction } = require('./pricingEngine');

// 🔑 NETCASH CONFIGURATION
const PAYNOW_SERVICE_KEY = process.env.NETCASH_PAYNOW_SERVICE_KEY;
const PAYNOW_URL = "https://paynow.netcash.co.za/site/paynow.aspx";

// 🚀 VENDOR KEY (Optional)
// Only load this if you have been issued an ISV Key by Netcash.
const VENDOR_KEY = process.env.NETCASH_VENDOR_KEY; 

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
// 1. GENERATE COMPLIANT POST FORM (Auto-Submit + Manual Backup)
// ==========================================
function generateAutoPostForm(txData) {
    const amount = sanitizeMoney(txData.amount);
    
    // SAFETY FIX: Remove double quotes to prevent HTML breaking
    // STRICT RULE: Description (p3) max 50 chars
    const rawDesc = txData.description || 'Seabe Payment';
    const cleanDesc = rawDesc.replace(/"/g, '').substring(0, 50);

    // Conditional Vendor Key Logic
    const vendorInput = VENDOR_KEY 
        ? `<input type="hidden" name="M2" value="${VENDOR_KEY}">` 
        : ``;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Pay via Netcash</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; background: #f4f7f6; font-family: sans-serif; color: #2c3e50; text-align: center; }
            .loader { border: 4px solid #e0e0e0; border-top: 4px solid #14b8a6; border-radius: 50%; width: 40px; height: 40px; animation: spin 0.8s linear infinite; margin-bottom: 20px; }
            .btn { background-color: #14b8a6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; border: none; cursor: pointer; margin-top: 20px; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: background 0.2s; }
            .btn:hover { background-color: #0d9488; }
            p { margin: 5px 0; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    </head>
    <body onload="setTimeout(function() { document.forms['netcash_pay'].submit(); }, 1500)">
        
        <div class="loader"></div>
        <p><strong>Connecting to Netcash...</strong></p>
        <p style="font-size:12px; opacity:0.7;">If you are not redirected automatically, click the button below.</p>
        
        <form name="netcash_pay" action="${PAYNOW_URL}" method="POST" target="_top">
            <input type="hidden" name="M1" value="${PAYNOW_SERVICE_KEY}">
            ${vendorInput}
            
            <input type="hidden" name="p2" value="${txData.reference}">
            <input type="hidden" name="p3" value="${cleanDesc}">
            <input type="hidden" name="p4" value="${amount}">
            
            <input type="hidden" name="Budget" value="Y">
            
            <input type="hidden" name="p10" value="${txData.email || ''}"> 
            <input type="hidden" name="p11" value="${txData.phone || ''}">

            <input type="hidden" name="submit" value="PAY">

            <button type="submit" class="btn">Click here to Pay R${amount}</button>
        </form>
    </body>
    </html>
    `;
}

// ==========================================
// 2. STANDARD PAYMENT LINK (Wrapper)
// ==========================================
async function createPaymentLink(finalAmount, ref, userPhone, orgName, email = '') {
    try {
        const cleanAmount = sanitizeMoney(finalAmount);
        if (cleanAmount == 0) return null;

        if (!PAYNOW_SERVICE_KEY) {
            console.error("❌ MISSING NETCASH PAYNOW KEY");
            return null;
        }

        const host = process.env.HOST_URL || 'https://seabe.tech';
        
        // Encode parameters securely
        const encodedOrg = encodeURIComponent(orgName);
        const encodedEmail = encodeURIComponent(email);
        
        // Create the internal redirect link that triggers generateAutoPostForm
        return `${host}/pay/redirect/${ref}?a=${cleanAmount}&p=${userPhone}&o=${encodedOrg}&e=${encodedEmail}`;

    } catch (error) {
        console.error("❌ NetCash Link Error:", error.message);
        return null; 
    }
}

// ==========================================
// 3. VERIFY PAYMENT (Deprecated/Polling)
// ==========================================
async function verifyPayment(reference) {
    // We rely on Webhooks now
    console.log(`ℹ️ Payment verification for ${reference} deferred to Webhook.`);
    return null; 
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
        const pricing = await calculateTransaction(baseAmount, 'STANDARD', 'DEBIT_ORDER', true);
        console.log(`💳 Generating Netcash Mandate for ${userPhone}. Total: R${pricing.totalChargedToUser}`);

        const host = process.env.HOST_URL || 'https://seabe.tech';
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
    return "To view or cancel active debit orders, please contact your administrator directly.";
}

module.exports = { 
    createPaymentLink, 
    generateAutoPostForm,
    verifyPayment, 
    getTransactionHistory,
    setupDebitOrderMandate,
    listActiveSubscriptions
};