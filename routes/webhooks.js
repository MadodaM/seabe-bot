// routes/webhooks.js
const express = require('express');
const router = express.Router();
const prisma = require('../services/db');
const { processNetcashITN } = require('../services/webhookWorker');

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

/**
 * 🔗 NETCASH ITN WEBHOOK (Fast Receiver)
 * Logs the payload immediately and delegates processing to the worker.
 */
router.post('/api/core/webhooks/payment', async (req, res) => {
    const payload = req.body;
    const reference = payload.Reference || payload.p2 || payload.AccountReference || payload.MandateReference || 'UNKNOWN';

    try {
        // 1. Log the raw incoming request to the database IMMEDIATELY
        const webhookLog = await prisma.webhookLog.create({
            data: {
                provider: 'NETCASH',
                reference: reference,
                payload: payload,
                status: 'PENDING'
            }
        });

        // 2. Acknowledge receipt to Netcash instantly so they don't timeout
        res.status(200).send('OK');

        // 3. Fire-and-forget the background worker (No await)
        processNetcashITN(webhookLog.id).catch(err => {
            console.error("Background worker failed to start:", err);
        });

    } catch (error) {
        console.error("❌ [WEBHOOK ROUTER] FATAL ERROR saving ITN:", error);
        // Still return 200 OK to Netcash so they don't retry and overwhelm the DB
        res.status(200).send('OK'); 
    }
});

// ==========================================
// 🔄 ADMIN API: Retry Failed Webhooks
// ==========================================
router.post('/admin/retry-webhook/:logId', async (req, res) => {
    try {
        const logId = parseInt(req.params.logId);
        
        await prisma.webhookLog.update({
            where: { id: logId },
            data: { status: 'PENDING', errorReason: null }
        });

        // Trigger worker synchronously so admin sees the result
        await processNetcashITN(logId);

        const updatedLog = await prisma.webhookLog.findUnique({ where: { id: logId } });
        
        if (updatedLog.status === 'SUCCESS') {
            res.json({ success: true, message: 'Webhook replayed successfully!' });
        } else {
            res.status(400).json({ success: false, error: updatedLog.errorReason });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;