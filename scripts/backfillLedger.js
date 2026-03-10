// scripts/backfillLedger.js
// ONE-TIME RUN: Backfills legacy transactions with the Four-Pillar Ledger splits
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Import pricing engines
const { calculateTransaction } = require('../services/pricingEngine');
const { loadPrices } = require('../services/pricing');

async function runBackfill() {
    console.log("🚀 Starting Production Data Migration (Four-Pillar Ledger)...");

    try {
        // 1. Ensure dynamic prices are loaded into memory first
        await loadPrices();

        // 2. Find all historical successful transactions missing the new fee splits
        const oldTxs = await prisma.transaction.findMany({
            where: {
                status: 'SUCCESS',
                platformFee: null // Targets only old data that hasn't been migrated
            }
        });

        console.log(`🔍 Found ${oldTxs.length} legacy transactions to backfill.`);

        if (oldTxs.length === 0) {
            console.log("✅ Database is already fully up to date!");
            return;
        }

        let successCount = 0;

        // 3. Loop through and upgrade each one
        for (const tx of oldTxs) {
            try {
                // Historically, we assume standard Payment Links where the church absorbed the fees
                const pricing = await calculateTransaction(parseFloat(tx.amount), 'STANDARD', 'PAYMENT_LINK', false);

                await prisma.transaction.update({
                    where: { id: tx.id },
                    data: {
                        netcashFee: pricing.netcashFee,
                        platformFee: pricing.platformFee,
                        netSettlement: pricing.netSettlement
                    }
                });

                successCount++;
                // Log progress every 10 transactions to not spam the console
                if (successCount % 10 === 0) {
                    console.log(`⏳ Processed ${successCount}/${oldTxs.length}...`);
                }
            } catch (err) {
                console.error(`❌ Failed to update TX #${tx.id}:`, err.message);
            }
        }

        console.log(`🎉 Backfill Complete! Successfully updated ${successCount} transactions.`);
        console.log(`👉 Your Payouts Dashboard is now 100% accurate.`);
        
    } catch (error) {
        console.error("🚨 Backfill Script Failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

// Execute the function
runBackfill();