// bots/groomingBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function processGroomingMessage(incomingMsg, phone, session, sendWhatsApp) {
    const cleanMsg = incomingMsg.trim();
    
    // 🚨 BULLETPROOF MEMORY PARSING: Force it into a clean object
    let data = {};
    if (session && session.data) {
        try {
            // If Prisma handed us a string, parse it. If it handed us an object, stringify and parse to clone it cleanly.
            data = typeof session.data === 'string' ? JSON.parse(session.data) : JSON.parse(JSON.stringify(session.data));
        } catch(e) {
            console.error("Memory Parse Error:", e);
            data = {};
        }
    }

    // ==========================================
    // 🛠️ MAGIC KEYWORD: SHOW ALL SALONS
    // ==========================================
    if (cleanMsg.toLowerCase() === 'salons' || cleanMsg.toLowerCase() === 'salon') {
        const salons = await prisma.church.findMany({ where: { type: 'PERSONAL_CARE' } });
        if (salons.length === 0) {
            await sendWhatsApp(phone, "No salons or barbershops are currently registered on the platform.");
            return true;
        }
        let txt = "💈 *Available Salons & Barbershops*\n\n";
        salons.forEach(s => txt += `✂️ *${s.name}*\n`);
        txt += "\n_Reply with the exact name of a salon above to view their menu and book!_";
        
        await sendWhatsApp(phone, txt);
        await prisma.botSession.deleteMany({ where: { phone: phone } });
        return true;
    }

    // ==========================================
    // 1. THE TRIGGER: Check if they typed a Salon Name
    // ==========================================
    if (!session || session.mode !== 'GROOMING') {
        const salon = await prisma.church.findFirst({
            where: { name: { equals: cleanMsg, mode: 'insensitive' }, type: 'PERSONAL_CARE' }
        });

        if (salon) {
            const initialData = { orgId: salon.id, orgName: salon.name };
            
            // 🚨 STRICT SERIALIZATION: Force JSON.stringify to bypass Prisma's merging bugs
            await prisma.botSession.upsert({
                where: { phone: phone },
                update: { mode: 'GROOMING', step: 'MAIN_MENU', data: JSON.stringify(initialData) },
                create: { phone: phone, mode: 'GROOMING', step: 'MAIN_MENU', data: JSON.stringify(initialData) }
            });

            const menu = `✂️ *Welcome to ${salon.name}!*\n\nReply with a number:\n*1.* Book an Appointment\n*2.* View Services & Prices\n*0.* Exit`;
            await sendWhatsApp(phone, menu);
            return true;
        }
        return false; 
    }

    // 🚨 SAFETY NET: If memory is corrupted, gracefully reset.
    const orgId = parseInt(data.orgId);
    if (isNaN(orgId)) {
        await prisma.botSession.deleteMany({ where: { phone: phone } });
        await sendWhatsApp(phone, "⚠️ Session memory error. Please reply with the salon name (e.g. 'Wandile Hair Game') to restart.");
        return true;
    }

    // ==========================================
    // 2. THE FLOW: Booking & Menus
    // ==========================================
    if (session.step === 'MAIN_MENU') {
        
        if (cleanMsg === '1' || cleanMsg === '2') {
            const services = await prisma.product.findMany({
                where: { churchId: orgId, isActive: true },
                orderBy: { name: 'asc' }
            });

            if (services.length === 0) {
                await sendWhatsApp(phone, "We are currently updating our price list. Please check back later!\n\nReply *0* to go back.");
                return true;
            }

            if (cleanMsg === '1') {
                let menu = `✂️ *Select a Service*\n\n`;
                services.forEach((s, i) => menu += `*${i + 1}.* ${s.name} - R${s.price.toFixed(2)}\n`);
                menu += `\nReply with the number of your choice (or *0* to cancel).`;

                // 🚨 STRICT SERIALIZATION
                await prisma.botSession.update({
                    where: { phone: phone },
                    data: { step: 'BOOKING_SERVICE', data: JSON.stringify(data) }
                });
                await sendWhatsApp(phone, menu);
            } else {
                let serviceList = `📋 *${data.orgName} - Prices*\n\n`;
                services.forEach(s => serviceList += `• ${s.name}: R${s.price.toFixed(2)}\n`);
                await sendWhatsApp(phone, serviceList + `\nReply *1* to Book or *0* to Exit.`);
            }
            return true;
        } 
        
        if (cleanMsg === '0') {
             await prisma.botSession.deleteMany({ where: { phone } });
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
            await prisma.botSession.deleteMany({ where: { phone } });
            await sendWhatsApp(phone, "Booking cancelled. Reply *Hi* to start over.");
            return true;
        }

        const index = parseInt(cleanMsg) - 1;
        const services = await prisma.product.findMany({
            where: { churchId: orgId, isActive: true },
            orderBy: { name: 'asc' }
        });

        if (isNaN(index) || index < 0 || index >= services.length) {
            await sendWhatsApp(phone, "⚠️ Please reply with a valid number from the menu.");
            return true;
        }

        const selectedService = services[index];

        const nextData = {
            orgId: orgId,
            orgName: data.orgName,
            serviceId: selectedService.id,
            serviceName: selectedService.name,
            price: Number(selectedService.price)
        };

        // 🚨 STRICT SERIALIZATION
        await prisma.botSession.update({
            where: { phone: phone },
            data: { step: 'BOOKING_DATE', data: JSON.stringify(nextData) }
        });

        await sendWhatsApp(phone, `Great! You selected *${selectedService.name}* (R${selectedService.price.toFixed(2)}).\n\n📅 What date and time would you like to come in?\n_(e.g., "Tomorrow at 2pm" or "Friday 10am")_`);
        return true;
    }

    // ==========================================
    // STEP: BOOKING_DATE -> FINAL_CONFIRMATION
    // ==========================================
    if (session.step === 'BOOKING_DATE') {
        if (cleanMsg === '0') {
            await prisma.botSession.deleteMany({ where: { phone } });
            await sendWhatsApp(phone, "Booking cancelled. Reply *Hi* to start over.");
            return true;
        }

        const serviceId = parseInt(data.serviceId);
        if (isNaN(serviceId)) {
            await prisma.botSession.deleteMany({ where: { phone } });
            await sendWhatsApp(phone, "⚠️ Booking session expired. Please reply with the salon name to start over.");
            return true;
        }

        let member = await prisma.member.findFirst({ where: { phone: phone } });
        if (!member) {
            member = await prisma.member.create({
                data: { phone: phone, firstName: 'Client', lastName: '', status: 'ACTIVE' }
            });
        }

        await prisma.appointment.create({
            data: {
                churchId: orgId,
                memberId: parseInt(member.id),
                productId: serviceId,
                bookingDate: new Date(),
                status: 'CONFIRMED', 
                depositPaid: false,
                notes: `Client requested time: ${cleanMsg}`
            }
        });

        const confirmation = `✅ *Booking Confirmed!*\n\nWe've locked in your *${data.serviceName}* on *${cleanMsg}*.\n\n📍 *${data.orgName}*\n💰 Payment of *R${data.price.toFixed(2)}* can be made in-store after your appointment.\n\nSee you soon! ✂️`;
        
        await sendWhatsApp(phone, confirmation);
        await prisma.botSession.deleteMany({ where: { phone } });
        return true;
    }

    return true; 
}

module.exports = { processGroomingMessage };