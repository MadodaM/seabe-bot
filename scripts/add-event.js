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
🎫 SEABE EVENT WIZARD 🎫
------------------------`);

    // 1. Get Church Code
    const churchCode = await ask('Enter Church Code (e.g., GRA): ');
    
    // Validate Church exists
    const church = await prisma.church.findUnique({
        where: { code: churchCode.toUpperCase() }
    });

    if (!church) {
        console.error(`❌ Error: No church found with code "${churchCode}".`);
        process.exit(1);
    }

    console.log(`✅ Selected: ${church.name}`);

    // 2. Get Event Details
    const name = await ask('Event Name (e.g., Men\'s Breakfast): ');
    const date = await ask('Event Date (e.g., 2026-03-15): ');
    const priceInput = await ask('Ticket Price in Rands (e.g., 150): ');
    
    // Convert Rand to Cents
    const amount = parseFloat(priceInput) * 100;

    // 3. Create Event in Database
    console.log('\n⏳ Creating Event...');
    
    const newEvent = await prisma.event.create({
        data: {
            church: { connect: { id: church.id } },
            name: name,
            date: date,
            price: parseFloat(priceInput),
            status: "ACTIVE"  // ⬅️ REPLACED 'active: true' WITH THIS
        }
    });

    console.log(`
🎉 SUCCESS! Event Created.
--------------------------
Event: ${newEvent.name}
Price: R${priceInput}
Date:  ${date}
Church: ${church.name}

👉 Users can now buy tickets instantly via Option 3!
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