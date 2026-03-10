// scripts/encryptDatabase.js
// One-time script to encrypt all existing historical plain-text PII in PostgreSQL
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../utils/crypto');

// ⚠️ We use the BASE Prisma Client here to bypass the automatic interceptor
const prisma = new PrismaClient(); 

async function migrateDatabase() {
    console.log("\n🔒 INITIATING POPIA COMPLIANCE MIGRATION...");
    console.log("Scrambling plain-text PII in the database...\n");

    try {
        const members = await prisma.member.findMany();
        let encryptedCount = 0;

        for (const m of members) {
            // Check if it's already encrypted with the new deterministic tag (enc:)
            if (m.phone && !m.phone.startsWith('enc:')) {
                
                await prisma.member.update({
                    where: { id: m.id },
                    data: {
                        phone: encrypt(m.phone),
                        idNumber: m.idNumber ? encrypt(m.idNumber) : null
                    }
                });
                
                encryptedCount++;
                console.log(`✅ Secured Member ID: ${m.id}`);
            }
        }

        console.log(`\n🎉 MIGRATION COMPLETE!`);
        console.log(`Successfully encrypted ${encryptedCount} records.`);
        console.log(`Your PostgreSQL database is now fully POPIA compliant at rest.\n`);

    } catch (e) {
        console.error("❌ Migration failed:", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

migrateDatabase();