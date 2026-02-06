const { PrismaClient } = require('@prisma/client');
const readline = require('readline');
require('dotenv').config();

const prisma = new PrismaClient();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log(`
📰 SEABE NEWS EDITOR (Advanced) 📰
----------------------------------`);

    // 1. Get Church Code
    const churchCode = await ask('Enter Church Code (e.g., GRA): ');
    
    const church = await prisma.church.findUnique({
        where: { code: churchCode.toUpperCase() }
    });

    if (!church) {
        console.error(`❌ Error: No church found with code "${churchCode}".`);
        process.exit(1);
    }

    console.log(`✅ Selected: ${church.name}`);

    // 2. Get News Details
    const headline = await ask('\n📝 Headline (e.g. Men\'s Breakfast): ');
    const body = await ask('📝 Body Text (The details): ');

    // 3. Set Expiry (Default: 7 Days from now)
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    // 4. Create News Entry
    console.log('\n⏳ Publishing News...');
    
    // First, archive old news for this church (Optional but cleaner)
    await prisma.news.updateMany({
        where: { churchId: church.id, status: 'Active' },
        data: { status: 'Archived' }
    });
    
    // Create the new item
    const newsItem = await prisma.news.create({
        data: {
            church: { connect: { id: church.id } },
            headline: headline,
            body: body,
            status: 'Active',
            target: 'All',
            expiryDate: nextWeek
        }
    });

    console.log(`
🎉 SUCCESS! News Published.
---------------------------
Headline: ${newsItem.headline}
Expires:  ${nextWeek.toDateString()}
Status:   Active

👉 Users clicking Option 6 will now see this update!
`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        rl.close();
    });