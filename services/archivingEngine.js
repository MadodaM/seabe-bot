const cron = require('node-cron');
const prisma = require('./prisma-client'); // Your shielded client

/**
 * 🗄️ SARB Data Retention Archiver
 * Runs at 2:00 AM on the 1st of every month.
 * Scans for transactions older than 5 years and marks them for cold storage.
 */
cron.schedule('0 2 1 * *', async () => {
    console.log('🗄️ [Archiving Engine] Initiating 5-Year SARB retention scan...');

    try {
        // Calculate the exact date 5 years ago
        const fiveYearsAgo = new Date();
        fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

        // Update all transactions older than 5 years
        const result = await prisma.transaction.updateMany({
            where: {
                createdAt: {
                    lt: fiveYearsAgo // "Less than" 5 years ago
                },
                archived: false
            },
            data: {
                archived: true,
                retentionExpiry: new Date() // Marks the exact day it officially expired
            }
        });

        console.log(`✅ [Archiving Engine] Successfully archived ${result.count} historical records.`);

    } catch (error) {
        console.error('❌ [Archiving Engine] Failed to process retention scan:', error);
    }
});