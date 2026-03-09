// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // --- 1. NETCASH CONFIGURATION (Debit Order / Card) ---
  // Standard fees: ~2.5% + R2.50 (Estimate)
  // Seabe Markup: R5.00 flat fee
  const netcashConfig = await prisma.feeConfiguration.create({
    data: {
      provider: 'NETCASH',
      method: 'CARD',       // Applies to Card transactions
      baseFee: 2.50,        // Cost: Fixed R2.50
      percentFee: 2.5,      // Cost: 2.5%
      seabeFixed: 5.00,     // Revenue: R5.00
      seabePercent: 0.0,    // Revenue: 0%
      isActive: true,
    },
  });
  console.log('✅ Created Netcash Fee Config:', netcashConfig);

  // --- 2. OZOW CONFIGURATION (EFT) ---
  // Standard fees: ~1.5% (Often no fixed fee for EFT)
  // Seabe Markup: R5.00 flat fee
  const ozowConfig = await prisma.feeConfiguration.create({
    data: {
      provider: 'OZOW',
      method: 'EFT',        // Applies to EFT/Ozow transactions
      baseFee: 0.00,        // Cost: R0.00
      percentFee: 1.5,      // Cost: 1.5%
      seabeFixed: 5.00,     // Revenue: R5.00
      seabePercent: 0.0,    // Revenue: 0%
      isActive: true,
    },
  });
  console.log('✅ Created Ozow Fee Config:', ozowConfig);

  console.log('🌱 Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });