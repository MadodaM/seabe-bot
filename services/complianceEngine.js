// services/complianceEngine.js
// VERSION: 1.0 (Real-time Fraud & PASA Directive 2 Enforcement)

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🚩 CONFIGURABLE RISK THRESHOLDS
const THRESHOLDS = {
    USER_DAILY_TX_COUNT: 5,        // Max payments from 1 phone per day
    USER_DAILY_TOTAL_ZAR: 15000,   // Max value from 1 phone per day
    MERCHANT_HOURLY_SPIKE: 50000,  // Alert if an org processes >R50k in 1 hour
    PLATFORM_MONTHLY_LIMIT: 9000000 // R9M (Warning track for PASA R10M limit)
};

/**
 * Runs a multi-dimensional velocity check before allowing a payment to proceed.
 * @param {string} phone - User's phone number
 * @param {string} churchCode - Organization code
 * @param {number} amount - Attempted payment amount
 */
async function runVelocityCheck(phone, churchCode, amount) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    try {
        // 1. 👤 USER LEVEL CHECK
        const userTxs = await prisma.transaction.findMany({
            where: {
                phone: phone,
                date: { gte: oneDayAgo },
                status: 'SUCCESS'
            }
        });

        if (userTxs.length >= THRESHOLDS.USER_DAILY_TX_COUNT) {
            return { 
                allowed: false, 
                reason: "USER_VELOCITY_EXCEEDED", 
                message: "You have reached your daily payment limit. Please try again tomorrow." 
            };
        }

        const userTotal = userTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
        if ((userTotal + amount) > THRESHOLDS.USER_DAILY_TOTAL_ZAR) {
            return { 
                allowed: false, 
                reason: "USER_VALUE_EXCEEDED", 
                message: "This transaction exceeds your daily value limit." 
            };
        }

        // 2. 🏛️ MERCHANT LEVEL CHECK (Anomalous Spike Detection)
        const merchantRecentTxs = await prisma.transaction.findMany({
            where: {
                churchCode: churchCode,
                date: { gte: oneHourAgo },
                status: 'SUCCESS'
            }
        });

        const merchantHourlyTotal = merchantRecentTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
        if (merchantHourlyTotal > THRESHOLDS.MERCHANT_HOURLY_SPIKE) {
            // We might not BLOCK the transaction, but we MUST flag it for Admin review
            console.warn(`🚩 COMPLIANCE ALERT: Abnormal spike for ${churchCode} (R${merchantHourlyTotal}/hr)`);
            // Logic to log to AuditLog could go here
        }

        // 3. 🌍 PLATFORM LEVEL CHECK (PASA Directive 2 Track)
        const platformMonthlyTxs = await prisma.transaction.aggregate({
            where: {
                date: { gte: startOfMonth },
                status: 'SUCCESS'
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        const currentMonthlyTotal = platformMonthlyTxs._sum.amount || 0;

        if (currentMonthlyTotal > THRESHOLDS.PLATFORM_MONTHLY_LIMIT) {
            console.error("🚨 CRITICAL COMPLIANCE: Platform is approaching PASA R10M limit.");
            // Send urgent WhatsApp/Email to Super Admin
        }

        return { allowed: true };

    } catch (error) {
        console.error("Compliance Engine Error:", error);
        // Fail safe: If the engine crashes, we allow the transaction but log the error
        return { allowed: true, flagged: true, error: error.message };
    }
}

module.exports = { runVelocityCheck, THRESHOLDS };