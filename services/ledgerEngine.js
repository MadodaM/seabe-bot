// services/ledgerEngine.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateTransaction } = require('./pricingEngine');
const { sendWhatsApp } = require('./twilioClient'); // To send the welcome template!

/**
 * 📊 The Shatter Logic
 * Breaks a successful payment into 3 exact ledger entries.
 */
 
 
 
async function recordSplit(transactionId) {
    // 1. Fetch the transaction and associated member/org
    const tx = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { church: true, member: true }
    });

    if (!tx) throw new Error("Transaction not found");
    if (tx.status !== 'SUCCESS') return { status: 'IGNORED', reason: 'Transaction not successful yet' };
    if (tx.ledgerProcessed) return { status: 'IGNORED', reason: 'Already processed in ledger' };

    // 2. Calculate the exact split using your existing Pricing Engine
    // Assumes passFeesToUser = true for standard billing
    const split = await calculateTransaction(tx.amount, tx.type || 'STANDARD', tx.method || 'CARD', true);

    try {
        // 3. 🛑 ATOMIC DATABASE TRANSACTION
        // If any of these 4 steps fail, the whole thing rolls back so no money is lost.
        await prisma.$transaction(async (prismaCtx) => {
            
            // A. Record Net Settlement (What goes to Lwazi HQ or the Church)
            await prismaCtx.transactionLedger.create({
                data: {
                    churchId: tx.churchId,
                    transactionId: tx.id,
                    amount: split.netSettlement,
                    type: 'CREDIT',
                    category: 'SETTLEMENT',
                    description: `Net payout for TX: ${tx.reference}`,
                    status: 'PENDING_PAYOUT' // Waiting for weekly EFT
                }
            });

            // B. Record Seabe Platform Fee (Your Revenue)
            await prismaCtx.transactionLedger.create({
                data: {
                    churchId: tx.churchId,
                    transactionId: tx.id,
                    amount: split.platformFee,
                    type: 'CREDIT',
                    category: 'PLATFORM_REVENUE',
                    description: `Seabe Platform Fee for TX: ${tx.reference}`,
                    status: 'CLEARED'
                }
            });

            // C. Record Gateway Expense (What Netcash took)
            await prismaCtx.transactionLedger.create({
                data: {
                    churchId: tx.churchId,
                    transactionId: tx.id,
                    amount: split.netcashFee,
                    type: 'DEBIT',
                    category: 'GATEWAY_FEE',
                    description: `Netcash Fee for TX: ${tx.reference}`,
                    status: 'CLEARED'
                }
            });

            // D. Mark Master Transaction as safely ledgered
            await prismaCtx.transaction.update({
                where: { id: tx.id },
                data: { ledgerProcessed: true }
            });

            // E. Lwazi Specific: Mark member as ACTIVE if this was a Lwazi Subscription
            if (tx.church.code === 'LWAZI_HQ' && tx.memberId) {
                await prismaCtx.member.update({
                    where: { id: tx.memberId },
                    data: { status: 'ACTIVE' }
                });
            }
        });

        console.log(`💰 [LEDGER] Shattered TX ${tx.reference}: Net R${split.netSettlement} settled to Org #${tx.churchId}`);

        // 4. Send the WhatsApp Welcome Template if it's Lwazi!
        if (tx.church.code === 'LWAZI_HQ' && tx.phone && tx.member) {
            // Using your Twilio Client with the Lwazi number override
            const welcomeText = `Hi ${tx.member.firstName}! Welcome to Lwazi CAPS Micro-Tutor. 🧠 Your account is active. Are you ready to start today's quiz? Reply 'Yes' to begin!`;
            // Note: Make sure this text matches your approved Twilio Template EXACTLY to avoid Error 63016
            await sendWhatsApp(tx.phone, welcomeText, null, '+27875511057');
        }

        return { status: 'SUCCESS', split };

    } catch (error) {
        console.error(`❌ Ledger failure for TX: ${tx.reference}`, error);
        throw error;
    }
}

module.exports = { recordSplit };