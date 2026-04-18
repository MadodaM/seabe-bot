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
			
			// ==========================================
            // ⭐ POST-CUT REVIEWS & TIPPING TRIGGER
            // ==========================================
            console.log('⭐ [CRON] Checking for recently completed appointments to request reviews...');
            
            // Look for appointments marked COMPLETED roughly 2 to 4 hours ago
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
            const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

            const completedAppts = await prisma.appointment.findMany({
                where: {
                    status: 'COMPLETED',
                    updatedAt: { gte: fourHoursAgo, lte: twoHoursAgo },
                    OR: [
                        { notes: null },
                        { NOT: { notes: { contains: '[REVIEW_SENT]' } } }
                    ]
                },
                include: { member: true, church: true, admin: true }
            });

            for (const appt of completedAppts) {
                if (appt.member && appt.member.phone) {
                    const barberName = appt.admin ? appt.admin.name : 'your barber';
                    const msg = `Hi ${appt.member.firstName}! Thanks for visiting *${appt.church.name}* today. ✂️\n\nHow was your cut with ${barberName}?\n\n*Reply with a number from 1 to 5* to rate your experience (5 being excellent!).`;

                    let cleanPhone = appt.member.phone.replace(/\D/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = '27' + cleanPhone.substring(1);

                    // 1. Send the Review Prompt
                    await sendWhatsApp(cleanPhone, msg).catch(e => console.error("Review Send Error:", e.message));

                    // 2. Tag the database so we never ask them twice for this appointment
                    await prisma.appointment.update({
                        where: { id: appt.id },
                        data: { notes: (appt.notes ? appt.notes + ' ' : '') + '[REVIEW_SENT]' }
                    });

                    // 3. 🪄 THE MAGIC TRICK: Force the user into the Review State Machine!
                    const reviewData = { 
                        orgId: appt.church.id, 
                        orgName: appt.church.name, 
                        barberName: barberName, 
                        googleUrl: appt.church.googleReviewUrl || 'https://g.page/r/your-link-here' 
                    };
                    
                    await prisma.botSession.upsert({
                        where: { phone: appt.member.phone },
                        update: { mode: 'GROOMING_REVIEW', step: 'AWAITING_RATING', data: JSON.stringify(reviewData) },
                        create: { phone: appt.member.phone, mode: 'GROOMING_REVIEW', step: 'AWAITING_RATING', data: JSON.stringify(reviewData) }
                    });
                }
            }

        } catch (error) {
            console.error('❌ [CRON] Reminder Engine Error:', error.message);
        }
    });
}

module.exports = { startReminderCron };