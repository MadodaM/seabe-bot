// services/pricingEngine.js

/**
 * 💳 SEABE PRICING MODEL (2026)
 * Guaranteed Minimum Margin: R1.00 per transaction
 */
const PRICING_TIERS = {
    // Payment Gateway Fees (Seabe Retail Cost)
    GATEWAY: {
        CAPITEC_PAY: { percent: 0.025, flat: 1.50 }, // 2.5% + R1.50
        INSTANT_EFT: { percent: 0.025, flat: 1.50 }, // 2.5% + R1.50
        CARD:        { percent: 0.035, flat: 2.50 }, // 3.5% + R2.50
        CASH_RETAIL: { percent: 0.050, flat: 3.00 }, // 5.0% + R3.00
        DEFAULT:     { percent: 0.025, flat: 1.50 }  // Fallback
    },
    // Module-Specific Platform Surcharges
    MODULE: {
        LMS_COURSE:      { percent: 0.10, minFlat: 5.00 }, // 10% (Min R5)
        RESTAURANT_BILL: { percent: 0.00, flat: 3.00 },    // R3.00 Table Fee
        RETAIL_ORDER:    { percent: 0.00, flat: 1.50 },    // R1.50 Conversational Fee
        STANDARD:        { percent: 0.00, flat: 0.00 }     // Churches/Burial (No extra platform fee)
    }
};

/**
 * Calculates the exact fee split and total amount to charge the user.
 * * @param {number} baseAmount - The original cost of the item/donation.
 * @param {string} moduleType - 'LMS_COURSE', 'RESTAURANT_BILL', 'RETAIL_ORDER', 'STANDARD'
 * @param {string} paymentMethod - 'CAPITEC_PAY', 'INSTANT_EFT', 'CARD', 'CASH_RETAIL'
 * @param {boolean} passFeesToUser - If true, user pays fees. If false, merchant absorbs them.
 */
function calculateTransaction(baseAmount, moduleType = 'STANDARD', paymentMethod = 'DEFAULT', passFeesToUser = true) {
    const amount = parseFloat(baseAmount);
    if (isNaN(amount) || amount <= 0) throw new Error("Invalid base amount");

    // 1. Calculate Module Platform Fee (Seabe's App Revenue)
    const modRule = PRICING_TIERS.MODULE[moduleType] || PRICING_TIERS.MODULE.STANDARD;
    let platformFee = (amount * modRule.percent) + (modRule.flat || 0);
    
    // Enforce Minimums (e.g., LMS minimum R5.00)
    if (modRule.minFlat && platformFee < modRule.minFlat) {
        platformFee = modRule.minFlat;
    }

    // 2. Calculate Gateway Fee (Netcash coverage + Seabe Margin)
    const gateRule = PRICING_TIERS.GATEWAY[paymentMethod] || PRICING_TIERS.GATEWAY.DEFAULT;
    const gatewayFee = (amount * gateRule.percent) + gateRule.flat;

    // 3. Tally the Totals
    const totalFees = platformFee + gatewayFee;
    
    let totalChargedToUser = amount;
    let settlementToMerchant = amount;

    if (passFeesToUser) {
        // The user pays the premium (e.g., R100 meal + R3 fee + Gateway = R105.50)
        totalChargedToUser = amount + totalFees;
        settlementToMerchant = amount; 
    } else {
        // The merchant absorbs the cost (e.g., Church Tithe of R100. Member pays R100, Church gets R96)
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

module.exports = { calculateTransaction, PRICING_TIERS };	