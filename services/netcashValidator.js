// services/netcashValidator.js

/**
 * Netcash strict formatting rules (2026 Standards)
 */
const NetcashValidator = {
    
    // 1. Clean Names (Netcash hates special characters like é, #, or @ in batch files)
    cleanName: (name) => {
        if (!name) return "Member";
        // Remove everything except A-Z, 0-9, and spaces
        return name.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 30).trim();
    },

    // 2. Clean Phone Numbers for Account References
    // Must be 10 digits starting with 0, or clean 12 digits
    formatPhoneRef: (phone) => {
        let clean = phone.replace(/\D/g, '');
        if (clean.startsWith('27') && clean.length === 12) {
            clean = '0' + clean.substring(2);
        }
        return clean.substring(0, 10);
    },

    // 3. Amount Validator (Must be 2 decimal points, no currency symbols)
    formatAmount: (amount) => {
        const num = parseFloat(amount);
        if (isNaN(num) || num <= 0) return "0.00";
        // 🛡️ Clause 14.2: Default Item Limit R1,000
        if (num > 1000) {
            console.warn("⚠️ Amount exceeds R1,000 limit. Capping or flagging.");
            // You might want to throw an error here depending on business logic
        }
        return num.toFixed(2);
    },

    // 4. Batch File "K" Record Generator (The most sensitive part)
    // Ensures tabs are perfect and line lengths are correct
    validateBatchRecord: (record) => {
        const { ref, name, amount, actionDate } = record;
        
        const safeRef = NetcashValidator.formatPhoneRef(ref);
        const safeName = NetcashValidator.cleanName(name);
        const safeAmount = NetcashValidator.formatAmount(amount);
        
        // Ensure standard YYYYMMDD
        const safeDate = actionDate.replace(/\D/g, '').substring(0, 8);

        // Construct the Tab-Delimited string strictly
        // K [tab] Ref [tab] Name [tab] Amount [tab] Date [tab] [tab] [tab] [tab]
        return `K\t${safeRef}\t${safeName}\t${safeAmount}\t${safeDate}\t\t\t\t`;
    }
};

module.exports = NetcashValidator;