// seed-prices.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const services = [
        { code: 'KYC_CHECK', amount: 5.00, description: 'Identity Verification Lookup' },
        { code: 'CLAIM_AI', amount: 10.00, description: 'Forensic Death Certificate Analysis' },
        { code: 'SMS_ALERT', amount: 0.50, description: 'Outbound SMS Notification' },
        { code: 'DEBIT_FEE', amount: 3.50, description: 'Netcash Debit Order Fee' },
    ];

    console.log("🌱 Seeding Pricing Table...");

    for (const service of services) {
        await prisma.servicePrice.upsert({
            where: { code: service.code },
            update: { amount: service.amount }, // If exists, update price
            create: service, // If new, create it
        });
    }

    console.log("✅ Pricing Catalog Updated!");
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());