const axios = require('axios');

async function provisionNetCashAccount(orgData) {
    const payload = {
        // NetCash Partner Credentials (Your Master Keys)
        "PartnerId": process.env.NETCASH_PARTNER_ID,
        "PartnerSecret": process.env.NETCASH_PARTNER_SECRET,
        
        // The New Client Data
        "MerchantName": orgData.name,
        "ContactPerson": orgData.adminName,
        "Email": orgData.email,
        "Mobile": orgData.phone,
        "BankDetails": {
            "BankName": orgData.bankName,
            "BranchCode": orgData.branchCode,
            "AccountNumber": orgData.accountNumber
        },
        "SettlementFrequency": "MONTHLY" 
    };

    try {
        const response = await axios.post('https://api.netcash.co.za/merchants/create', payload);
        return response.data; // This usually returns the new Merchant ID and API Key
    } catch (error) {
        console.error("NetCash Provisioning Failed:", error.response?.data || error.message);
        return null;
    }
}

module.exports = { provisionNetCashAccount };