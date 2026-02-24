// paymentBot.js
// 📦 Pull in BOTH Payment Gateways
const ozow = require('./services/ozow'); 
const netcash = require('./services/netcash');

// 🎛️ THE MASTER TOGGLE (Reads from your .env file)
// Default to OZOW if not specified
const ACTIVE_GATEWAY_NAME = process.env.ACTIVE_GATEWAY || 'OZOW'; 
const gateway = ACTIVE_GATEWAY_NAME === 'NETCASH' ? netcash : ozow;

module.exports.process = async (incomingMsg, cleanPhone, member, twiml) => {
    
    const msgParts = incomingMsg.split(' ');
    const command = msgParts[0].toLowerCase();

    // ==========================================
    // 1. DYNAMIC PAYMENT GENERATION
    // ==========================================
    const paymentKeywords = ['pay', 'payment', 'tithe', 'premium', 'give'];
    
    if (paymentKeywords.includes(command)) {
        let orgName = "your organization";
        if (member?.churchCode) orgName = member.church.name;
        if (member?.societyCode) orgName = member.society.name;

        const ref = `SB-${Date.now()}`;
        
        // ✨ MAGIC: It automatically uses whichever gateway is active!
        const paymentLink = await gateway.createPaymentLink(100, ref, cleanPhone, orgName);

        twiml.message(`💳 *Secure Payment via ${ACTIVE_GATEWAY_NAME}*\n\nYou are giving to *${orgName}*.\n\nTap below to securely complete your payment:\n👉 ${paymentLink}`);
        return true;
    }

    // ==========================================
    // 2. HISTORY & VERIFICATION
    // ==========================================
    if (command === 'history') {
        const historyMessage = await gateway.getTransactionHistory(cleanPhone);
        twiml.message(historyMessage);
        return true;
    }

    if (command === 'verify') {
        const reference = msgParts[1];
        if (!reference) {
            twiml.message("⚠️ Please specify a reference. Example: *Verify SB-123*");
            return true;
        }

        const verifyData = await gateway.verifyPayment(reference);
        if (verifyData && (verifyData.status === 'Complete' || verifyData.status === 'success')) {
            twiml.message(`✅ **Verified via ${ACTIVE_GATEWAY_NAME}!**\nReference: ${reference}\nAmount: R${verifyData.amount}\nStatus: *SUCCESS*`);
        } else {
            twiml.message(`❌ **Payment Pending or Failed.**`);
        }
        return true;
    }

    if (command === 'subscriptions' || command === 'subs' || command === 'mandates') {
        const subMsg = await gateway.listActiveSubscriptions(cleanPhone);
        twiml.message(subMsg);
        return true;
    }

    return false; 
};