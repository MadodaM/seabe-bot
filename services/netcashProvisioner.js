// services/netcashProvisioning.js
const axios = require('axios');
require('dotenv').config();

/**
 * Provisions a new Netcash sub-account for a tenant (Church/Burial Society)
 * NOTE: Ensure your Partner ID and specific REST Endpoint are verified 
 * with your Netcash Account Manager.
 */
async function provisionNetCashAccount(orgData) {
    // 1. Environment Toggle (Sandbox vs Production)
    const isProd = process.env.NODE_ENV === 'production';
    
    // Netcash uses specific endpoints for Partner Onboarding. 
    // (Replace these with the exact URLs provided in your Netcash API documentation)
    const NETCASH_API_URL = isProd 
        ? 'https://api.netcash.co.za/partner/v1/merchants/create' 
        : 'https://apistaging.netcash.co.za/partner/v1/merchants/create'; 

    // 2. Data Sanitization (Banks hate special characters and integers for account numbers)
    const cleanPhone = orgData.phone ? orgData.phone.replace(/\D/g, '') : "";
    const cleanName = orgData.name ? orgData.name.substring(0, 50) : "Unnamed Org";

    const payload = {
        // NetCash Partner Credentials (Your Master Keys)
        "PartnerId": process.env.NETCASH_PARTNER_ID,
        "PartnerSecret": process.env.NETCASH_PARTNER_SECRET,
        
        // The New Client Data
        "MerchantName": cleanName,
        "ContactPerson": orgData.adminName || "Administrator",
        "Email": orgData.email,
        "Mobile": cleanPhone,
        "BankDetails": {
            "BankName": orgData.bankName || "",
            "BranchCode": orgData.branchCode ? orgData.branchCode.toString() : "",
            "AccountNumber": orgData.accountNumber ? orgData.accountNumber.toString() : ""
        },
        "SettlementFrequency": "MONTHLY" 
    };

    try {
        console.log(`🚀 Provisioning Netcash account for: ${cleanName}...`);
        
        const response = await axios.post(NETCASH_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 10000 // ⏱️ 10-second timeout so it doesn't hang the bot if Netcash is down
        });

        console.log(`✅ Netcash Account Created: Merchant ID ${response.data.MerchantId || 'SUCCESS'}`);
        
        // This usually returns the new Merchant ID and API Keys
        return response.data; 
        
    } catch (error) {
        // Enhanced Error Logging to see EXACTLY what Netcash rejected
        const errorMsg = error.response?.data?.message || error.response?.data || error.message;
        console.error(`❌ NetCash Provisioning Failed for ${cleanName}:`, errorMsg);
        
        return null;
    }
}

module.exports = { provisionNetCashAccount };