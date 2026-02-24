// ==========================================
// bots/churchBot.js - Omni-Channel Handler
// Covers: Churches ⛪ AND Non-Profits 🤝
// ==========================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); // ✅ Independent DB connection so it never drops
const ozow = require('../services/ozow'); 
const netcash = require('../services/netcash');

// Safely initialize Twilio for direct background messaging
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

// Our magic background sender!
const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing! Could not send message.");
    
    // ✨ Foolproof cleaner: strips 'whatsapp:' if it exists, then adds it back cleanly
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');

    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`, // Always perfectly formatted!
            to: `whatsapp:${to}`,
            body: body
        });
        console.log(`✅ Text delivered to ${to}`);
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

// 🎛️ THE MASTER TOGGLE
const ACTIVE_GATEWAY_NAME = process.env.ACTIVE_GATEWAY || 'OZOW'; 
const gateway = ACTIVE_GATEWAY_NAME === 'NETCASH' ? netcash : ozow;

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

    // Ensure session properties exist so we don't crash
    session.orgName = session.orgName || member?.church?.name || "Organization";
    session.orgType = session.orgType || member?.church?.type || "CHURCH";
    session.orgCode = session.orgCode || member?.churchCode;

    try {
        // ====================================================
        // 1. MAIN MENU TRIGGER & NPO DETECTION
        // ====================================================
        const triggers = ['amen', 'hi', 'menu', 'hello', 'npo', 'donate', 'help', 'pay'];
        
        if (triggers.includes(incomingMsg)) {
            
            // 🅰️ SCENARIO: NON-PROFIT ORGANIZATION (NPO)
            if (session.orgType === 'NON_PROFIT') {
                session.step = 'CHURCH_MENU'; 
                
                reply = `🤝 *${session.orgName}* (NPO)\n` +
                        `_Making a difference together_\n\n` +
                        `1. Donate 💖\n` +
                        `2. Support a Project 🏗️\n` +
                        `3. Upcoming Events 📅\n` +
                        `4. Monthly Pledge 🔁\n` +
                        `5. News & Updates 📰\n` +
                        `6. My Profile 👤\n` +
                        `7. History 📜\n` + 
                        `8. Go to Lobby 🛡️\n\n` +
                        `Reply with a number:`;
            
            // 🅱️ TRAP: User typed "NPO" but is inside a CHURCH
            } else if (['npo', 'donate'].includes(incomingMsg) && session.orgType === 'CHURCH') {
                reply = `🚫 You are currently connected to *${session.orgName}*, which is a Church.\n\n` +
                        `Reply *'Menu'* to see church options.`;

            // ⛪ SCENARIO: STANDARD CHURCH
            } else {
                session.step = 'CHURCH_MENU';
                const adText = await getAdSuffix(session.orgCode); 
                
                reply = `⛪ *${session.orgName}*\n\n` +
                        `1. Offering 🎁\n` +
                        `2. Tithe 🏛️\n` +
                        `3. Events 🎟️\n` +
                        `4. Partner 🔁\n` +
                        `5. News 📰\n` +
                        `6. Profile 👤\n` +
                        `7. History 📜\n` +
                        `8. Go to Lobby 🛡️\n\n` + 
                        `Reply with a number:${adText}`;
            }
        }

        // ====================================================
        // 2. MENU SELECTION HANDLER
        // ====================================================
        else if (session.step === 'CHURCH_MENU') {
            
            // --- OPTION 1: OFFERING / DONATE ---
            if (incomingMsg === '1') {
                session.step = 'CHURCH_PAY';
                session.choice = '1';
                if (session.orgType === 'NON_PROFIT') {
                    reply = `💖 *General Donation*\n\nHow much would you like to give today? (e.g. 100)`;
                } else {
                    reply = `🎁 *Offering*\n\nPlease enter the amount (e.g. 50):`;
                }
            }

            // --- OPTION 2: TITHE / PROJECTS ---
            else if (incomingMsg === '2') {
                if (session.orgType === 'NON_PROFIT') {
                    const projects = await prisma.event.findMany({ 
                        where: { churchCode: session.orgCode, isDonation: true, status: 'Active' } 
                    });

                    if (projects.length === 0) {
                        reply = "⚠️ No active projects found right now.";
                        session.step = 'CHURCH_MENU';
                    } else {
                        let list = "🏗️ *Select a Project to Support:*\n\n"; 
                        projects.forEach((p, index) => { list += `*${index + 1}.* ${p.name}\n`; });
                        reply = list + "\nReply with the number."; 
                        session.step = 'EVENT_SELECT'; 
                        session.availableEvents = projects; 
                    }
                } else {
                    session.step = 'CHURCH_PAY';
                    session.choice = '2';
                    reply = `🏛️ *Tithe*\n\nPlease enter your tithe amount (e.g. 500):`;
                }
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
                        list += `*${index + 1}.* ${e.name}\n🗓 ${e.date}\n💰 R${e.price}\n\n`; 
                    });
                    reply = list + "Reply with the number."; 
                    session.step = 'EVENT_SELECT'; 
                    session.availableEvents = events; 
                }
            }

            // --- OPTION 4: PARTNER / PLEDGE ---
            else if (incomingMsg === '4') {
                session.step = 'CHURCH_PAY';
                session.choice = '4';
                const label = (session.orgType === 'NON_PROFIT') ? 'Monthly Pledge' : 'Partnership';
                reply = `🔁 *${label}*\n\nEnter the monthly amount (e.g. 200):`;
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
                 reply = await gateway.getTransactionHistory(cleanPhone);
                 session.step = 'CHURCH_MENU';
            }
            
            // --- OPTION 8: SWITCH TO SOCIETY ---
            else if (incomingMsg === '8') {
                 reply = "🔄 Switching to Burial Society mode...\nReply *Society* to continue.";
                 delete session.mode; 
                 session.step = null;
            }

            else {
                reply = "⚠️ Invalid option. Please reply with a number from the menu.";
            }
        }

        // ====================================================
        // 3. PAYMENT PROCESSING
        // ====================================================
        else if (session.step === 'CHURCH_PAY') {
            let amount = incomingMsg.replace(/\D/g,''); 
            let type = ''; 
            
            if (session.selectedEvent && session.selectedEvent.isDonation) {
                type = `PROJECT-${session.selectedEvent.id}`;
            }
            else if (session.choice === '1') type = (session.orgType === 'NON_PROFIT') ? 'DONATION' : 'OFFERING';
            else if (session.choice === '2') type = 'TITHE';
            else if (session.choice === '4') type = 'RECURRING';
            else if (session.choice === 'EVENT') type = `TICKET-${session.selectedEvent.id}`;

            const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            const link = await gateway.createPaymentLink(amount, ref, cleanPhone, session.orgName);
            
            if (link) {
                delete session.selectedEvent;
                reply = `Tap to securely pay R${amount} via ${ACTIVE_GATEWAY_NAME}:\n👉 ${link}`;
                
                await prisma.transaction.create({ 
                    data: { churchCode: session.orgCode, phone: cleanPhone, type, amount: parseFloat(amount), reference: ref, status: 'PENDING', date: new Date() } 
                });
            } else {
                reply = "⚠️ Payment link error. Please try again later.";
            }
            session.step = 'CHURCH_MENU';
        }

        // ====================================================
        // 4. EVENT & PROJECT SELECTION
        // ====================================================
        else if (session.step === 'EVENT_SELECT') {
            const index = parseInt(incomingMsg) - 1;
            const events = session.availableEvents;
            
            if (events && events[index]) { 
                const selected = events[index];
                session.selectedEvent = selected;

                if (selected.isDonation) {
                    session.step = 'CHURCH_PAY'; 
                    session.choice = '1'; 
                    reply = `🏗️ *${selected.name}*\n\nHow much would you like to contribute?`;
                } else {
                    session.step = 'CHURCH_PAY'; 
                    session.choice = 'EVENT'; 
                    const ref = `${session.orgCode}-EVENT-${selected.id}-${Date.now().toString().slice(-5)}`;
                    
                    const link = await gateway.createPaymentLink(selected.price, ref, cleanPhone, session.orgName);
                    reply = `Tap to buy a ticket for ${selected.name} (R${selected.price}) via ${ACTIVE_GATEWAY_NAME}:\n👉 ${link}`;
                    session.step = 'CHURCH_MENU';
                }
            } else {
                reply = "Invalid selection.";
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
                await prisma.member.update({ where: { phone: cleanPhone }, data: { churchCode: null } });
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
                await prisma.member.update({ where: { phone: cleanPhone }, data: { email: newEmail } });
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
        // Send the reply in the background using Twilio Client!
        if (reply) {
            await sendWhatsApp(cleanPhone, reply);
        }

    } catch (e) { 
        console.error("❌ CRITICAL Church Bot Error:", e);
        await sendWhatsApp(cleanPhone, "⚠️ System error loading church menu. Please try again in a few minutes.");
    }
}

module.exports = { handleChurchMessage };