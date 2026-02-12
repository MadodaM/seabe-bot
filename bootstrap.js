const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("🚀 Bootstrapping Database...");

    // 1. Create the Church/Society
    const church = await prisma.church.upsert({
        where: { code: 'AFM01' },
        update: {},
        create: {
            code: 'SIYA01',
            name: 'SIYA01	Siya Burial Society',
            type: 'CHURCH', // Change to 'CHURCH' if testing church view and 'BURIAL_SOCIETY' if testing Burial SOCIETY view
            adminPhone: '+27832182707', // Your number
            defaultPremium: 0.0
        }
    });

    // 2. Create the Admin Record (This is what allows you to login now)
    await prisma.admin.upsert({
        where: { phone: '+27832182707' }, // 👈 UPDATE THIS TO YOUR NUMBER
        update: {},
        create: {
            phone: '+27832182707', // 👈 UPDATE THIS TO YOUR NUMBER
            name: 'Madoda SuperAdmin',
            role: 'OWNER',
            churchId: church.id
        }
    });

    console.log(`✅ Success! Organization ${church.name} created.`);
    console.log(`✅ Admin linked to ${church.code}. You can now login at /admin/${church.code}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());