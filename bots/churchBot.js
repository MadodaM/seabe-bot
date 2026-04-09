// ==========================================
// bots/churchBot.js - Dedicated Church Handler
// Covers: Churches ⛪
// ==========================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); 
const netcash = require('../services/netcash'); 
const { calculateTransaction } = require('../services/pricingEngine'); 
const { t } = require('../utils/i18n');

// Safely initialize Twilio
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

// Background Sender
const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing! Could not send message.");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');

    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`, 
            to: `whatsapp:${to}`,
            body: body
        });
        console.log(`✅ Text delivered to ${to}`);
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

const gateway = netcash;

// --- HELPER: DYNAMIC ADS ---
async function getAdSuffix(churchCode) {
    try {
        const ad = await prisma.ad.findFirst({ 
            where: { churchCode: churchCode, status: 'Active', expiryDate: { gte: new Date() } },
            orderBy: { createdAt: 'desc' }   
        });

        if (ad) {
            prisma.ad.update({ where: { id: ad.id }, data: { views: { increment: 1 } } }).catch(e => {});
            return `\n\n----------------\n💡 *SPONSORED:*\n${ad.content}\n----------------`;
        }
        return "";
    } catch (e) { return ""; }
}

// --- MAIN HANDLER ---
async function handleChurchMessage(cleanPhone, incomingMsg, session, member) {
    let reply = "";

    session.orgName = session.orgName || member?.church?.name || "Church";
    session.orgCode = session.orgCode || member?.churchCode;
	
	const userLang = member?.language || 'en';
	
    try {
        // ====================================================
        // 1. MAIN MENU TRIGGER
        // ====================================================
        const triggers = ['amen', 'hi', 'menu', 'hello', 'help', 'pay'];
        
        if (triggers.includes(incomingMsg.toLowerCase())) { 
            
            // ⛪ SCENARIO: STANDARD CHURCH
            session.step = 'CHURCH_MENU';
            const adText = await getAdSuffix(session.orgCode); 
            
            // 🌐 Use the translation dictionary!
            reply = `⛪ *${session.orgName}*\n\n` +
                    `${t('church_menu', userLang)}\n\n` +
                    `_Reply with a number / Phendula ngenombolo / Araba ka nomoro:_${adText}`;
        }

        // ====================================================
        // 2. MENU SELECTION HANDLER
        // ====================================================
        else if (session.step === 'CHURCH_MENU') {
            
            // --- OPTION 1: OFFERING ---
            if (incomingMsg === '1') {
                session.step = 'CHURCH_PAY';
                session.choice = '1';
                reply = `🎁 *Offering*\n\nPlease enter the amount (e.g. 50):`;
            }

            // --- OPTION 2: TITHE ---
            else if (incomingMsg === '2') {
                session.step = 'CHURCH_PAY';
                session.choice = '2';
                reply = `🏛️ *Tithe*\n\nPlease enter your tithe amount (e.g. 500):`;
            }

            // --- OPTION 3: EVENTS (Tickets) ---
            else if (incomingMsg === '3') {
                const events = await prisma.event.findMany({ 
                    where: { 
                        churchCode: session.orgCode, 
                        status: 'Active', 
                        expiryDate: { gte: new Date() } 
                    } 
                });
                
                if (events.length === 0) { 
                    reply = "⚠️ No upcoming ticketed events."; 
                    session.step = 'CHURCH_MENU'; 
                } else {
                    let list = "🎟️ *Select an Event:*\n\n"; 
                    events.forEach((e, index) => { 
                        list += `*${index + 1}.* ${e.name}\n🗓 ${new Date(e.date).toLocaleDateString()}\n💰 R${e.price}\n\n`; 
                    });
                    reply = list + "Reply with the number."; 
                    session.step = 'EVENT_SELECT'; 
                    session.availableEvents = events; 
                }
            }

            // --- OPTION 4: PARTNER ---
            else if (incomingMsg === '4') {
                session.step = 'CHURCH_PAY';
                session.choice = '4';
                reply = `🔁 *Partnership*\n\nEnter the monthly amount (e.g. 200):`;
            }

            // --- OPTION 5: NEWS ---
            else if (incomingMsg === '5') {
                const news = await prisma.news.findMany({ 
                    where: { church: { code: session.orgCode }, status: 'Active' }, 
                    orderBy: { createdAt: 'desc' }, 
                    take: 3 
                });

                if (news.length === 0) {
                    reply = "📰 No news updates at the moment.";
                } else {
                    reply = "*Latest Updates:*\n\n" + news.map(n => `📌 *${n.headline}*\n${n.body || ''}`).join('\n\n');
                }
                session.step = 'CHURCH_MENU';
            }

            // --- OPTION 6: PROFILE ---
            else if (incomingMsg === '6') {
                session.step = 'PROFILE_MENU';
                reply = "👤 *My Profile*\n\n1. Update Email\n2. Manage Recurring Gifts\n3. Switch Organization (Unlink)\n\nReply with a number:";
            }

            // --- OPTION 7: HISTORY ---
            else if (incomingMsg === '7') {
                 reply = await gateway.getTransactionHistory(member.id);
                 session.step = 'CHURCH_MENU';
            }
            
            // --- OPTION 8: ACADEMY ---
            else if (incomingMsg === '8') {
                 session.step = null;
                 reply = "🎓 *Welcome to the Academy!*\n\nTo view available modules and start learning, please reply with the word:\n👉 *Courses*";
            }
            
            // --- OPTION 9: GO TO LOBBY ---
            else if (incomingMsg === '9') {
                 reply = "🔄 Leaving Church mode...\nReply *Join* to search for a new organization.";
                 delete session.mode; 
                 session.step = null;
            }

            else {
                reply = "⚠️ Invalid option. Please reply with a number from the menu.";
            }
        }

        // ====================================================
        // 3. PAYMENT PROCESSING (User Input -> Trigger Seabe ID)
        // ====================================================
        else if (session.step === 'CHURCH_PAY') {
			
			// 🛑 THE KYC SOFT GATE
            // Check if the organization is legally allowed to touch money yet
            if (!member.church.canCollectMoney) {
                const lockMsg = `🚧 *Payment Gateway Upgrading*\n\n` +
                                `*${session.orgName}* is currently finalizing their secure banking integration with the central reserve.\n\n` +
                                `Online payments will be activated shortly. Please try again later!`;
                await sendWhatsApp(cleanPhone, lockMsg);
                return { handled: true };
            }
			
            let amount = parseFloat(incomingMsg.replace(/\D/g,'')); 
            if (isNaN(amount) || amount < 10) {
                reply = "⚠️ Please enter a valid amount (e.g. 100).";
                await sendWhatsApp(cleanPhone, reply);
                return { handled: true };
            }
            
            let type = ''; 
            if (session.selectedEvent && session.selectedEvent.isDonation) type = `PROJECT-${session.selectedEvent.id}`;
            else if (session.choice === '1') type = 'OFFERING';
            else if (session.choice === '2') type = 'TITHE';
            else if (session.choice === '4') type = 'RECURRING';
            
            // Save state for 1-Click Execution
            session.tempPaymentAmount = amount;
            session.tempPaymentType = type;

            // 🔍 SEABE ID CHECK
            const savedCards = await prisma.paymentMethod.findMany({
                where: { memberId: member.id }, orderBy: { createdAt: 'desc' }
            });

            if (savedCards.length > 0) {
                const card = savedCards[0];
                session.step = 'CHURCH_1CLICK_PAY';
                session.savedCardToken = card.token;
                reply = `💳 *Secure 1-Click Giving*\n\nAmount: *R${amount.toFixed(2)}*\n\nWould you like to give using your saved *${card.cardBrand} ending in ${card.last4}*?\n\n*1️⃣ Yes, charge my card now*\n*2️⃣ No, send me a payment link*\n\nReply 1 or 2.`;
            } else {
                // Standard Link Generation
                const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const link = await gateway.createPaymentLink(amount, ref, cleanPhone, session.orgName, '', session.churchCode, type);
                
                if (link) {
                    delete session.selectedEvent;
                    reply = `Tap to securely transact R${amount.toFixed(2)} to *${session.orgName}* via Seabe Pay:\n👉 ${link}\n\nReply *Menu* to return to the dashboard.`;                 
                } else {
                    reply = "⚠️ Payment link error. Please try again later.";
                }
                session.step = 'CHURCH_MENU';
            }
        }

        // ====================================================
        // 4. EVENT & PROJECT SELECTION (With Pricing & Seabe ID)
        // ====================================================
        else if (session.step === 'EVENT_SELECT') {
            const index = parseInt(incomingMsg) - 1;
            const events = session.availableEvents;
            
            if (events && events[index]) { 
                const selected = events[index];
                session.selectedEvent = selected;

                // Handles if a church creates a "Donation Goal" event (like a building fund)
                if (selected.isDonation) {
                    session.step = 'CHURCH_PAY'; 
                    session.choice = '1'; 
                    reply = `🏗️ *${selected.name}*\n\nHow much would you like to contribute?`;
                } else {
                    // Ticket Purchase
                    const pricing = await calculateTransaction(selected.price, 'STANDARD', 'CAPITEC');
                    const totalAmount = pricing.totalChargedToUser;
                    const type = `TICKET-${selected.id}`;
                    
                    session.tempPaymentAmount = totalAmount;
                    session.tempPaymentType = type;

                    // 🔍 SEABE ID CHECK
                    const savedCards = await prisma.paymentMethod.findMany({
                        where: { memberId: member.id }, orderBy: { createdAt: 'desc' }
                    });

                    if (savedCards.length > 0) {
                        const card = savedCards[0];
                        session.step = 'CHURCH_1CLICK_PAY';
                        session.savedCardToken = card.token;
                        reply = `🎟️ *${selected.name}*\n\nTicket: R${pricing.baseAmount.toFixed(2)}\nService Fee: R${pricing.totalFees.toFixed(2)}\n*Total Due: R${totalAmount.toFixed(2)}*\n\nWould you like to pay using your saved *${card.cardBrand} ending in ${card.last4}*?\n\n*1️⃣ Yes, charge my card now*\n*2️⃣ No, send me a payment link*`;
                    } else {
                        // Standard Link Generation
                        const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                        const link = await gateway.createPaymentLink(totalAmount, ref, cleanPhone, session.orgName, '', session.churchCode, type);
                        
                        await prisma.transaction.create({ 
                            data: { 
                                churchCode: session.orgCode, memberId: member.id, phone: cleanPhone, type: type, 
                                amount: totalAmount, reference: ref, status: 'PENDING', date: new Date() 
                            } 
                        });

                        reply = `Tap to buy a ticket for *${selected.name}* via Netcash:\n` +
                                `Ticket: R${pricing.baseAmount.toFixed(2)}\n` +
                                (pricing.totalFees > 0 ? `Service Fee: R${pricing.totalFees.toFixed(2)}\n` : '') +
                                `*Total: R${totalAmount.toFixed(2)}*\n👉 ${link}\n\nReply *Menu* to return to the dashboard.`;
                        
                        session.step = 'CHURCH_MENU';
                    }
                }
            } else {
                reply = "Invalid selection.";
            }
        }

        // ====================================================
        // ⚡ 4.5 SEABE ID: 1-CLICK CHECKOUT EXECUTION
        // ====================================================
        else if (session.step === 'CHURCH_1CLICK_PAY') {
            const amount = session.tempPaymentAmount;
            const type = session.tempPaymentType;

            if (incomingMsg === '1') {
                await sendWhatsApp(cleanPhone, "🔄 *Processing Transaction...*\nSecurely communicating with your bank. Please wait.");

                const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                
                // Trigger the Server-to-Server Token Charge
                const chargeResult = await gateway.chargeSavedToken(session.savedCardToken, amount, ref);

                if (chargeResult.success) {
                    await prisma.transaction.create({
                        data: {
                            amount: amount, type: type, status: 'SUCCESS', reference: ref, method: 'SEABE_ID_TOKEN',
                            description: `1-Click Payment (${type})`, phone: cleanPhone, date: new Date(), church: { connect: { id: member.churchId } }
                        }
                    });
                    delete session.selectedEvent;
                    reply = `✅ *Payment Successful!*\n\nThank you for your generosity, ${member.firstName}. Your transaction of *R${amount.toFixed(2)}* was successfully processed.\n\nReply *Menu* to return to the dashboard.`;
                } else {
                    reply = `⚠️ *Payment Failed*\n\nYour bank declined the transaction. Please reply *2* to try again with a secure payment link.`;
                    await sendWhatsApp(cleanPhone, reply);
                    return { handled: true }; 
                }
                session.step = 'CHURCH_MENU';
            }
            else if (incomingMsg === '2') {
                const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const link = await gateway.createPaymentLink(amount, ref, cleanPhone, session.orgName, '', session.churchCode, type);

                if (link) {
                    delete session.selectedEvent;
                    reply = `💳 *Alternative Payment*\n\n👉 Transact securely here:\n${link}\n\nReply *Menu* to return to the dashboard.`;
                } else {
                    reply = "⚠️ Payment link error. Please try again later.";
                }
                session.step = 'CHURCH_MENU';
            }
            else {
                reply = "⚠️ Invalid option. Please reply *1* to use your saved card, or *2* to use a payment link.";
            }
        }

        // ====================================================
        // 5. PROFILE MANAGEMENT
        // ====================================================
        else if (session.step === 'PROFILE_MENU') {
            if (incomingMsg === '1') {
                session.step = 'UPDATE_EMAIL';
                reply = "📧 Reply with your new *Email Address*:";
            } else if (incomingMsg === '2') {
                 const subsMsg = await gateway.listActiveSubscriptions(cleanPhone);
                 reply = subsMsg + "\n\n(Reply '0' to go back)";
                 session.step = 'CANCEL_SUB_SELECT';
            } 
            else if (incomingMsg === '3') {
                await prisma.member.update({ where: { id: member.id }, data: { churchCode: null, status: 'INACTIVE' } });
                delete session.mode; 
                delete session.orgCode;
                reply = "🔄 You have unlinked from this organization.\n\nReply *Join* to search for a new one.";
            }
        }

        else if (session.step === 'UPDATE_EMAIL') {
            const newEmail = incomingMsg;
            if (!newEmail.includes('@')) {
                reply = "⚠️ Invalid email.";
            } else {
                await prisma.member.update({ where: { id: member.id }, data: { email: newEmail } });
                reply = `✅ Email updated to: *${newEmail}*`;
                session.step = 'CHURCH_MENU'; 
            }
        }
        
        else if (session.step === 'CANCEL_SUB_SELECT') {
             if (incomingMsg === '0') {
                 session.step = 'CHURCH_MENU';
                 reply = "Returning to menu...";
             } else {
                 reply = `⚠️ To securely cancel a recurring debit or EFT mandate, please refer to the secure link sent to your email or contact ${session.orgName} administration.`;
                 session.step = 'CHURCH_MENU';
             }
        }

        // --- FINAL SEND ---
        if (reply) {
            await sendWhatsApp(cleanPhone, reply);
            return { handled: true }; // Tell the router we answered the customer!
        }

        return { handled: false }; // Tell the router "I don't know this word!"

    } catch (e) { 
        console.error("❌ CRITICAL Bot Error:", e);
        await sendWhatsApp(cleanPhone, "⚠️ System error loading the menu. Please try again in a few minutes.");
        return { handled: true }; 
    }
}

module.exports = { handleChurchMessage };