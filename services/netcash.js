// services/netcash.js
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config();

// 🚀 NEW: Import the Pricing Engine
const { calculateTransaction } = require('./pricingEngine');

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
// NOTE: This expects the FINAL amount (After Pricing Engine has run in the router)
// ==========================================
async function createPaymentLink(finalAmount, ref, userPhone, orgName) {
    try {
        const cleanAmount = sanitizeMoney(finalAmount);
        if (cleanAmount == 0) return null;

        // 🛑 We are currently returning the Sandbox Preview page.
        // When NetCash approves your account, you will swap to the live link below!
        
        /*
        // NetCash Pay Now requires passing data via query parameters or a form POST
        const baseUrl = "https://paynow.netcash.co.za/site/paynow.aspx";
        const paymentUrl = `${baseUrl}?Method=8&ServiceKey=${PAYNOW_SERVICE_KEY}&p2=${ref}&p3=Payment to ${orgName}&p4=${cleanAmount}&p11=${userPhone}`;
        
        return paymentUrl;
        */

        // Returning a mock Sandbox Preview for now
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
// 3. TRANSACTION HISTORY (Multi-Tenant Safe)
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
            historyMessage += `${index + 1}. *R${tx.amount}* - ${tx.type || 'Payment'} (${date})\n`;
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
async function setupDebitOrderMandate(baseAmount, userPhone, orgName, ref) {
    try {
        // 🚀 PRICING ENGINE INTERCEPTION
        // Calculate the exact recurring monthly deduction including our margin
        const pricing = calculateTransaction(baseAmount, 'STANDARD', 'DEBIT_ORDER', true);

        console.log(`💳 Generating Netcash Mandate for ${userPhone}. Base: R${baseAmount} -> Monthly Total: R${pricing.totalChargedToUser}`);

        // Netcash Debit Order API integration goes here.
        // We generate a secure link where the user types in their bank account details and accepts the mandate.
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
    // NetCash dominates the Debit Order space. 
    // This function will eventually pull active NetCash mandates.
    return "NetCash Debit Order mandates are currently in Sandbox mode. No active mandates found.";
}

module.exports = { 
    createPaymentLink, 
    verifyPayment, 
    getTransactionHistory,
    setupDebitOrderMandate, // 🚀 Exported new engine
    listActiveSubscriptions
};