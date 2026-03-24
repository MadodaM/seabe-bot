const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Starting Salon Services Seed...");

    // 1. Define the target organization code
    // IMPORTANT: Change 'TES624' to whatever code Wandile Hair Game actually got assigned!
    const targetCode = 'TES624'; 

    const salon = await prisma.church.findUnique({
        where: { code: targetCode }
    });

    if (!salon) {
        console.error(`❌ Organization with code ${targetCode} not found! Check your admin dashboard for the correct code.`);
        process.exit(1);
    }

    console.log(`✅ Found Salon: ${salon.name}. Injecting services...`);

    // 2. The Standard Barbershop & Salon Menu
    const standardServices = [
        { name: 'Standard Haircut (Fade/Taper)', price: 100.00 },
        { name: 'Haircut & Beard Trim', price: 150.00 },
        { name: 'Kids Haircut (Under 12)', price: 70.00 },
        { name: 'Clean Shave / Chiskop', price: 60.00 },
        { name: 'Hair Color / Dye', price: 80.00 },
        { name: 'Dreadlocks Retwist', price: 200.00 },
        { name: 'Braids (Straight Back)', price: 250.00 },
        { name: 'Wash & Blowdry', price: 80.00 },
        { name: 'Premium Facial Scrub', price: 120.00 },
        { name: 'VIP Package (Cut, Beard, Wash, Facial)', price: 350.00 },
        { name: 'Beard Oil / Hair Food (Product)', price: 60.00 } // For upselling on the POS
    ];

    // 3. Inject them safely into the database
    let addedCount = 0;
    
    for (const item of standardServices) {
        // Check if it already exists so we don't create duplicates
        const exists = await prisma.product.findFirst({
            where: { name: item.name, churchId: salon.id }
        });

        if (!exists) {
            await prisma.product.create({
                data: {
                    name: item.name,
                    price: item.price,
                    churchId: salon.id,
                    isActive: true
                }
            });
            addedCount++;
            console.log(`   ➕ Added: ${item.name} (R${item.price})`);
        } else {
            console.log(`   ⏭️ Skipped: ${item.name} (Already exists)`);
        }
    }

    console.log(`\n🎉 Seeding Complete! Added ${addedCount} new services to ${salon.name}.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });