// ==========================================
// bots/NPOCbot.js - Omni-Channel Handler
// Covers: Non-Profit Organizations (NPOs) 🤝
// ==========================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); 
const netcash = require('../services/netcash'); 
const { calculateTransaction } = require('../services/pricingEngine'); 

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

// --- HELPER: DYNAMIC ADS (Optional for NPOs) ---
async function getAdSuffix(orgCode) {
    try {
        const ad = await prisma.ad.findFirst({ 
            where: { churchCode: orgCode, status: 'Active', expiryDate: { gte: new Date() } },
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
async function handleNPOMessage(cleanPhone, incomingMsg, session, member) {
    let reply = "";

    session.orgName = session.orgName || member?.church?.name || "Organization";
    session.orgType = session.orgType || member?.church?.type || "NON_PROFIT";
    session.orgCode = session.orgCode || member?.churchCode;

    try {
        // ====================================================
        // 1. MAIN MENU TRIGGER & VALIDATION
        // ====================================================
        const triggers = ['hi', 'menu', 'hello', 'npo', 'donate', 'help', 'pay'];
        
        if (triggers.includes(incomingMsg.toLowerCase())) { 
            
            // TRAP: User typed NPO trigger but is actually in a Church
            if (session.orgType === 'CHURCH') {
                reply = `🚫 You are currently connected to *${session.orgName}*, which is a Church.\n\n` +
                        `Reply *'Menu'* to see church options.`;
            } else {
                // 🤝 SCENARIO: STANDARD NPO
                session.step = 'NPO_MENU'; 
                const adText = await getAdSuffix(session.orgCode); 
                
                reply = `🤝 *${session.orgName}* (NPO)\n` +
                        `_Making a difference together_\n\n` +
                        `1. Donate 💖\n` +
                        `2. Support a Project 🏗️\n` +
                        `3. Upcoming Events 📅\n` +
                        `4. Monthly Pledge 🔁\n` +
                        `5. News & Updates 📰\n` +
                        `6. My Profile 👤\n` +
                        `7. History 📜\n` + 
                        `8. Academy & Courses 🎓\n` +
                        `9. Go to Lobby 🛡️\n\n` +
                        `Reply with a number:${adText}`;
            }
        }

        // ====================================================
        // 2. MENU SELECTION HANDLER
        // ====================================================
        else if (session.step === 'NPO_MENU') {
            
            // --- OPTION 1: DONATE ---
            if (incomingMsg === '1') {
                session.step = 'NPO_PAY';
                session.choice = '1';
                reply = `💖 *General Donation*\n\nHow much would you like to give today? (e.g. 100)`;
            }

            // --- OPTION 2: SUPPORT A PROJECT ---
            else if (incomingMsg === '2') {
                const projects = await prisma.event.findMany({ 
                    where: { churchCode: session.orgCode, isDonation: true, status: 'Active' } 
                });

                if (projects.length === 0) {
                    reply = "⚠️ No active projects found right now.";
                    session.step = 'NPO_MENU';
                } else {
                    let list = "🏗️ *Select a Project to Support:*\n\n"; 
                    projects.forEach((p, index) => { list += `*${index + 1}.* ${p.name}\n`; });
                    reply = list + "\nReply with the number."; 
                    session.step = 'NPO_EVENT_SELECT'; 
                    session.availableEvents = projects; 
                }
            }

            // --- OPTION 3: EVENTS (Tickets) ---
            else if (incomingMsg === '3') {
                const events = await prisma.event.findMany({ 
                    where: { 
                        churchCode: session.orgCode, 
                        isDonation: false,
                        status: 'Active', 
                        expiryDate: { gte: new Date() } 
                    } 
                });
                
                if (events.length === 0) { 
                    reply = "⚠️ No upcoming ticketed events."; 
                    session.step = 'NPO_MENU'; 
                } else {
                    let list = "🎟️ *Select an Event:*\n\n"; 
                    events.forEach((e, index) => { 
                        list += `*${index + 1}.* ${e.name}\n🗓 ${new Date(e.date).toLocaleDateString()}\n💰 R${e.price}\n\n`; 
                    });
                    reply = list + "Reply with the number."; 
                    session.step = 'NPO_EVENT_SELECT'; 
                    session.availableEvents = events; 
                }
            }

            // --- OPTION 4: MONTHLY PLEDGE ---
            else if (incomingMsg === '4') {
                session.step = 'NPO_PAY';
                session.choice = '4';
                reply = `🔁 *Monthly Pledge*\n\nEnter the monthly amount you wish to pledge (e.g. 200):`;
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
                session.step = 'NPO_MENU';
            }

            // --- OPTION 6: PROFILE ---
            else if (incomingMsg === '6') {
                session.step = 'NPO_PROFILE_MENU';
                reply = "👤 *My Profile*\n\n1. Update Email\n2. Manage Recurring Pledges\n3. Switch Organization (Unlink)\n\nReply with a number:";
            }

            // --- OPTION 7: HISTORY ---
            else if (incomingMsg === '7') {
                 reply = await gateway.getTransactionHistory(member.id);
                 session.step = 'NPO_MENU';
            }
            
            // --- OPTION 8: ACADEMY ---
            else if (incomingMsg === '8') {
                 session.step = null;
                 reply = "🎓 *Welcome to the Academy!*\n\nTo view available modules and start learning, please reply with the word:\n👉 *Courses*";
            }
            
            // --- OPTION 9: GO TO LOBBY (Switch Org) ---
            else if (incomingMsg === '9') {
                 reply = "🔄 Leaving NPO mode...\nReply *Join* to search for a new organization.";
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
        else if (session.step === 'NPO_PAY') {
            let amount = parseFloat(incomingMsg.replace(/\D/g,'')); 
            if (isNaN(amount) || amount < 10) {
                reply = "⚠️ Please enter a valid amount (e.g. 100). Minimum is R10.";
                return sendWhatsApp(cleanPhone, reply);
            }
            
            let type = ''; 
            if (session.selectedEvent && session.selectedEvent.isDonation) type = `PROJECT-${session.selectedEvent.id}`;
            else if (session.choice === '1') type = 'DONATION';
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
                session.step = 'NPO_1CLICK_PAY';
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
                session.step = 'NPO_MENU';
            }
        }

        // ====================================================
        // 4. EVENT & PROJECT SELECTION (With Pricing & Seabe ID)
        // ====================================================
        else if (session.step === 'NPO_EVENT_SELECT') {
            const index = parseInt(incomingMsg) - 1;
            const events = session.availableEvents;
            
            if (events && events[index]) { 
                const selected = events[index];
                session.selectedEvent = selected;

                if (selected.isDonation) {
                    session.step = 'NPO_PAY'; 
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
                        session.step = 'NPO_1CLICK_PAY';
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
                        
                        session.step = 'NPO_MENU';
                    }
                }
            } else {
                reply = "Invalid selection.";
            }
        }

        // ====================================================
        // ⚡ 4.5 SEABE ID: 1-CLICK CHECKOUT EXECUTION
        // ====================================================
        else if (session.step === 'NPO_1CLICK_PAY') {
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
                    return sendWhatsApp(cleanPhone, reply); // Leave them in 1CLICK_PAY so they can reply '2'
                }
                session.step = 'NPO_MENU';
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
                session.step = 'NPO_MENU';
            }
            else {
                reply = "⚠️ Invalid option. Please reply *1* to use your saved card, or *2* to use a payment link.";
            }
        }

        // ====================================================
        // 5. PROFILE MANAGEMENT
        // ====================================================
        else if (session.step === 'NPO_PROFILE_MENU') {
            if (incomingMsg === '1') {
                session.step = 'NPO_UPDATE_EMAIL';
                reply = "📧 Reply with your new *Email Address*:";
            } else if (incomingMsg === '2') {
                 const subsMsg = await gateway.listActiveSubscriptions(cleanPhone);
                 reply = subsMsg + "\n\n(Reply '0' to go back)";
                 session.step = 'NPO_CANCEL_SUB_SELECT';
            } 
            else if (incomingMsg === '3') {
                await prisma.member.update({ where: { id: member.id }, data: { churchCode: null, status: 'INACTIVE' } });
                delete session.mode; 
                delete session.orgCode;
                reply = "🔄 You have unlinked from this organization.\n\nReply *Join* to search for a new one.";
            }
        }

        else if (session.step === 'NPO_UPDATE_EMAIL') {
            const newEmail = incomingMsg;
            if (!newEmail.includes('@')) {
                reply = "⚠️ Invalid email.";
            } else {
                await prisma.member.update({ where: { id: member.id }, data: { email: newEmail } });
                reply = `✅ Email updated to: *${newEmail}*`;
                session.step = 'NPO_MENU'; 
            }
        }
        
        else if (session.step === 'NPO_CANCEL_SUB_SELECT') {
             if (incomingMsg === '0') {
                 session.step = 'NPO_MENU';
                 reply = "Returning to menu...";
             } else {
                 reply = `⚠️ To securely cancel a recurring debit or EFT mandate, please refer to the secure link sent to your email or contact ${session.orgName} administration.`;
                 session.step = 'NPO_MENU';
             }
        }

        // --- FINAL SEND ---
        if (reply) {
            await sendWhatsApp(cleanPhone, reply);
        }

    } catch (e) { 
        console.error("❌ CRITICAL NPO Bot Error:", e);
        await sendWhatsApp(cleanPhone, "⚠️ System error loading NPO menu. Please try again in a few minutes.");
    }
}

module.exports = { handleNPOMessage };