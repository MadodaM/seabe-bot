const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("⏳ Seeding database with Policy Data...");

    // 1. Ensure the Organizations exist
    const tfbs = await prisma.church.upsert({
        where: { code: 'TFBS' },
        update: {},
        create: { name: 'Thuso Fund Burial Society', code: 'TFBS', type: 'BURIAL_SOCIETY' }
    });

    const insika = await prisma.church.upsert({
        where: { code: 'INSIKA' },
        update: {},
        create: { name: 'Insika Funerals', code: 'INSIKA', type: 'BURIAL_SOCIETY' }
    });

    // 2. Clear old test plans to prevent duplicates
    await prisma.policyPlan.deleteMany({});
    await prisma.policyAddon.deleteMany({});

    // 3. Create TFBS Plans & Addons (Base + Dependent pricing)
    await prisma.policyPlan.createMany({
        data: [
            { churchId: tfbs.id, planName: 'Plan A', targetGroup: 'Principal Member (Single)', monthlyPremium: 140, benefitsSummary: 'Coffin, 40 Chairs, Tent, Veg 1x7, Sheep or Groceries' },
            { churchId: tfbs.id, planName: 'Plan B', targetGroup: 'Principal + Spouse', monthlyPremium: 240, benefitsSummary: 'Coffin, 40 Chairs, Tent, Veg 1x7, Sheep or Groceries' }
        ]
    });

    await prisma.policyAddon.createMany({
        data: [
            { churchId: tfbs.id, addonName: 'Additional Child (Under 21)', monthlyPremium: 20 },
            { churchId: tfbs.id, addonName: 'Additional Adult (Extended Family)', monthlyPremium: 30 }
        ]
    });

    // 4. Create Insika Plans (Flat rate + Joining Fees)
    await prisma.policyPlan.createMany({
        data: [
            { churchId: insika.id, planName: 'Silver Plan', targetGroup: 'Family (Up to 65 yrs)', monthlyPremium: 140, joiningFee: 100, benefitsSummary: 'Coffin (Open Face), Hearse, Family Car, Tent, 40 Chairs, Veg 1x7' },
            { churchId: insika.id, planName: 'Society Plan A', targetGroup: 'Up to 8 People', monthlyPremium: 55, joiningFee: 150, coverAmount: 5000, maxMembers: 8, benefitsSummary: 'R5,000 Cash Payout for Principal and Dependents' },
            { churchId: insika.id, planName: 'Society Bantu Plan', targetGroup: 'Up to 10 People', monthlyPremium: 150, joiningFee: 150, coverAmount: 15000, maxMembers: 10, benefitsSummary: 'R15,000 Cash Payout for Principal, R12,000 for Dependents' }
        ]
    });

    console.log("✅ Database successfully seeded with TFBS and Insika pricing!");
}

main()
    .catch(e => {
        console.error("❌ Seed Error:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });