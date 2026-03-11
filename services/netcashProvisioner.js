// services/netcashProvisioning.js
// Option A: TPPP / Aggregator Master Routing Engine
const crypto = require('crypto');

/**
 * In the TPPP Model, we do NOT create sub-accounts on Netcash.
 * Instead, we generate a unique cryptographic Routing ID for the organization.
 * When they receive a payment, we pass this ID to our Master Netcash Account.
 * When Netcash sends the webhook back, we use this ID to drop the funds into the correct virtual ledger.
 */
async function provisionNetCashAccount(orgData) {
    try {
        const cleanName = orgData.name ? orgData.name.substring(0, 50) : "Unnamed Org";
        console.log(`🏦 TPPP Routing Activation for: ${cleanName}`);

        // Generate a secure, unique routing key for this specific organization
        // Format: SEABE-[8 Random Characters]
        const routingId = 'SEABE-' + crypto.randomBytes(4).toString('hex').toUpperCase();

        // Simulate a brief processing time so the UI doesn't blink too fast
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`✅ Organization Activated for Payments. Routing ID: ${routingId}`);

        // Return the MASTER credentials and the new Routing Key.
        // The 'PayNowKey' here is actually saved as the 'subaccountCode' in your database!
        return {
            MerchantId: process.env.NETCASH_MASTER_ID || "MASTER_SEABE_ACCOUNT", 
            PayNowKey: routingId                
        };

    } catch (error) {
        console.error("TPPP Activation Failed:", error);
        throw new Error("Failed to activate organization routing.");
    }
}

module.exports = {
    provisionNetCashAccount
};