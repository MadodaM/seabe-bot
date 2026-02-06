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
📢 SEABE AD MANAGER 📢
----------------------`);

    // 1. Get Church
    const churchCode = await ask('Enter Church Code (e.g., GRA): ');
    const church = await prisma.church.findUnique({
        where: { code: churchCode.toUpperCase() }
    });

    if (!church) {
        console.error("❌ Church not found.");
        process.exit(1);
    }
    console.log(`✅ Selected: ${church.name}`);

    // 2. Get Ad Details
    console.log('\n📝 Enter Ad Content (Keep it short! Max 2 lines)');
    console.log('   Example: "🔧 Need Plumbing? Call Bro Mike: 082 555 1234"');
    const content = await ask('Ad Text: ');

    const daysStr = await ask('Run for how many days? (default 30): ');
    const days = parseInt(daysStr) || 30;

    // Calculate Expiry
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);

    // 3. Save to DB
    await prisma.ad.create({
        data: {
            churchId: church.id,
            content: content,
            status: 'Active',
            expiryDate: expiryDate
        }
    });

    console.log(`
💰 SUCCESS! Ad Created.
-----------------------
Content: "${content}"
Expires: ${expiryDate.toDateString()}
Rotation: Active

👉 This ad will now appear randomly in the Main Menu footer!
`);
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
        rl.close();
    });