// services/complianceEngine.js
// VERSION: 2.0 (Velocity + PEP/Sanctions Risk Engine)

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🚩 CONFIGURABLE RISK THRESHOLDS
const THRESHOLDS = {
    USER_DAILY_TX_COUNT: 5,        // Max payments from 1 phone per day
    USER_DAILY_TOTAL_ZAR: 15000,   // Max value from 1 phone per day
    MERCHANT_HOURLY_SPIKE: 50000,  // Alert if an org processes >R50k in 1 hour
    PLATFORM_MONTHLY_LIMIT: 9000000 // R9M (Warning track for PASA R10M limit)
};

// 🛑 MOCK SANCTIONS & PEP DATABASE (For Auditor Demonstration)
const MOCK_WATCHLIST = {
    peps: ['jacob zuma', 'julius malema', 'cyril ramaphosa'],
    sanctions: ['gupta', 'osama', 'vladimir putin'],
    flaggedIds: ['9999999999999'] // A test ID you can use to trigger a block
};

/**
 * 1. VELOCITY CHECK (Prevents money laundering & card testing)
 */
async function runVelocityCheck(phone, churchCode, amount) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    try {
        // A. USER LEVEL CHECK
        const userTxs = await prisma.transaction.findMany({
            where: { phone: phone, date: { gte: oneDayAgo }, status: 'SUCCESS' }
        });

        if (userTxs.length >= THRESHOLDS.USER_DAILY_TX_COUNT) {
            return { allowed: false, reason: "USER_VELOCITY_EXCEEDED", message: "Daily payment limit reached." };
        }

        const userTotal = userTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
        if ((userTotal + amount) > THRESHOLDS.USER_DAILY_TOTAL_ZAR) {
            return { allowed: false, reason: "USER_VALUE_EXCEEDED", message: "Transaction exceeds daily FICA value limit." };
        }

        // B. MERCHANT LEVEL CHECK (Anomalous Spike Detection)
        const merchantRecentTxs = await prisma.transaction.findMany({
            where: { churchCode: churchCode, date: { gte: oneHourAgo }, status: 'SUCCESS' }
        });

        const merchantHourlyTotal = merchantRecentTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
        if (merchantHourlyTotal > THRESHOLDS.MERCHANT_HOURLY_SPIKE) {
            console.warn(`🚩 COMPLIANCE ALERT: Abnormal spike for ${churchCode} (R${merchantHourlyTotal}/hr)`);
        }

        return { allowed: true };

    } catch (error) {
        console.error("Compliance Engine Error:", error);
        return { allowed: true, flagged: true, error: error.message };
    }
}

/**
 * 2. PEP & SANCTIONS SCREENING (FICA Schedule 3)
 * Runs when a user registers or makes a high-value transaction.
 */
async function screenUserForRisk(firstName, lastName, idNumber) {
    if (!firstName && !lastName && !idNumber) return { isClean: true, riskScore: 0.1 };

    const fullName = `${firstName || ''} ${lastName || ''}`.toLowerCase().trim();
    let riskScore = 0.1; // Default low risk
    let flags = [];
    let isPepFound = false;
    let isSanctionHit = false;

    // Check PEPs
    if (MOCK_WATCHLIST.peps.some(pep => fullName.includes(pep))) {
        riskScore += 0.4;
        isPepFound = true;
        flags.push("PEP_MATCH");
    }

    // Check Sanctions
    if (MOCK_WATCHLIST.sanctions.some(badGuy => fullName.includes(badGuy))) {
        riskScore += 0.8;
        isSanctionHit = true;
        flags.push("SANCTION_MATCH");
    }

    // Check specific flagged IDs (For your testing)
    if (idNumber && MOCK_WATCHLIST.flaggedIds.includes(idNumber)) {
        riskScore += 0.9;
        isSanctionHit = true;
        flags.push("ID_ON_WATCHLIST");
    }

    // Cap score at 1.0 (100%)
    riskScore = Math.min(riskScore, 1.0);

    return {
        isClean: riskScore < 0.5,
        riskScore,
        isPepFound,
        isSanctionHit,
        flags,
        recommendedAction: riskScore >= 0.8 ? 'BLOCK' : (riskScore >= 0.5 ? 'FLAG_FOR_REVIEW' : 'APPROVE')
    };
}

module.exports = { runVelocityCheck, screenUserForRisk, THRESHOLDS };