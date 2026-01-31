// migrate.js
// Purpose: Robust Migration from Sheets to Neon DB
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const prisma = new PrismaClient();

async function getDoc() {
    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet('1OKVh9Q-Gcs8EjKWIedXa6KM0N-j77JfK_QHaTd0GKQE', serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

async function migrate() {
    console.log("🚀 Starting Migration...");
    const doc = await getDoc();

    // --- 1. MIGRATE CHURCHES ---
    const churchSheet = doc.sheetsByTitle['Churches'];
    if (churchSheet) {
        const rows = await churchSheet.getRows();
        console.log(`\nProcessing ${rows.length} Churches...`);
        
        for (const row of rows) {
            const code = row.get('Church Code');
            if (code) {
                // Using upsert so we don't get errors if we run this twice
                await prisma.church.upsert({
                    where: { code: code },
                    update: {}, 
                    create: {
                        name: row.get('Name'),
                        code: code,
                        email: row.get('Email') || 'unknown@seabe.io',
                        subaccountCode: row.get('Subaccount Code') || 'PENDING',
                        tosAcceptedAt: new Date()
                    }
                });
                console.log(`✅ Synced Church: ${row.get('Name')}`);
            }
        }
    }

    // --- 2. MIGRATE EVENTS ---
    const eventSheet = doc.sheetsByTitle['Events'];
    if (eventSheet) {
        const rows = await eventSheet.getRows();
        console.log(`\nProcessing ${rows.length} Events...`);

        // First, clear old events to avoid duplicates during testing
        await prisma.event.deleteMany({}); 

        for (const row of rows) {
            const churchCode = row.get('Church Code');
            const eventName = row.get('Event Name');

            // 🛡️ SAFETY CHECK: Only migrate if it has a Church Code
            if (!churchCode) {
                console.warn(`⚠️ SKIPPED Event: "${eventName}" (Reason: Missing Church Code in Sheet)`);
                continue; 
            }

            // Verify the church actually exists in our DB before linking
            const churchExists = await prisma.church.findUnique({ where: { code: churchCode } });
            if (!churchExists) {
                console.warn(`⚠️ SKIPPED Event: "${eventName}" (Reason: Church Code '${churchCode}' not found in DB)`);
                continue;
            }

            const price = parseFloat(row.get('Price')) || 0;
            
            await prisma.event.create({
                data: {
                    name: eventName,
                    date: row.get('Date') || 'TBA',
                    price: price,
                    status: row.get('Status') || 'Active',
                    church: {
                        connect: { code: churchCode } // Connect to the existing church
                    }
                }
            });
            console.log(`✅ Synced Event: ${eventName}`);
        }
    }

    console.log("\n=================================");
    console.log("🎉 MIGRATION COMPLETE!");
    console.log("Your Google Sheet data is safe inside PostgreSQL.");
    console.log("=================================");
}

migrate()
  .catch(e => {
      console.error("❌ Migration Failed:", e);
      process.exit(1);
  })
  .finally(async () => {
      await prisma.$disconnect();
  });