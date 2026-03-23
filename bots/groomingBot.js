const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Handles WhatsApp interactions for Personal Care / Service Providers
 * @param {String} incomingMsg - The text the user sent
 * @param {String} phone - The user's WhatsApp number
 * @param {Object} session - The user's current bot session from the DB
 * @param {Function} sendWhatsApp - Your helper function to send Twilio messages
 * @returns {Boolean} - Returns true if this bot handled the message
 */
async function processGroomingMessage(incomingMsg, phone, session, sendWhatsApp) {
    const cleanMsg = incomingMsg.trim();
    const data = session.data || {};

    // ==========================================
    // 1. THE TRIGGER: Check if they typed a Salon Name
    // ==========================================
    if (!session || session.mode !== 'GROOMING') {
        // Look up the salon in the database
        const salon = await prisma.church.findFirst({
            where: {
                name: { equals: cleanMsg, mode: 'insensitive' },
                type: 'PERSONAL_CARE' // Using the new enum we added to your schema!
            }
        });

        if (salon) {
            // Hijack the session
            await prisma.botSession.upsert({
                where: { phone: phone },
                update: { mode: 'GROOMING', step: 'MAIN_MENU', data: { orgId: salon.id, orgName: salon.name } },
                create: { phone: phone, mode: 'GROOMING', step: 'MAIN_MENU', data: { orgId: salon.id, orgName: salon.name } }
            });

            const menu = `✂️ *Welcome to ${salon.name}!*\n\nReply with a number:\n*1.* Book an Appointment\n*2.* View Services & Prices`;
            await sendWhatsApp(phone, menu);
            return true;
        }
        return false; // Not a salon name, let Stokvel handle it
    }

    // ==========================================
    // 2. THE FLOW: Booking & Menus
    // ==========================================

    // STEP: MAIN_MENU
    if (session.step === 'MAIN_MENU') {
        if (cleanMsg === '1') {
            // OPTION 1: Show services so they can pick what they are booking for
            const services = await prisma.product.findMany({ where: { churchId: data.orgId, isActive: true } });
            
            if (services.length === 0) {
                await sendWhatsApp(phone, `We are currently updating our price list. Please check back later!\n\nReply *0* to go back.`);
                return true;
            }

            let msg = `💇‍♂️ *What service are we booking?*\n\n`;
            services.forEach((s, i) => msg += `*${i + 1}.* ${s.name} (R${s.price.toFixed(2)})\n`);
            
            await prisma.botSession.update({
                where: { phone },
                data: { step: 'SELECT_SERVICE', data: { ...data, availableServices: services } }
            });
            await sendWhatsApp(phone, msg + `\nReply with the number.`);
            return true;
        } 
        
        if (cleanMsg === '2') {
            // OPTION 2: Just view prices
            const services = await prisma.product.findMany({ where: { churchId: data.orgId, isActive: true } });
            
            if (services.length === 0) {
                await sendWhatsApp(phone, `We are currently updating our price list. Please check back later!\n\nReply *0* to go back.`);
                return true;
            }

            let serviceList = `📋 *${data.orgName} - Prices*\n\n`;
            services.forEach((s, i) => serviceList += `• ${s.name}: R${s.price.toFixed(2)}\n`);
            await sendWhatsApp(phone, serviceList + `\nReply *1* to Book or *0* for Main Menu.`);
            return true;
        }

        // Handle Back Button
        if (cleanMsg === '0') {
             await prisma.botSession.delete({ where: { phone } });
             await sendWhatsApp(phone, `You have exited ${data.orgName}.\n\nReply *shop name* to return to the main platform menu.`);
             return true;
        }

        await sendWhatsApp(phone, `⚠️ Invalid option. Please reply with *1* or *2*.`);
        return true;
    }

    // STEP: SELECT_SERVICE
    if (session.step === 'SELECT_SERVICE') {
        const index = parseInt(cleanMsg) - 1;
        const selectedService = data.availableServices[index];

        if (selectedService) {
            await prisma.botSession.update({
                where: { phone },
                data: { 
                    step: 'BOOKING_DATE', 
                    data: { ...data, serviceId: selectedService.id, serviceName: selectedService.name, price: selectedService.price } 
                }
            });
            await sendWhatsApp(phone, `📅 Great choice! When would you like to come in for your *${selectedService.name}*?\n\n(e.g., "Tomorrow at 10am" or "Saturday 2pm")`);
        } else {
            await sendWhatsApp(phone, "⚠️ Please select a valid number from the list.");
        }
        return true;
    }

    // STEP: BOOKING_DATE -> FINAL_CONFIRMATION
    if (session.step === 'BOOKING_DATE') {
        // Find the user in the Member table
        let member = await prisma.member.findFirst({ where: { phone: phone } });
        
        // Auto-register them if they don't exist
        if (!member) {
            member = await prisma.member.create({
                data: {
                    phone: phone,
                    firstName: 'Client',
                    lastName: '',
                    status: 'ACTIVE'
                }
            });
        }

        // 🚀 CREATE THE APPOINTMENT IN THE DATABASE
        const appointment = await prisma.appointment.create({
            data: {
                churchId: data.orgId,
                memberId: member.id,
                productId: data.serviceId,
                bookingDate: new Date(), // Placeholder: saves current time
                status: 'PENDING',
                notes: `Client requested time: ${cleanMsg}`
            }
        });

        // 💰 GENERATE DEPOSIT LINK (Charging a 25% deposit)
        const depositAmount = (data.price * 0.25).toFixed(2);
        const host = process.env.HOST_URL || 'https://seabe.tech';
        const payLink = `${host}/pay?apptId=${appointment.id}&amount=${depositAmount}`;

        const confirmation = `✅ *Booking Request Received!*\n\nWe've penciled you in for your *${data.serviceName}* on *${cleanMsg}*.\n\n🔒 *Secure your slot:*\nTo prevent no-shows, we require a R${depositAmount} deposit.\n\n👉 Pay Deposit Here: ${payLink}\n\nOnce paid, your appointment is officially confirmed!`;
        
        await sendWhatsApp(phone, confirmation);
        
        // Clear session mode so they are no longer stuck in the grooming menu
        await prisma.botSession.delete({ where: { phone } });
        return true;
    }

    return true; 
}

module.exports = { processGroomingMessage };