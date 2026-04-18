// services/reminderWorker.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('./whatsapp');

function startReminderCron() {
    // 🕒 Run exactly at the top of every hour (e.g., 8:00, 9:00, 10:00)
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ [CRON] Running hourly appointment reminder check...');
        
        try {
            const now = new Date();
            // Look for appointments happening between 3 hours and 24 hours from right now
            const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
            const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            // Find valid, upcoming appointments that haven't been reminded yet
            const upcomingAppts = await prisma.appointment.findMany({
                where: {
                    status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
                    bookingDate: { 
                        gte: threeHoursFromNow, 
                        lte: twentyFourHoursFromNow 
                    },
                    OR: [
                        { notes: null },
                        { NOT: { notes: { contains: '[REMINDER_SENT]' } } }
                    ]
                },
                include: { member: true, church: true, product: true }
            });

            if (upcomingAppts.length === 0) return;

            console.log(`⏰ [CRON] Found ${upcomingAppts.length} upcoming appointments. Firing WhatsApp blasts...`);

            for (const appt of upcomingAppts) {
                if (appt.member && appt.member.phone) {
                    const prettyTime = new Date(appt.bookingDate).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
                    
                    const msg = `🔔 *Appointment Reminder*\n\nHi ${appt.member.firstName}, just a friendly reminder of your appointment for a *${appt.product.name}* at *${appt.church.name}* today at *${prettyTime}*!\n\n_Reply 'Cancel Booking' if you can no longer make it._`;

                    let cleanPhone = appt.member.phone.replace(/\D/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

                    // Fire and forget the WhatsApp message
                    await sendWhatsApp(cleanPhone, msg).catch(e => console.error("Reminder Send Error:", e.message));

                    // Tag the database so we don't spam them again next hour!
                    await prisma.appointment.update({
                        where: { id: appt.id },
                        data: { notes: (appt.notes ? appt.notes + ' ' : '') + '[REMINDER_SENT]' }
                    });
                }
            }
        } catch (error) {
            console.error('❌ [CRON] Reminder Engine Error:', error.message);
        }
    });
}

module.exports = { startReminderCron };