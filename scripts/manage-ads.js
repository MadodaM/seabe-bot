const { PrismaClient } = require('@prisma/client');
const readline = require('readline');
const prisma = new PrismaClient();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log(`
📢 SEABE AD MANAGER
-------------------`);

    // 1. Get Church Code
    const churchCode = await ask('Enter Church Code (e.g. GRA): ');
    const church = await prisma.church.findUnique({
        where: { code: churchCode.toUpperCase() }
    });

    if (!church) {
        console.error("❌ Church not found!");
        process.exit(1);
    }

    console.log(`✅ Selected: ${church.name}`);

    // 2. Get Ad Details
    const content = await ask('\n📝 Ad Content (The message users will see): ');
    const duration = await ask('⏳ Duration (Days from now): ');

    // 3. Set Expiry
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + parseInt(duration));

    // 4. Publish
    console.log('\n🚀 Publishing Ad...');
    
    // Archive old active ads for this church (Optional cleanup)
    await prisma.ad.updateMany({
        where: { churchId: church.id, status: 'Active' },
        data: { status: 'Archived' }
    });

    const newAd = await prisma.ad.create({
        data: {
            churchId: church.id,
            content: content,
            status: 'Active',
            expiryDate: expiry
        }
    });

    console.log(`
🎉 AD LIVE!
-----------
ID: ${newAd.id}
Content: "${newAd.content}"
Expires: ${expiry.toDateString()}
`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
        rl.close();
    });