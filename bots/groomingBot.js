// bots/groomingBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function processGroomingMessage(incomingMsg, phone, session, sendWhatsApp) {
    const cleanMsg = incomingMsg.trim();
    
    // 🚨 DECODE STRING-BASED STATE MACHINE
    // Format: "STEP|orgId|serviceId|price"
    const [rawStep, orgIdStr, serviceIdStr, priceStr] = (session?.step || '').split('|');
    const step = rawStep || '';
    const orgId = parseInt(orgIdStr);

    let data = typeof session?.data === 'string' ? JSON.parse(session.data) : (session?.data || {});
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) {} }

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
        if (session) { session.mode = null; session.step = null; session.data = null; }
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
            // Encode the orgId directly into the step string!
            const newStep = `MAIN_MENU|${salon.id}`;
            const newData = { orgName: salon.name };
            
            await prisma.botSession.upsert({
                where: { phone: phone },
                update: { mode: 'GROOMING', step: newStep, data: newData },
                create: { phone: phone, mode: 'GROOMING', step: newStep, data: newData }
            });

            if (session) {
                session.mode = 'GROOMING';
                session.step = newStep;
                session.data = newData;
            }

            const menu = `✂️ *Welcome to ${salon.name}!*\n\nReply with a number:\n*1.* Book an Appointment\n*2.* View Services & Prices\n*0.* Exit`;
            await sendWhatsApp(phone, menu);
            return true;
        }
        return false; 
    }

    // 🚨 FAILSAFE: If orgId is completely missing, gracefully reset.
    if (isNaN(orgId)) {
        await prisma.botSession.deleteMany({ where: { phone: phone } });
        if (session) { session.mode = null; session.step = null; session.data = null; }
        await sendWhatsApp(phone, "⚠️ Session expired. Please reply with the salon name (e.g. 'Wandile Hair Game') to restart.");
        return true;
    }

    // ==========================================
    // 2. THE FLOW: Booking & Menus
    // ==========================================
    if (step === 'MAIN_MENU') {
        
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
                services.forEach((s, i) => menu += `*${i + 1}.* ${s.name} - R${Number(s.price).toFixed(2)}\n`);
                menu += `\nReply with the number of your choice (or *0* to cancel).`;

                const newStep = `BOOKING_SERVICE|${orgId}`;
                await prisma.botSession.update({
                    where: { phone: phone },
                    data: { step: newStep }
                });
                
                if (session) { session.step = newStep; }
                await sendWhatsApp(phone, menu);
            } else {
                let serviceList = `📋 *${data.orgName || 'Salon'} - Prices*\n\n`;
                services.forEach(s => serviceList += `• ${s.name}: R${Number(s.price).toFixed(2)}\n`);
                await sendWhatsApp(phone, serviceList + `\nReply *1* to Book or *0* to Exit.`);
            }
            return true;
        } 
        
        if (cleanMsg === '0') {
             await prisma.botSession.deleteMany({ where: { phone } });
             if (session) { session.mode = null; session.step = null; session.data = null; }
             await sendWhatsApp(phone, `You have exited.\n\nReply *Hi* to return to the main platform menu.`);
             return true;
        }

        await sendWhatsApp(phone, `⚠️ Invalid option. Please reply with *1* or *2* (or *0* to exit).`);
        return true;
    }

    // ==========================================
    // STEP: BOOKING_SERVICE -> Select from list
    // ==========================================
    if (step === 'BOOKING_SERVICE') {
        if (cleanMsg === '0') {
            await prisma.botSession.deleteMany({ where: { phone } });
            if (session) { session.mode = null; session.step = null; }
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

        // 🚨 Encode EVERYTHING into the step string to bypass JSON entirely
        const newStep = `BOOKING_DATE|${orgId}|${selectedService.id}|${selectedService.price}`;
        const newData = { orgName: data.orgName, serviceName: selectedService.name };

        await prisma.botSession.update({
            where: { phone: phone },
            data: { step: newStep, data: newData }
        });

        if (session) { session.step = newStep; session.data = newData; }

        await sendWhatsApp(phone, `Great! You selected *${selectedService.name}* (R${Number(selectedService.price).toFixed(2)}).\n\n📅 What date and time would you like to come in?\n_(e.g., "Tomorrow at 2pm" or "Friday 10am")_`);
        return true;
    }

    // ==========================================
    // STEP: BOOKING_DATE -> FINAL_CONFIRMATION
    // ==========================================
    if (step === 'BOOKING_DATE') {
        if (cleanMsg === '0') {
            await prisma.botSession.deleteMany({ where: { phone } });
            if (session) { session.mode = null; session.step = null; }
            await sendWhatsApp(phone, "Booking cancelled. Reply *Hi* to start over.");
            return true;
        }

        const serviceId = parseInt(serviceIdStr);
        const price = parseFloat(priceStr);

        if (isNaN(serviceId)) {
            await prisma.botSession.deleteMany({ where: { phone } });
            if (session) { session.mode = null; session.step = null; }
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
                memberId: Number(member.id),
                productId: serviceId,
                bookingDate: new Date(),
                status: 'CONFIRMED', 
                depositPaid: false,
                notes: `Client requested time: ${cleanMsg}`
            }
        });

        const confirmation = `✅ *Booking Confirmed!*\n\nWe've locked in your *${data.serviceName || 'Service'}* on *${cleanMsg}*.\n\n📍 *${data.orgName || 'Salon'}*\n💰 Payment of *R${price.toFixed(2)}* can be made in-store after your appointment.\n\nSee you soon! ✂️`;
        
        await sendWhatsApp(phone, confirmation);
        
        // Clean up session
        await prisma.botSession.deleteMany({ where: { phone } });
        if (session) { session.mode = null; session.step = null; session.data = null; }
        return true;
    }

    return true; 
}

module.exports = { processGroomingMessage };