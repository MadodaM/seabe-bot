// bots/groomingBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { chargeSavedToken } = require('../services/netcash');
const chrono = require('chrono-node'); // 🧠 NEW: Natural Language Date Parser

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
    // 🛑 GLOBAL INTERCEPTOR: HANDLE CANCELLATIONS
    // ==========================================
    if (cleanMsg.toLowerCase() === 'cancel booking') {
        const upcomingAppt = await prisma.appointment.findFirst({
            where: {
                member: { phone: phone },
                bookingDate: { gte: new Date() },
                status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] }
            },
            include: { church: true, member: true },
            orderBy: { bookingDate: 'asc' }
        });

        if (upcomingAppt) {
            // Cancel it in the DB
            await prisma.appointment.update({ 
                where: { id: upcomingAppt.id }, 
                data: { status: 'CANCELLED' }
            });
            
            await sendWhatsApp(phone, `✅ Your appointment at *${upcomingAppt.church.name}* has been successfully cancelled. Thanks for letting us know!\n\nReply *Hi* to return to the main menu.`);
            
            // Notify the Barber
            if (upcomingAppt.church.adminPhone) {
                let cleanAdminPhone = upcomingAppt.church.adminPhone.replace(/\D/g, '');
                if (cleanAdminPhone.startsWith('0')) cleanAdminPhone = '27' + cleanAdminPhone.substring(1);
                
                const prettyTime = new Date(upcomingAppt.bookingDate).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
                await sendWhatsApp(cleanAdminPhone, `⚠️ *Cancellation Notice*\n\n${upcomingAppt.member.firstName} just cancelled their appointment for today at ${prettyTime}. The slot is now open in your CRM.`);
            }
        } else {
            await sendWhatsApp(phone, "You don't have any upcoming bookings to cancel.\n\nReply *Hi* to return to the main menu.");
        }
        
        // Wipe session
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

    // 🚨 FAILSAFE
    if (isNaN(orgId)) {
        await prisma.botSession.deleteMany({ where: { phone: phone } });
        if (session) { session.mode = null; session.step = null; session.data = null; }
        await sendWhatsApp(phone, "⚠️ Session expired. Please reply with the salon name (e.g. 'Wandile Hair Game') to restart.");
        return true;
    }

    // ==========================================
    // 2. MAIN MENU
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
                await prisma.botSession.update({ where: { phone: phone }, data: { step: newStep } });
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
    // 3. BOOKING_SERVICE -> Select from list
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
    // 4. BOOKING_DATE -> COLLISION ENGINE -> CONFIRMATION
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

        // 🧠 1. AI Date Parsing (forwardDate ensures "Friday" means *next* Friday)
        const requestedDate = chrono.parseDate(cleanMsg, new Date(), { forwardDate: true });
        
        if (!requestedDate) {
            await sendWhatsApp(phone, "⚠️ I couldn't quite understand that time. Please try again (e.g., 'Tomorrow at 2pm' or 'Friday 10am').");
            return true;
        }

        // 🕒 2. Business Hours Guardrail (8:00 AM to 5:00 PM)
        const hour = requestedDate.getHours();
        if (hour < 8 || hour >= 17) {
            await sendWhatsApp(phone, "🏢 Our operating hours are 8:00 AM to 5:00 PM. Please reply with a time within our business hours.");
            return true;
        }

        // 🛡️ 3. Collision Engine Logic
        const selectedService = await prisma.product.findUnique({ where: { id: serviceId } });
        const durationMins = selectedService?.durationMins || 30; // Fallback to 30 mins

        const proposedStart = requestedDate;
        const proposedEnd = new Date(proposedStart.getTime() + durationMins * 60000);

        // Fetch all of the Salon's existing bookings for THAT SPECIFIC DAY
        const startOfDay = new Date(proposedStart); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(proposedStart); endOfDay.setHours(23,59,59,999);

        const dailyAppts = await prisma.appointment.findMany({
            where: {
                churchId: orgId,
                bookingDate: { gte: startOfDay, lte: endOfDay },
                status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'COMPLETED'] }
            },
            include: { product: true },
            orderBy: { bookingDate: 'asc' }
        });

        let isConflict = false;
        let nextAvailableTime = null;

        for (const appt of dailyAppts) {
            const apptStart = new Date(appt.bookingDate);
            const apptDuration = appt.product?.durationMins || 30;
            const apptEnd = new Date(apptStart.getTime() + apptDuration * 60000);

            // Mathematical Overlap Formula: (StartA < EndB) AND (EndA > StartB)
            if (proposedStart < apptEnd && proposedEnd > apptStart) {
                isConflict = true;
                nextAvailableTime = apptEnd; // Suggest the moment this conflicting haircut finishes
            }
        }

        // 🛑 4. Handle Collision Rejection
        if (isConflict && nextAvailableTime) {
            if (nextAvailableTime.getHours() >= 17) {
                await sendWhatsApp(phone, `Sorry, we are fully booked around that time, and the next available slot falls outside our business hours.\n\nHow about another day?\n_(Reply with a new time, or 0 to cancel)_`);
            } else {
                const prettyNext = nextAvailableTime.toLocaleTimeString('en-ZA', { hour: '2-digit', minute:'2-digit' });
                await sendWhatsApp(phone, `Sorry, that time is already taken! ✂️\n\nHow about *${prettyNext}* on the same day instead?\n_(Reply with a new time, or 0 to cancel)_`);
            }
            return true;
        }

        // ✅ 5. Safe to Proceed! Create the Client and Booking
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
                bookingDate: requestedDate, // Uses the exact validated parsed date
                status: 'CONFIRMED', 
                depositPaid: false,
                notes: `Client requested: ${cleanMsg}`
            }
        });

        // 🔍 SEABE ID: Check for saved cards!
        const savedCards = await prisma.paymentMethod.findFirst({
            where: { memberId: member.id },
            orderBy: { createdAt: 'desc' }
        });
    
        if (savedCards) {
            const newStep = `GROOMING_1CLICK_PAY|${orgId}|${serviceId}|${price}`;
            await prisma.botSession.update({ where: { phone: phone }, data: { step: newStep } });
            if (session) { session.step = newStep; }

            const prettyDate = requestedDate.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
            const prettyTime = requestedDate.toLocaleTimeString('en-ZA', { hour: '2-digit', minute:'2-digit' });

            await sendWhatsApp(phone, `✅ *Booking Held!*\n\nWe've reserved your *${data.serviceName}* on *${prettyDate} at ${prettyTime}*.\n\nWould you like to prepay the *R${price.toFixed(2)}* using your saved *${savedCards.cardBrand} ending in ${savedCards.last4}* so you can just walk in and out?\n\n*1️⃣ Yes, Prepay now*\n*2️⃣ No, I'll pay in-store*`);
        } else {
            const prettyDate = requestedDate.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
            const prettyTime = requestedDate.toLocaleTimeString('en-ZA', { hour: '2-digit', minute:'2-digit' });

            const confirmation = `✅ *Booking Confirmed!*\n\nWe've locked in your *${data.serviceName || 'Service'}* on *${prettyDate} at ${prettyTime}*.\n\n📍 *${data.orgName || 'Salon'}*\n💰 Payment of *R${price.toFixed(2)}* can be made in-store after your appointment.\n\nSee you soon! ✂️`;
            await sendWhatsApp(phone, confirmation);
            
            // Clean up session
            await prisma.botSession.deleteMany({ where: { phone } });
            if (session) { session.mode = null; session.step = null; session.data = null; }
        }
        
        return true;
    }

    // ==========================================
    // 5. SEABE ID: 1-CLICK CHECKOUT EXECUTION
    // ==========================================
    if (step === 'GROOMING_1CLICK_PAY') {
        const price = parseFloat(priceStr);

        if (cleanMsg === '1') {
            await sendWhatsApp(phone, "🔄 *Processing Payment...*");

            let member = await prisma.member.findFirst({ where: { phone: phone } });
            const savedCard = await prisma.paymentMethod.findFirst({
                where: { memberId: member.id },
                orderBy: { createdAt: 'desc' }
            });

            if (savedCard) {
                const ref = `${orgId}-GROOMING-${phone.slice(-4)}-${Date.now().toString().slice(-4)}`;
                const chargeResult = await chargeSavedToken(savedCard.token, price, ref);

                if (chargeResult.success) {
                    await prisma.transaction.create({
                        data: {
                            amount: price, type: 'PREPAID_APPOINTMENT', status: 'SUCCESS', reference: ref, method: 'SEABE_ID_TOKEN',
                            description: 'Prepaid Salon Appointment', phone: phone, date: new Date(), church: { connect: { id: orgId } }
                        }
                    });
                    await sendWhatsApp(phone, `✅ *Payment Successful!*\n\nYour appointment is fully paid. Just walk in, sit down, and relax!\n\nReply *Hi* to return to the main menu.`);
                } else {
                    await sendWhatsApp(phone, `⚠️ *Payment Failed.*\n\nYour bank declined the transaction. You can settle the R${price.toFixed(2)} in-store.\n\nReply *Hi* to return to the main menu.`);
                }
            }
        } else {
            await sendWhatsApp(phone, `✅ *No problem!*\n\nYou can settle the R${price.toFixed(2)} in-store. See you then!\n\nReply *Hi* to return to the main menu.`);
        }

        // End of flow, clean up session
        await prisma.botSession.deleteMany({ where: { phone } });
        if (session) { session.mode = null; session.step = null; session.data = null; }
        return true;
    }

    return true; 
}

module.exports = { processGroomingMessage };