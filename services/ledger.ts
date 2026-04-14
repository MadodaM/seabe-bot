// services/ledger.ts
import { PrismaClient } from '@prisma/client';
// Import your WhatsApp sender if you want to trigger the welcome message here
// import { sendWhatsApp } from './twilioClient'; 

const prisma = new PrismaClient();

interface FeeConfig {
  baseFee: number;     // e.g., 2.50 (Rands)
  percentFee: number;  // e.g., 1.5 (represents 1.5%)
  seabeFixed: number;  // e.g., 1.00 (Rands)
  seabePercent: number;// e.g., 1.0 (represents 1.0%)
}

interface LedgerSplit {
  grossAmount: number;
  netcashFee: number;    // The Provider's Cut
  platformFee: number;   // Seabe's Revenue
  netSettlement: number; // The Church/Lwazi Payout
}

// The specific fee structure for Lwazi R69 Subscriptions
const LWAZI_FEE_CONFIG: FeeConfig = {
    baseFee: 1.50,      // Netcash fixed
    percentFee: 1.5,    // Netcash 1.5%
    seabeFixed: 1.00,   // Seabe flat fee
    seabePercent: 1.0   // Seabe 1%
};

/**
 * Pure Math Engine: Calculates the exact split of a transaction.
 */
export function calculateDynamicSplit(amount: number, config: FeeConfig): LedgerSplit {
  // 1. Calculate Provider Cost (Netcash/Ozow)
  let providerCost = (amount * (config.percentFee / 100)) + config.baseFee;
  
  // 2. Calculate Seabe Revenue
  let seabeRevenue = (amount * (config.seabePercent / 100)) + config.seabeFixed;

  // 3. Rounding to 2 decimals
  providerCost = Math.round(providerCost * 100) / 100;
  seabeRevenue = Math.round(seabeRevenue * 100) / 100;

  // 4. Calculate Net Settlement (The Remainder)
  const payout = amount - providerCost - seabeRevenue;

  return {
    grossAmount: amount,
    netcashFee: providerCost,
    platformFee: seabeRevenue,
    netSettlement: parseFloat(payout.toFixed(2)) 
  };
}

/**
 * Database Engine: Processes a Lwazi payment and updates the master ledger.
 */
export async function processLwaziPayment(transactionId: number) {
    const tx = await prisma.transaction.findUnique({ 
        where: { id: transactionId },
        include: { church: true, member: true }
    });
    
    if (!tx || tx.ledgerProcessed) return;

    // Convert Prisma Decimal to standard JS Number if necessary
    const rawAmount = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount);

    // 1. Run the Math Engine
    const split = calculateDynamicSplit(rawAmount, LWAZI_FEE_CONFIG);

    // 2. Run the Database Ledger writes (Atomic Transaction)
    await prisma.$transaction([
        // A. Record Net Settlement (Money destined for Lwazi HQ)
        prisma.transactionLedger.create({
            data: {
                churchId: tx.churchId,
                transactionId: tx.id,
                amount: split.netSettlement,
                type: 'CREDIT',
                category: 'SETTLEMENT',
                description: `Net payout for Lwazi TX: ${tx.reference}`,
                status: 'PENDING_PAYOUT' 
            }
        }),
        // B. Record Seabe Platform Fee (Your Revenue)
        prisma.transactionLedger.create({
            data: {
                churchId: tx.churchId,
                transactionId: tx.id,
                amount: split.platformFee,
                type: 'CREDIT',
                category: 'PLATFORM_REVENUE',
                description: `Seabe Platform Fee for TX: ${tx.reference}`,
                status: 'CLEARED'
            }
        }),
        // C. Record Gateway Expense (Netcash Cut)
        prisma.transactionLedger.create({
            data: {
                churchId: tx.churchId,
                transactionId: tx.id,
                amount: split.netcashFee,
                type: 'DEBIT',
                category: 'GATEWAY_FEE',
                description: `Netcash Fee for TX: ${tx.reference}`,
                status: 'CLEARED'
            }
        }),
        // D. Mark Transaction as securely processed
        prisma.transaction.update({
            where: { id: tx.id },
            data: { ledgerProcessed: true }
        }),
        // E. Activate the Student's Lwazi Profile
        ...(tx.memberId ? [
            prisma.member.update({
                where: { id: tx.memberId },
                data: { status: 'ACTIVE' }
            })
        ] : [])
    ]);

    console.log(`💰 [LEDGER] Shattered Lwazi TX ${tx.reference}: Net R${split.netSettlement}`);

    // Optional: Trigger WhatsApp welcome template here
    // if (tx.member && tx.phone) {
    //     const welcomeText = `Hi ${tx.member.firstName}! Welcome to Lwazi CAPS Micro-Tutor. 🧠 Your account is active. Are you ready to start today's quiz? Reply 'Yes' to begin!`;
    //     await sendWhatsApp(tx.phone, welcomeText, null, '+27875511057');
    // }
}