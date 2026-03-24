// bots/groomingBot.js
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
    const data = session?.data || {};

    // ==========================================
    // 1. THE TRIGGER: Check if they typed a Salon Name
    // ==========================================
    if (!session || session.mode !== 'GROOMING') {
        // Look up the salon in the database
        const salon = await prisma.church.findFirst({
            where: {
                name: { equals: cleanMsg, mode: 'insensitive' },
                type: 'PERSONAL_CARE' 
            }
        });

        if (salon) {
            // Hijack the session
            await prisma.botSession.upsert({
                where: { phone: phone },
                update: { mode: 'GROOMING', step: 'MAIN_MENU', data: { orgId: salon.id, orgName: salon.name } },
                create: { phone: phone, mode: 'GROOMING', step: 'MAIN_MENU', data: { orgId: salon.id, orgName: salon.name } }
            });

            const menu = `✂️ *Welcome to ${salon.name}!*\n\nReply with a number:\n*1.* Book an Appointment\n*2.* View Services & Prices\n*0.* Exit`;
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
        
        // OPTION 1: Book Appointment
        if (cleanMsg === '1') {
            const services = await prisma.product.findMany({
                where: { churchId: data.orgId, isActive: true },
                orderBy: { name: 'asc' }
            });

            if (services.length === 0) {
                await sendWhatsApp(phone, "We are currently updating our price list. Please check back later!\n\nReply *0* to go back.");
                return true;
            }

            let menu = `✂️ *Select a Service*\n\n`;
            services.forEach((s, i) => {
                menu += `*${i + 1}.* ${s.name} - R${s.price.toFixed(2)}\n`;
            });
            menu += `\nReply with the number of your choice (or *0* to cancel).`;

            // Save the services to the bot's memory BEFORE updating the session!
            data.services = services;

            // 🚨 THE FIX: Create a fresh object so Prisma detects the change!
            // We also simplify the data so Prisma doesn't choke on Decimal types.
            const simpleServices = services.map(s => ({
                id: s.id,
                name: s.name,
                price: Number(s.price)
            }));

            await prisma.botSession.update({
                where: { phone: phone },
                data: { 
                    step: 'BOOKING_SERVICE',
                    data: {
                        ...data, // Spreads old data into a NEW memory object
                        services: simpleServices
                    }
                }
            });

            await sendWhatsApp(phone, menu);
            return true;
        } 
        
        // OPTION 2: View Prices
        if (cleanMsg === '2') {
            const services = await prisma.product.findMany({ 
                where: { churchId: data.orgId, isActive: true },
                orderBy: { name: 'asc' }
            });
            
            if (services.length === 0) {
                await sendWhatsApp(phone, `We are currently updating our price list. Please check back later!\n\nReply *0* to go back.`);
                return true;
            }

            let serviceList = `📋 *${data.orgName} - Prices*\n\n`;
            services.forEach((s) => serviceList += `• ${s.name}: R${s.price.toFixed(2)}\n`);
            await sendWhatsApp(phone, serviceList + `\nReply *1* to Book or *0* to Exit.`);
            return true;
        }

        // OPTION 0: Handle Exit Button
        if (cleanMsg === '0') {
             await prisma.botSession.delete({ where: { phone } });
             await sendWhatsApp(phone, `You have exited ${data.orgName}.\n\nReply *Hi* to return to the main platform menu.`);
             return true;
        }

        await sendWhatsApp(phone, `⚠️ Invalid option. Please reply with *1* or *2* (or *0* to exit).`);
        return true;
    }

    // ==========================================
    // STEP: BOOKING_SERVICE -> Select from list
    // ==========================================
    if (session.step === 'BOOKING_SERVICE') {
        if (cleanMsg === '0') {
            await prisma.botSession.delete({ where: { phone } });
            await sendWhatsApp(phone, "Booking cancelled. Reply *Hi* to start over.");
            return true;
        }

        const index = parseInt(cleanMsg) - 1;
        
        // THE SAFETY NET: If the array doesn't exist, or they type a bad number, catch it!
        if (!data.services || isNaN(index) || !data.services[index]) {
            await sendWhatsApp(phone, "⚠️ Please reply with a valid number from the menu.");
            return true;
        }

        const selectedService = data.services[index];

        // Save the chosen service to memory
        // Save the chosen service to memory safely
        await prisma.botSession.update({
            where: { phone: phone },
            data: { 
                step: 'BOOKING_DATE',
                data: {
                    ...data, // Force Prisma to save the update
                    serviceId: selectedService.id,
                    serviceName: selectedService.name,
                    price: selectedService.price
                }
            }
        });

        await sendWhatsApp(phone, `Great! You selected *${selectedService.name}* (R${selectedService.price.toFixed(2)}).\n\n📅 What date and time would you like to come in?\n_(e.g., "Tomorrow at 2pm" or "Friday 10am")_`);
        return true;
    }

    // ==========================================
    // STEP: BOOKING_DATE -> FINAL_CONFIRMATION
    // ==========================================
    if (session.step === 'BOOKING_DATE') {
        
        if (cleanMsg === '0') {
            await prisma.botSession.delete({ where: { phone } });
            await sendWhatsApp(phone, "Booking cancelled. Reply *Hi* to start over.");
            return true;
        }

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

        // 🚀 CREATE THE APPOINTMENT (Instantly Confirmed, No Deposit)
        await prisma.appointment.create({
            data: {
                churchId: data.orgId,
                memberId: member.id,
                productId: data.serviceId,
                bookingDate: new Date(), // Placeholder until Chrono-node is added
                status: 'CONFIRMED', 
                depositPaid: false,
                notes: `Client requested time: ${cleanMsg}`
            }
        });

        // 🎉 INSTANT CONFIRMATION MESSAGE
        const confirmation = `✅ *Booking Confirmed!*\n\nWe've locked in your *${data.serviceName}* on *${cleanMsg}*.\n\n📍 *${data.orgName}*\n💰 Payment of *R${data.price.toFixed(2)}* can be made in-store after your appointment.\n\nSee you soon! ✂️`;
        
        await sendWhatsApp(phone, confirmation);
        
        // Clear session mode so they are no longer stuck in the grooming menu
        await prisma.botSession.delete({ where: { phone } });
        return true;
    }

    return true; 
}

module.exports = { processGroomingMessage };