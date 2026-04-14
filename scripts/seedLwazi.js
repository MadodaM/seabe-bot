const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("🚀 Seeding Lwazi CAPS Micro-Tutor to Production...");

    // 1. Create or Find the Lwazi HQ Organization
    const lwaziOrg = await prisma.church.upsert({
        where: { code: 'LWAZI_HQ' },
        update: {},
        create: {
            name: 'Lwazi CAPS Micro-Tutor',
            code: 'LWAZI_HQ',
            type: 'ACADEMY', 
            email: 'info@seabe.tech',
            adminPhone: process.env.LWAZI_PHONE_NUMBER || '+27875511057',
            accountStatus: 'ACTIVE'
        }
    });

    console.log(`✅ Lwazi Organization ready: ${lwaziOrg.id}`);

    // 2. Create or Update the R69 Subscription Plan
    // Since planName is not @unique, we look it up manually first.
    let subscriptionPlan = await prisma.policyPlan.findFirst({
        where: { 
            planName: 'Lwazi Monthly Access',
            churchId: lwaziOrg.id
        }
    });

    if (subscriptionPlan) {
        // If it exists, just update the price to make sure it's R69
        subscriptionPlan = await prisma.policyPlan.update({
            where: { id: subscriptionPlan.id },
            data: { monthlyPremium: 69.00 }
        });
        console.log(`✅ Lwazi R69 Plan updated: ${subscriptionPlan.id}`);
    } else {
        // If it doesn't exist, create it (and we removed the 'status' field to match your schema)
        subscriptionPlan = await prisma.policyPlan.create({
            data: {
                planName: 'Lwazi Monthly Access',
                monthlyPremium: 69.00,
                benefitsSummary: 'Daily CAPS-aligned quizzes, AI Tutor access, and summary notes for Grades 4-12.',
                targetGroup: 'Students',
                churchId: lwaziOrg.id
            }
        });
        console.log(`✅ Lwazi R69 Plan created: ${subscriptionPlan.id}`);
    }
}

main()
    .catch((e) => {
        console.error("❌ Seeding failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });