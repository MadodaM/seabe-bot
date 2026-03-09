// Inside your POST /webhook or /transaction/create route
import prisma from '../lib/prisma';
import { calculateDynamicSplit } from '../services/ledger';

async function handleIncomingPayment(req, res) {
  const { amount, method, churchCode, reference } = req.body; // e.g., method='CARD'

  // STEP 1: Fetch the Active Fee Configuration for this Provider/Method
  // This looks for the generic "NETCASH" "CARD" rate currently active
  const feeConfig = await prisma.feeConfiguration.findFirst({
    where: {
      provider: 'NETCASH', // Detect this based on the webhook source
      method: method,      // 'CARD' or 'EFT'
      isActive: true
    }
  });

  if (!feeConfig) {
    throw new Error('No active fee configuration found for this payment method.');
  }

  // STEP 2: Calculate the 4 Pillars dynamically
  const ledger = calculateDynamicSplit(amount, feeConfig);

  // STEP 3: Save to Database
  const transaction = await prisma.transaction.create({
    data: {
      churchCode,
      reference,
      amount: ledger.grossAmount,
      netcashFee: ledger.netcashFee,       // Calculated dynamically
      platformFee: ledger.platformFee,     // Calculated dynamically
      netSettlement: ledger.netSettlement, // Calculated dynamically
      status: 'SUCCESSFUL',
      type: 'OFFERING',
      method: method
    }
  });

  return res.json({ status: 'success', transaction });
}