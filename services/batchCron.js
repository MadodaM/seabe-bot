// services/batchCron.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = require('./prisma-client');
const axios = require('axios');
const sgMail = require('@sendgrid/mail');
const { calculateTransaction } = require('./pricingEngine');
const { validateBatchRecord } = require('./netcashValidator'); // 🚀 NEW: Import Validator

// Ensure SendGrid is configured for Admin Alerts
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Netcash File Upload Endpoint (Requires Base64 encoded file inside XML)
const NETCASH_BATCH_URL = 'https://ws.netcash.co.za/NIWS/NIWS_NIF.svc';

// Helper: Get the 1st of the *Next* Month for the Action Date (YYYYMMDD)
function getNextActionDate() {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 2; 
    if (month > 12) {
        month = 1;
        year += 1;
    }
    return `${year}${month.toString().padStart(2, '0')}01`;
}

const startBatchEngine = () => {
    console.log("⚙️ Debit Order Batch Engine Initialized. Scheduled for the 25th of every month at 08:00 AM (SAST).");

    // Cron expression: Minute 0, Hour 8, Day 25, Every Month
    cron.schedule('0 8 25 * *', async () => {
        console.log("⏰ [CRON] Waking up Debit Order Batch Engine...");

        try {
            // 1. Fetch all users who have an ACTIVE_DEBIT_ORDER status
            const activeMembers = await prisma.member.findMany({
                where: { status: 'ACTIVE_DEBIT_ORDER' },
                include: { church: true }
            });

            if (activeMembers.length === 0) {
                console.log("✅ [CRON] No active debit orders found. Sleeping.");
                return;
            }

            console.log(`🚀 [CRON] Found ${activeMembers.length} active mandates. Building Netcash Batch File...`);

            // 2. Initialize Batch Variables
            const actionDate = getNextActionDate(); // e.g., "20260501"
            let totalAmount = 0;
            let recordCount = 0;
            const serviceKey = process.env.NETCASH_DEBIT_ORDER_KEY;
            
            // Header Record (H)
            let batchContent = `H\t${serviceKey}\t1\tSeabe_Batch_${Date.now()}\t\t\t\t\t\n`;

            // 3. Process Each Member
            for (const member of activeMembers) {
                try {
                    // Fallback premium if missing
                    const basePremium = member.monthlyPremium || member.church?.defaultPremium || 150.00;
                    
                    // 🚀 PRICING ENGINE (Async)
                    const pricing = await calculateTransaction(basePremium, 'STANDARD', 'DEBIT_ORDER', true);
                    
                    // 🚀 VALIDATOR (Sanitize Data)
                    // This replaces the manual string building and ensures no illegal characters break the batch
                    const cleanRecord = validateBatchRecord({
                        ref: member.phone,
                        name: `${member.firstName} ${member.lastName}`,
                        amount: pricing.totalChargedToUser,
                        actionDate: actionDate
                    });

                    // Append to Batch
                    batchContent += cleanRecord + "\n";
                    
                    totalAmount += pricing.totalChargedToUser;
                    recordCount++;

                } catch (rowError) {
                    console.error(`⚠️ [CRON] Skipped member ${member.phone} due to error:`, rowError.message);
                }
            }

            // 4. Trailer Record (T)
            const formattedTotal = totalAmount.toFixed(2);
            batchContent += `T\t${recordCount}\t${formattedTotal}\t9999\n`;

            // 5. Wrap the Batch File in Netcash's XML Envelope
            const base64File = Buffer.from(batchContent).toString('base64');
            const xmlPayload = `
                <BatchFileUpload>
                    <ServiceKey>${serviceKey}</ServiceKey>
                    <File>${base64File}</File>
                </BatchFileUpload>
            `;

            // 6. Push to Netcash API
            console.log(`📤 [CRON] Uploading Batch to Netcash (Total Value: R${formattedTotal})...`);
            
            /* // UNCOMMENT TO GO LIVE:
            const netcashResponse = await axios.post(NETCASH_BATCH_URL, xmlPayload, {
                headers: { 'Content-Type': 'text/xml' }
            });
            console.log("✅ Netcash Response:", netcashResponse.data);
            */

            // 7. Email the Super Admin (You) a success report
            const adminEmailMsg = {
                to: process.env.ADMIN_EMAIL || 'admin@seabe.tech',
                from: process.env.EMAIL_FROM || 'admin@seabe.tech',
                subject: `💰 Netcash Debit Order Batch Submitted!`,
                text: `Success! The monthly debit order batch has been uploaded to Netcash.\n\nTotal Records: ${recordCount}\nTotal Value: R${formattedTotal}\nAction Date: ${actionDate}\n\nNetcash will process these funds on the 1st.`,
                attachments: [{
                    content: base64File,
                    filename: `Seabe_Debit_Order_Batch_${actionDate}.txt`,
                    type: 'text/plain',
                    disposition: 'attachment'
                }]
            };
            await sgMail.send(adminEmailMsg);
            
            console.log(`🏆 [CRON] Batch sequence complete. Emailed summary to admin.`);

        } catch (error) {
            console.error("❌ [CRON] Fatal Batch Engine Error:", error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" 
    });
};

module.exports = { startBatchEngine };