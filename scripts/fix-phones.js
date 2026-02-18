const { PrismaClient } = require('@prisma/client');
const { formatPhoneNumber } = require('../utils/formatPhone'); 

const prisma = new PrismaClient();

async function fixAndMergePhones() {
    console.log("🔄 Starting Smart Merge & Fix...");

    const members = await prisma.member.findMany(); // Removed include: transactions for speed

    let fixed = 0;
    let merged = 0;
    let skipped = 0;

    for (const member of members) {
        const oldPhone = member.phone;
        const cleanPhone = formatPhoneNumber(oldPhone);

        // If format is invalid or didn't change, skip
        if (!cleanPhone || cleanPhone === oldPhone) {
            continue;
        }

        // Check if the "Clean" number ALREADY exists (The Duplicate)
        const existingMember = await prisma.member.findUnique({
            where: { phone: cleanPhone }
        });

        if (existingMember) {
            // 🚨 DUPLICATE DETECTED! MERGE STRATEGY
            console.log(`⚠️ Duplicate found for ${cleanPhone}. Merging...`);

            try {
                // 1. Move transactions from Old Phone to New Phone
                // We assume Transaction table has a 'phone' field based on your previous code
                const moveTx = await prisma.transaction.updateMany({
                    where: { phone: oldPhone },
                    data: { phone: cleanPhone }
                });

                // 2. Delete the Old (Duplicate) Member
                await prisma.member.delete({
                    where: { id: member.id }
                });

                console.log(`   ↳ ✅ Merged ${oldPhone} into ${cleanPhone}. Moved ${moveTx.count} txns.`);
                merged++;
            } catch (err) {
                console.error(`   ❌ Merge failed:`, err.message);
                skipped++;
            }

        } else {
            // ✅ NO DUPLICATE: Update Member AND their Transactions
            try {
                // 1. Update Member Phone
                await prisma.member.update({
                    where: { id: member.id },
                    data: { phone: cleanPhone }
                });

                // 2. Update Transaction Phones (to keep them linked)
                await prisma.transaction.updateMany({
                    where: { phone: oldPhone },
                    data: { phone: cleanPhone }
                });

                console.log(`✅ Fixed: ${oldPhone} -> ${cleanPhone}`);
                fixed++;
            } catch (err) {
                console.error(`❌ Update failed for ${oldPhone}:`, err.message);
                skipped++;
            }
        }
    }

    console.log(`\n🎉 Cleanup Complete!`);
    console.log(`Fixed:  ${fixed}`);
    console.log(`Merged: ${merged}`);
    console.log(`Errors: ${skipped}`);
    
    await prisma.$disconnect();
}

fixAndMergePhones();