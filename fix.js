const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log("🛠️ Injecting Admin record...");
    
    // 1. Ensure the Organization exists
    const org = await prisma.church.upsert({
        where: { code: 'BS-001' },
        update: { type: 'BURIAL_SOCIETY' }, // Setting to Society for Burial Society testing
        create: {
            code: 'BS-001',
            name: 'Test Burial Society A',
            type: 'BURIAL_SOCIETY',
            adminPhone: '27832182707'
        }
    });

    // 2. Grant your phone number 'OWNER' access in the Admin table
    await prisma.admin.upsert({
        where: { phone: '27832182707' },
        update: { churchId: org.id, role: 'OWNER' },
        create: {
            phone: '+27832182707',
            name: 'Madoda Mavuso',
            role: 'OWNER',
            churchId: org.id
        }
    });

    console.log("✅ DONE! You are now an authorized admin for BS-001.");
}

run().catch(console.error).finally(() => prisma.$disconnect());