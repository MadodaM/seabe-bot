// services/pricingEngine.js
const { getPrice } = require('./pricing');

/**
 * 💳 DYNAMIC SEABE PRICING ENGINE (2026)
 * Fetches all variables from the Database to calculate fees.
 */
async function calculateTransaction(baseAmount, moduleType = 'STANDARD', paymentMethod = 'PAYMENT_LINK', passFeesToUser = true) {
    const amount = parseFloat(baseAmount);
    if (isNaN(amount) || amount <= 0) throw new Error("Invalid base amount");

    // 1. Map paymentMethod strings to DB keys
    let keyPrefix = 'TX_CARD'; // Default for typical Payment Links
    if (paymentMethod === 'CAPITEC_PAY') keyPrefix = 'TX_CAPITEC';
    if (paymentMethod === 'CASH_RETAIL') keyPrefix = 'TX_RETAIL';
    if (paymentMethod === 'DEBIT_ORDER') keyPrefix = 'TX_DEBIT';

    // 2. Fetch Gateway Variables from DB
    let gatePct  = await getPrice(`${keyPrefix}_RT_PCT`);
    let gateFlat = await getPrice(`${keyPrefix}_RT_FLAT`);

    // Safety net: If DB isn't fully seeded yet, use standard Netcash fallback (1.5% + R2.50)
    if (gatePct === 0 && gateFlat === 0 && keyPrefix === 'TX_CARD') {
        gatePct = 0.015;
        gateFlat = 2.50;
    }

    // 3. Fetch Module Variables from DB (Seabe's Platform Fee)
    let modPct = 0;
    let modFlat = await getPrice('MOD_STANDARD_FLAT') || 5.00; // Default R5.00 Seabe fee fallback
    let modMin = 0;

    if (moduleType === 'LMS_COURSE') {
        modPct = await getPrice('MOD_LMS_PCT');
        modMin = await getPrice('MOD_LMS_MIN');
        modFlat = 0;
    } else if (moduleType === 'RESTAURANT_BILL') {
        modFlat = await getPrice('MOD_REST_FLAT');
    } else if (moduleType === 'RETAIL_ORDER') {
        modFlat = await getPrice('MOD_RETAIL_FLAT');
    }

    // 4. Calculate Fees
    let platformFee = (amount * modPct) + modFlat;
    if (modMin && platformFee < modMin) platformFee = modMin;

    const netcashFee = (amount * gatePct) + gateFlat;
    const totalFees = platformFee + netcashFee;

    // 5. Tally the Totals (The Four Pillars)
    let totalChargedToUser = amount;
    let netSettlement = amount;

    if (passFeesToUser) {
        totalChargedToUser = amount + totalFees;
        netSettlement = amount; // Church gets exactly what they asked for
    } else {
        totalChargedToUser = amount; // User pays exactly what they typed
        netSettlement = amount - totalFees; // Church absorbs the costs
    }

    // 🚀 ALIGNED WITH NETCASH.JS EXPECTATIONS
    return {
        baseAmount: parseFloat(amount.toFixed(2)),
        platformFee: parseFloat(platformFee.toFixed(2)), // 2. Seabe Fee
        netcashFee: parseFloat(netcashFee.toFixed(2)),   // 3. Gateway Fee
        totalFees: parseFloat(totalFees.toFixed(2)),
        totalChargedToUser: parseFloat(totalChargedToUser.toFixed(2)), // 1. Gross Amount
        netSettlement: parseFloat(netSettlement.toFixed(2)), // 4. Final Payout to Church
        currency: "ZAR"
    };
}

module.exports = { calculateTransaction };