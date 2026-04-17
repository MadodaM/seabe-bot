// services/lwaziCron.js
const cron = require('node-cron');
const axios = require('axios');

const startLwaziCrons = () => {
    console.log("⚙️ Lwazi Cron Engine Initialized.");

    // We ping the local server so we reuse the secure logic already built in paymentRoutes.js
    const PORT = process.env.PORT || 3000;
    const LOCAL_HOST = `http://localhost:${PORT}`;
    const CRON_KEY = process.env.SECRET_CRON_KEY;

    if (!CRON_KEY) {
        console.warn("⚠️ SECRET_CRON_KEY is missing. Lwazi crons will fail authentication.");
    }

    // ====================================================================
    // 💸 1. DAILY AUTO-BILLING SWEEP
    // Runs every day at 07:00 AM (SAST)
    // ====================================================================
    cron.schedule('0 7 * * *', async () => {
        console.log("⏰ [CRON] Triggering Daily Lwazi Auto-Billing...");
        try {
            const response = await axios.get(`${LOCAL_HOST}/cron/auto-bill`, {
                headers: { 'x-cron-key': CRON_KEY }
            });
            console.log("✅ [CRON] Auto-Bill Success:", response.data);
        } catch (error) {
            console.error("❌ [CRON] Auto-Bill Failed:", error.response?.data || error.message);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" 
    });

    // ====================================================================
    // 📊 2. WEEKLY PARENT REPORT CARDS
    // Runs every Friday at 15:00 PM (SAST)
    // ====================================================================
    cron.schedule('0 15 * * 5', async () => {
        console.log("⏰ [CRON] Triggering Weekly Lwazi Report Cards...");
        try {
            const response = await axios.get(`${LOCAL_HOST}/cron/weekly-reports`, {
                headers: { 'x-cron-key': CRON_KEY }
            });
            console.log("✅ [CRON] Weekly Reports Success:", response.data);
        } catch (error) {
            console.error("❌ [CRON] Weekly Reports Failed:", error.response?.data || error.message);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Johannesburg" 
    });
};

module.exports = { startLwaziCrons };