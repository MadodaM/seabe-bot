// bots/bookingBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function processBookingMessage(incomingMsg, cleanPhone, session, member, sendWhatsApp) {
    const bookingKeywords = ['book', 'venue', 'hall', 'chapel', 'facilities'];
            
    // If the message isn't about booking, tell the router to keep looking
    if (!bookingKeywords.includes(incomingMsg) && !session.step?.startsWith('BOOKING_')) {
        return { handled: false };
    }

    if (!member || !member.churchId) {
        await sendWhatsApp(cleanPhone, "⚠️ You must be linked to an organization to book a venue. Reply *Join*.");
        return { handled: true, clearSessionFlag: true };
    }

    // STEP 1: Show Available Venues
    if (bookingKeywords.includes(incomingMsg)) {
        const facilities = await prisma.facility.findMany({ where: { churchId: member.churchId, isActive: true } });
        
        if (facilities.length === 0) {
            await sendWhatsApp(cleanPhone, `⚠️ *${member.church.name}* does not currently have any venues listed for booking.`);
            return { handled: true, clearSessionFlag: true };
        }

        session.availableFacilities = facilities;
        session.step = 'BOOKING_SELECT_VENUE';
        
        let msg = `🏢 *Venue Booking: ${member.church.name}*\n\nPlease select a facility to book:\n\n`;
        facilities.forEach((f, i) => {
            msg += `${i + 1}️⃣ *${f.name}* (R${f.pricePerDay.toFixed(2)}/day)\n`;
        });
        msg += `\nReply with the number of your choice.`;
        
        await sendWhatsApp(cleanPhone, msg);
        return { handled: true, clearSessionFlag: false };
    }

    // STEP 2: Select Venue & Ask for Date
    if (session.step === 'BOOKING_SELECT_VENUE') {
        const index = parseInt(incomingMsg) - 1;
        const facility = session.availableFacilities ? session.availableFacilities[index] : null;

        if (!facility) {
            await sendWhatsApp(cleanPhone, "⚠️ Invalid selection. Please reply with a valid number.");
            return { handled: true, clearSessionFlag: false };
        }

        session.selectedFacilityId = facility.id;
        session.selectedFacilityName = facility.name;
        session.selectedFacilityPrice = facility.pricePerDay;
        session.step = 'BOOKING_ENTER_DATE';

        await sendWhatsApp(cleanPhone, `✅ You selected *${facility.name}*.\n\n📅 What date would you like to book?\n\n*Please reply in this exact format:* YYYY-MM-DD\n_Example: 2026-05-24_`);
        return { handled: true, clearSessionFlag: false };
    }

    // STEP 3: The "Calendar" Availability Check
    if (session.step === 'BOOKING_ENTER_DATE') {
        // Regex to validate YYYY-MM-DD format
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (!datePattern.test(incomingMsg)) {
            await sendWhatsApp(cleanPhone, "⚠️ Invalid date format. Please use *YYYY-MM-DD* (e.g., 2026-05-24).");
            return { handled: true, clearSessionFlag: false };
        }

        const requestedDate = new Date(incomingMsg);
        
        // Check for past dates
        if (requestedDate < new Date(new Date().setHours(0,0,0,0))) {
            await sendWhatsApp(cleanPhone, "⚠️ You cannot book a date in the past. Please reply with a future date (YYYY-MM-DD).");
            return { handled: true, clearSessionFlag: false };
        }

        // Query DB: Is there an existing booking for this facility on this exact date?
        const existingBooking = await prisma.booking.findFirst({
            where: {
                facilityId: session.selectedFacilityId,
                bookingDate: requestedDate,
                status: { in: ['CONFIRMED', 'PENDING'] }
            }
        });

        if (existingBooking) {
            await sendWhatsApp(cleanPhone, `❌ *Date Unavailable*\n\nSorry, the *${session.selectedFacilityName}* is already booked on ${incomingMsg}. Please reply with a different date (YYYY-MM-DD).`);
            return { handled: true, clearSessionFlag: false };
        }

        // Date is free! Create the PENDING booking
        const newBooking = await prisma.booking.create({
            data: {
                facilityId: session.selectedFacilityId,
                memberId: member.id,
                churchId: member.churchId,
                bookingDate: requestedDate,
                status: 'PENDING'
            }
        });

        // Generate Payment Link using existing infrastructure
        const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
        const payLink = `${host}/link/${member.church.code}`;

        await sendWhatsApp(cleanPhone, `🎉 *Venue Reserved!*\n\n*Facility:* ${session.selectedFacilityName}\n*Date:* ${incomingMsg}\n*Cost:* R${session.selectedFacilityPrice.toFixed(2)}\n\nYour booking is currently *PENDING*. To secure this date, please complete your payment via Seabe Pay:\n👉 ${payLink}\n\n_Reply Menu to return to your dashboard._`);
        
        // Optional: Alert the Admin
        const adminPhone = member.church.adminPhone;
        if (adminPhone) {
            const cleanAdmin = adminPhone.startsWith('0') ? '27' + adminPhone.substring(1) : adminPhone.replace('+', '');
            await sendWhatsApp(cleanAdmin, `🔔 *New Venue Booking!*\n\n*${member.firstName} ${member.lastName}* has requested to book the *${session.selectedFacilityName}* for ${incomingMsg}.`).catch(()=>null);
        }
        
        return { handled: true, clearSessionFlag: true }; // Clear session on success
    }

    return { handled: false };
}

module.exports = { processBookingMessage };