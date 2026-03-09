// services/ledger.ts

interface FeeConfig {
  baseFee: number;     // e.g., 2.50
  percentFee: number;  // e.g., 0.025 (2.5%)
  seabeFixed: number;  // e.g., 5.00
  seabePercent: number;// e.g., 0.0
}

interface LedgerSplit {
  grossAmount: number;
  netcashFee: number;    // The Provider's Cut
  platformFee: number;   // Seabe's Revenue
  netSettlement: number; // The Church's Payout
}

export function calculateDynamicSplit(amount: number, config: FeeConfig): LedgerSplit {
  
  // 1. Calculate Provider Cost (Netcash/Ozow)
  // Formula: (Amount * %) + Base Fee
  let providerCost = (amount * (config.percentFee / 100)) + config.baseFee;
  
  // 2. Calculate Seabe Revenue
  // Formula: (Amount * %) + Base Markup
  let seabeRevenue = (amount * (config.seabePercent / 100)) + config.seabeFixed;

  // 3. Rounding (Crucial for Financials)
  // We use a simple rounding strategy here, but ideally use a library like currency.js
  providerCost = Math.round(providerCost * 100) / 100;
  seabeRevenue = Math.round(seabeRevenue * 100) / 100;

  // 4. Calculate Net Settlement (The Remainder)
  const payout = amount - providerCost - seabeRevenue;

  return {
    grossAmount: amount,
    netcashFee: providerCost,
    platformFee: seabeRevenue,
    netSettlement: parseFloat(payout.toFixed(2)) // Ensure 2 decimal precision
  };
}