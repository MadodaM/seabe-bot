// services/pricingEngine.js
const { getPrice } = require('./pricing');

/**
 * 💳 DYNAMIC SEABE PRICING ENGINE (2026)
 * Fetches all variables from the Database to calculate fees.
 */
async function calculateTransaction(baseAmount, moduleType = 'STANDARD', paymentMethod = 'CAPITEC_PAY', passFeesToUser = true) {
    const amount = parseFloat(baseAmount);
    if (isNaN(amount) || amount <= 0) throw new Error("Invalid base amount");

    // 1. Map paymentMethod strings to DB keys
    // (Translates 'CAPITEC_PAY' -> 'TX_CAPITEC', etc.)
    let keyPrefix = 'TX_CAPITEC'; // Default
    if (paymentMethod === 'CARD') keyPrefix = 'TX_CARD';
    if (paymentMethod === 'CASH_RETAIL') keyPrefix = 'TX_RETAIL';

    // 2. Fetch Gateway Variables from DB
    const gatePct  = await getPrice(`${keyPrefix}_RT_PCT`);
    const gateFlat = await getPrice(`${keyPrefix}_RT_FLAT`);

    // 3. Fetch Module Variables from DB
    let modPct = 0;
    let modFlat = 0;
    let modMin = 0;

    if (moduleType === 'LMS_COURSE') {
        modPct = await getPrice('MOD_LMS_PCT');
        modMin = await getPrice('MOD_LMS_MIN');
    } else if (moduleType === 'RESTAURANT_BILL') {
        modFlat = await getPrice('MOD_REST_FLAT');
    } else if (moduleType === 'RETAIL_ORDER') {
        modFlat = await getPrice('MOD_RETAIL_FLAT');
    }

    // 4. Calculate Fees
    let platformFee = (amount * modPct) + modFlat;
    if (modMin && platformFee < modMin) platformFee = modMin;

    const gatewayFee = (amount * gatePct) + gateFlat;
    const totalFees = platformFee + gatewayFee;

    // 5. Tally the Totals
    let totalChargedToUser = amount;
    let settlementToMerchant = amount;

    if (passFeesToUser) {
        totalChargedToUser = amount + totalFees;
        settlementToMerchant = amount;
    } else {
        totalChargedToUser = amount;
        settlementToMerchant = amount - totalFees;
    }

    return {
        baseAmount: parseFloat(amount.toFixed(2)),
        platformFee: parseFloat(platformFee.toFixed(2)),
        gatewayFee: parseFloat(gatewayFee.toFixed(2)),
        totalFees: parseFloat(totalFees.toFixed(2)),
        totalChargedToUser: parseFloat(totalChargedToUser.toFixed(2)),
        settlementToMerchant: parseFloat(settlementToMerchant.toFixed(2)),
        currency: "ZAR"
    };
}

module.exports = { calculateTransaction };