// services/netcash.js
// VERSION: 13.1 (White-labeled Seabe Pay Auto-Post UI)
const axios = require('axios');
const prisma = require('./db'); // 🔒 Uses your global encrypted Prisma interceptor
const crypto = require('crypto'); // 👈 ADD THIS NATIVE NODE LIBRARY
require('dotenv').config();

// 🚀 Import the Engines
const { calculateTransaction } = require('./pricingEngine');
const { runVelocityCheck } = require('./complianceEngine'); 

// 🔑 NETCASH CONFIGURATION
const NETCASH_MASTER_KEY = process.env.NETCASH_MASTER_KEY || process.env.NETCASH_PAYNOW_SERVICE_KEY;
const PAYNOW_URL = "https://paynow.netcash.co.za/site/paynow.aspx";
const VENDOR_KEY = process.env.NETCASH_VENDOR_KEY; 

// 🔐 AES-256 ENCRYPTION SETUP
// Must be exactly 32 characters long. We fall back to a hardcoded one for testing, but you MUST add this to your .env
const ENCRYPTION_KEY = process.env.SEABE_ENCRYPTION_KEY || 'SeabeDigitalSecureKey2026!@#$%^&'; 
const IV_LENGTH = 16;

function encryptReference(reference) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(reference);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    // Combine IV and Encrypted data, and convert to a URL-safe Base64 string
    return Buffer.from(iv.toString('hex') + ':' + encrypted.toString('hex')).toString('base64url');
}

function decryptReference(secureToken) {
    try {
        const text = Buffer.from(secureToken, 'base64url').toString('ascii');
        let textParts = text.split(':');
        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        return null; // Invalid or tampered token
    }
}

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
// ==========================================
function generateAutoPostForm(txData) {
    const amount = sanitizeMoney(txData.amount);
    const rawDesc = txData.description || 'Seabe Payment';
    const cleanDesc = rawDesc.replace(/"/g, '').substring(0, 50);

    const vendorInput = VENDOR_KEY 
        ? `<input type="hidden" name="M2" value="${VENDOR_KEY}">` 
        : ``;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Seabe Pay Secure Checkout</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; background: #f4f7f6; font-family: sans-serif; color: #2c3e50; text-align: center; }
            .loader { border: 4px solid #e0e0e0; border-top: 4px solid #14b8a6; border-radius: 50%; width: 40px; height: 40px; animation: spin 0.8s linear infinite; margin-bottom: 20px; }
            .btn { background-color: #14b8a6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; border: none; cursor: pointer; margin-top: 20px; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: background 0.2s; }
            .btn:hover { background-color: #0d9488; }
            .seabe-brand { font-size: 24px; font-weight: 900; color: #1e272e; margin-bottom: 10px; letter-spacing: -0.5px; }
            .seabe-brand span { color: #14b8a6; }
            p { margin: 5px 0; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    </head>
    <body onload="setTimeout(function() { document.forms['netcash_pay'].submit(); }, 1500)">
        <div class="seabe-brand">Seabe <span>Pay</span></div>
        <div class="loader"></div>
        <p><strong>Connecting to secure gateway...</strong></p>
        <p style="font-size:12px; opacity:0.7;">If you are not redirected automatically, click the button below.</p>
        
        <form name="netcash_pay" action="${PAYNOW_URL}" method="POST" target="_top">
            <input type="hidden" name="M1" value="${NETCASH_MASTER_KEY}">
            ${vendorInput}
            <input type="hidden" name="p2" value="${txData.reference}">
            <input type="hidden" name="p3" value="${cleanDesc}">
            <input type="hidden" name="p4" value="${amount}">
            <input type="hidden" name="Budget" value="Y">
            <input type="hidden" name="p10" value="${txData.email || ''}"> 
            <input type="hidden" name="p11" value="${txData.phone || ''}">
            <input type="hidden" name="submit" value="PAY">
            <button type="submit" class="btn">Proceed to Secure Payment</button>
        </form>
    </body>
    </html>
    `;
}

// ==========================================
// 2. DIRECT LINK GENERATOR (Risk & Fee Aware)
// ==========================================
/**
 * Generates a direct Netcash link while guaranteeing the PENDING transaction exists in the DB.
 * Supports both Positional Arguments (Collections) and Object Signatures (WhatsApp Bot).
 */
async function createPaymentLink(amountArg, refArg, phoneArg, orgNameArg, emailArg = '', churchCodeArg = 'UNKNOWN') {
    try {
        // 1. Unpack flexible arguments
        let amount, ref, phone, orgName, email, churchCode;

        if (typeof amountArg === 'object' && amountArg !== null) {
            amount = amountArg.amount;
            ref = amountArg.reference;
            phone = amountArg.phone || '0000000000';
            orgName = amountArg.description || 'Seabe Payment';
            email = amountArg.email || '';
            churchCode = amountArg.churchCode || 'UNKNOWN';
        } else {
            amount = amountArg;
            ref = refArg;
            phone = phoneArg || '0000000000';
            orgName = orgNameArg || 'Seabe Payment';
            email = emailArg || '';
            churchCode = churchCodeArg || 'UNKNOWN';
        }

        const cleanAmount = sanitizeMoney(amount);
        if (cleanAmount == 0) return null;

        if (!NETCASH_MASTER_KEY) {
            console.error("❌ MISSING NETCASH MASTER KEY");
            return null;
        }

        // 🛡️ STEP 1: RUN VELOCITY & RISK CHECK
        const complianceCheck = await runVelocityCheck(phone, churchCode, parseFloat(cleanAmount));
        if (!complianceCheck.allowed) {
            console.warn(`⛔ BLOCKED: Velocity Check Failed for ${phone}. Reason: ${complianceCheck.reason}`);
            return `BLOCKED_RISK:${complianceCheck.message}`; 
        }

        // 💰 STEP 2: CALCULATE FEE SPLITS
        const pricing = await calculateTransaction(parseFloat(cleanAmount), 'STANDARD', 'PAYMENT_LINK', false);
        
        // 💡 STEP 3: SMART EXTRACTION (First 6 Characters)
        let finalChurchCode = churchCode;
        if (!finalChurchCode || finalChurchCode === 'UNKNOWN') {
            // Extracts exactly the first 6 characters (e.g., 'BS-001' or 'TES247')
            finalChurchCode = ref.substring(0, 6); 
        }
        
        // 🛡️ SAFETY CHECK: Ensure the RESOLVED code is perfectly formatted
        if (!finalChurchCode) throw new Error("Missing churchCode in payment link request.");
        const safeCode = finalChurchCode.toUpperCase().trim();

        // Check if the church actually exists before trying to connect
        const orgExists = await prisma.church.findUnique({ where: { code: safeCode } });
        if (!orgExists) {
            throw new Error(`The organization code '${safeCode}' does not exist in the database.`);
        }

        // 💾 STEP 4: GUARANTEE LEDGER RECORD (SINGLE UPSERT)
        const member = await prisma.member.findFirst({ where: { phone: phone } });

        const transaction = await prisma.transaction.upsert({
            where: { reference: ref },
            update: { 
                amount: pricing.baseAmount,
                status: 'PENDING',
                netcashFee: pricing.netcashFee,
                platformFee: pricing.platformFee,
                netSettlement: pricing.netSettlement
            },
            create: {
                reference: ref,
                amount: pricing.baseAmount,
                type: 'PAYMENT_LINK', // 👈 Fixed undefined type variable
                status: 'PENDING',
                method: 'NETCASH',
                phone: phone,
                
                // Strict relationships
                church: { connect: { code: safeCode } },
                ...(member ? { member: { connect: { id: member.id } } } : {}),
                
                // Fee splits
                netcashFee: pricing.netcashFee,
                platformFee: pricing.platformFee,
                netSettlement: pricing.netSettlement
            }
        });

        // 🚀 STEP 5: GENERATE ENCRYPTED SHORT LINK
        const BASE_URL = process.env.BASE_URL || 'https://seabe-bot-test.onrender.com';
        
        // Encrypt the reference number
        const secureToken = encryptReference(ref);
        
        // Return a beautiful, short, white-labeled URL
        return `${BASE_URL}/secure-pay/${secureToken}`;

    } catch (error) {
        console.error("❌ NetCash Link Error:", error.message);
        return null; 
    }
}

// ==========================================
// 3. VERIFY PAYMENT (Deferred to Webhook)
// ==========================================
async function verifyPayment(reference) {
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

        const host = process.env.BASE_URL || 'https://seabe.tech';
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
	decryptReference,
    verifyPayment, 
    getTransactionHistory,
    setupDebitOrderMandate,
    listActiveSubscriptions
};