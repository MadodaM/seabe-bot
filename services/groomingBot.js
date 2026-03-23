const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Handles WhatsApp interactions for Personal Care / Service Providers
 * @param {String} incomingMsg - The text the user sent
 * @param {String} phone - The user's WhatsApp number
 * @param {Object} session - The user's current bot session from the DB
 * @param {Function} sendWhatsApp - Your helper function to send Twilio messages
 * @returns {Boolean} - Returns true if this bot handled the message, false if it should pass to the Stokvel bot
 */
async function processGroomingMessage(incomingMsg, phone, session, sendWhatsApp) {
    const cleanMsg = incomingMsg.trim();

    // ==========================================
    // 1. THE TRIGGER: Check if they typed a Salon Name
    // ==========================================
    // If the user isn't already in a grooming session, let's see if they are trying to start one
    if (!session || session.mode !== 'GROOMING') {
        // Look up any Service Provider with this exact name (case-insensitive)
        const salon = await prisma.church.findFirst({
            where: {
                name: { equals: cleanMsg, mode: 'insensitive' },
                type: 'SERVICE_PROVIDER' // Or 'PERSONAL_CARE' based on your enum
            }
        });

        if (salon) {
            // Hijack the session: Put the user into GROOMING mode
            await prisma.botSession.upsert({
                where: { phone: phone },
                update: { mode: 'GROOMING', step: 'MAIN_MENU', data: { orgId: salon.id, orgName: salon.name } },
                create: { phone: phone, mode: 'GROOMING', step: 'MAIN_MENU', data: { orgId: salon.id, orgName: salon.name } }
            });

            // Send the Welcome Menu
            const menu = `✂️ *Welcome to ${salon.name}!*\n\nReply with a number:\n*1.* Book an Appointment\n*2.* View Services & Prices`;
            await sendWhatsApp(phone, menu);
            return true; // Tell the router we handled this message!
        }
        
        return false; // Not a salon name, let the main Stokvel bot try to handle it
    }

    // ==========================================
    // 2. THE FLOW: User is already in a GROOMING session
    // ==========================================
    const data = session.data || {};

    if (session.step === 'MAIN_MENU') {
        if (cleanMsg === '1') {
            // OPTION 1: Book Appointment
            await prisma.botSession.update({
                where: { phone },
                data: { step: 'BOOKING_DATE' }
            });
            await sendWhatsApp(phone, `📅 Let's book your appointment at *${data.orgName}*.\n\nWhat date and time would you like to come in? (e.g., Tomorrow at 2pm, Friday at 10am)`);
            return true;

        } else if (cleanMsg === '2') {
            // OPTION 2: View Services & Prices
            const services = await prisma.product.findMany({
                where: { churchId: data.orgId, isActive: true }
            });

            if (services.length === 0) {
                await sendWhatsApp(phone, `We are currently updating our price list. Please check back later!\n\nReply *0* to go back.`);
                return true;
            }

            let serviceList = `📋 *${data.orgName} - Services*\n\n`;
            services.forEach((s, index) => {
                serviceList += `*${index + 1}.* ${s.name} - R${s.price.toFixed(2)} (${s.durationMins || 30} mins)\n`;
            });
            serviceList += `\nReply *0* to return to the Main Menu.`;

            await prisma.botSession.update({
                where: { phone },
                data: { step: 'VIEW_SERVICES' }
            });

            await sendWhatsApp(phone, serviceList);
            return true;

        } else {
            await sendWhatsApp(phone, `⚠️ Invalid option. Please reply with *1* or *2*.`);
            return true;
        }
    }

    // Handle the 'Back' button from the services list
    if (session.step === 'VIEW_SERVICES' && cleanMsg === '0') {
        await prisma.botSession.update({
            where: { phone },
            data: { step: 'MAIN_MENU' }
        });
        const menu = `✂️ *Welcome to ${data.orgName}!*\n\nReply with a number:\n*1.* Book an Appointment\n*2.* View Services & Prices`;
        await sendWhatsApp(phone, menu);
        return true;
    }

    // Catch-all for grooming bot
    return true; 
}

module.exports = { processGroomingMessage };