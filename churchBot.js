// ==========================================
// bots/churchBot.js - Omni-Channel Handler
// Covers: Churches ⛪ AND Non-Profits 🤝
// ==========================================

const { 
    createPaymentLink, 
    createSubscriptionLink, 
    getTransactionHistory,
    listActiveSubscriptions,
    cancelSubscription
} = require('./services/paystack');

// --- HELPER: DYNAMIC ADS ---
// Fetches sponsored text if available
async function getAdSuffix(churchCode, prisma) {
    try {
        const ad = await prisma.ad.findFirst({ 
            where: { churchCode: churchCode, status: 'Active', expiryDate: { gte: new Date() } },
            orderBy: { createdAt: 'desc' }    
        });

        if (ad) {
            // Count view in background
            prisma.ad.update({ where: { id: ad.id }, data: { views: { increment: 1 } } }).catch(e => {});
            return `\n\n----------------\n💡 *SPONSORED:*\n${ad.content}\n----------------`;
        }
        return "";
    } catch (e) { return ""; }
}

// --- MAIN HANDLER ---
async function handleChurchMessage(incomingMsg, cleanPhone, session, prisma, twiml, res) {
    let reply = "";

    try {
        // ====================================================
        // 1. MAIN MENU TRIGGER & NPO DETECTION
        // ====================================================
        const triggers = ['hi', 'menu', 'hello', 'npo', 'donate', 'help'];
        
        if (triggers.includes(incomingMsg)) {
            
            // 🅰️ SCENARIO: NON-PROFIT ORGANIZATION (NPO)
            if (session.orgType === 'NON_PROFIT') {
                session.step = 'CHURCH_MENU'; // Reuse the menu state
                
                reply = `🤝 *${session.orgName}* (NPO)\n` +
                        `_Making a difference together_\n\n` +
                        `1. Donate 💖\n` +
                        `2. Support a Project 🏗️\n` +
                        `3. Upcoming Events 📅\n` +
                        `4. Monthly Pledge 🔁\n` +
                        `5. News & Updates 📰\n` +
                        `6. My Profile 👤\n` +
                        `7. History 📜\n` + 
                        `8. Go to Society 🛡️\n\n` +
                        `Reply with a number:`;
            
            // 🅱️ TRAP: User typed "NPO" but is inside a CHURCH
            } else if (['npo', 'donate'].includes(incomingMsg) && session.orgType === 'CHURCH') {
                reply = `🚫 You are currently connected to *${session.orgName}*, which is a Church.\n\n` +
                        `Reply *'Menu'* to see church options.`;

            // ⛪ SCENARIO: STANDARD CHURCH
            } else {
                session.step = 'CHURCH_MENU';
                const adText = await getAdSuffix(session.orgCode, prisma); // Use orgCode or ID depending on schema
                
                reply = `⛪ *${session.orgName}*\n\n` +
                        `1. Offering 🎁\n` +
                        `2. Tithe 🏛️\n` +
                        `3. Events 🎟️\n` +
                        `4. Partner 🔁\n` +
                        `5. News 📰\n` +
                        `6. Profile 👤\n` +
                        `7. History 📜\n` +
                        `8. Go to Society 🛡️\n\n` + 
                        `Reply with a number:${adText}`;
            }
        }

        // ====================================================
        // 2. MENU SELECTION HANDLER
        // ====================================================
        else if (session.step === 'CHURCH_MENU') {
            
            // --- OPTION 1: OFFERING (Church) OR DONATE (NPO) ---
            if (incomingMsg === '1') {
                session.step = 'CHURCH_PAY';
                session.choice = '1';
                
                if (session.orgType === 'NON_PROFIT') {
                    reply = `💖 *General Donation*\n\nHow much would you like to give today? (e.g. 100)`;
                } else {
                    reply = `🎁 *Offering*\n\nPlease enter the amount (e.g. 50):`;
                }
            }

            // --- OPTION 2: TITHE (Church) OR PROJECTS (NPO) ---
            else if (incomingMsg === '2') {
                if (session.orgType === 'NON_PROFIT') {
                    // NPO: FETCH PROJECTS (Events marked as Donations)
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
                    // CHURCH: TITHE
                    session.step = 'CHURCH_PAY';
                    session.choice = '2';
                    reply = `🏛️ *Tithe*\n\nPlease enter your tithe amount (e.g. 500):`;
                }
            }

            // --- OPTION 3: EVENTS (Tickets for Everyone) ---
            else if (incomingMsg === '3') {
                const events = await prisma.event.findMany({ 
                    where: { 
                        churchCode: session.orgCode, 
                        status: 'Active', 
                        // ❌ REMOVED: isDonation: false (This field might not exist in your new schema)
                        // ❌ REMOVED: date: { gte: new Date() } 
                        
                        // ✅ ADDED: Filter by Expiry Date instead
                        expiryDate: { gte: new Date() } 
                    } 
                });
                
                if (events.length === 0) { 
                    reply = "⚠️ No upcoming ticketed events."; 
                    session.step = 'CHURCH_MENU'; 
                } else {
                    let list = "🎟️ *Select an Event:*\n\n"; 
                    events.forEach((e, index) => { 
                        // Added the Date Text to the list so users know when it is
                        list += `*${index + 1}.* ${e.name}\n🗓 ${e.date}\n💰 R${e.price}\n\n`; 
                    });
                    reply = list + "Reply with the number."; 
                    session.step = 'EVENT_SELECT'; 
                    session.availableEvents = events; 
                }
            }

            // --- OPTION 4: PARTNER (Church) OR PLEDGE (NPO) ---
            else if (incomingMsg === '4') {
                session.step = 'CHURCH_PAY';
                session.choice = '4';
                const label = (session.orgType === 'NON_PROFIT') ? 'Monthly Pledge' : 'Partnership';
                reply = `🔁 *${label}*\n\nEnter the monthly amount (e.g. 200):`;
            }

            // --- OPTION 5: NEWS ---
            else if (incomingMsg === '5') {
                // 1. Find the church ID first using the code (e.g., "AFM001")
const church = await prisma.church.findUnique({
    where: { code: "AFM001" } // or whatever variable holds the code
});

if (!church) {
    console.error("Church not found!");
    return;
}

// 2. Now fetch the news using the churchId we just found
const news = await prisma.news.findMany({
    where: {
        churchId: church.id, // Use the ID, not the Code
        status: "Active"
    },
    orderBy: {
        createdAt: "desc"
    },
    take: 3
});
            }

            // --- OPTION 6: PROFILE ---
            else if (incomingMsg === '6') {
                session.step = 'PROFILE_MENU';
                reply = "👤 *My Profile*\n\n1. Update Email\n2. Manage Recurring Gifts\n3. Switch Organization (Unlink)\n\nReply with a number:";
            }

            // --- OPTION 7: HISTORY ---
            else if (incomingMsg === '7') {
                 const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
                 const userEmail = member?.email || `${cleanPhone}@seabe.io`; 
                 reply = await getTransactionHistory(userEmail);
                 session.step = 'CHURCH_MENU';
            }
            
            // --- OPTION 8: SWITCH TO SOCIETY ---
            else if (incomingMsg === '8') {
                 reply = "🔄 Switching to Burial Society mode...\nReply *Society* to continue.";
                 delete session.mode; // Reset mode so main router picks up "Society"
            }

            else {
                reply = "⚠️ Invalid option.";
            }
        }

        // ====================================================
        // 3. PAYMENT PROCESSING (Amounts)
        // ====================================================
        else if (session.step === 'CHURCH_PAY') {
            let amount = incomingMsg.replace(/\D/g,''); // Remove non-digits
            let type = ''; 
            
            // 💡 FIX: CHECK IF THIS IS A SPECIFIC PROJECT FIRST
            if (session.selectedEvent && session.selectedEvent.isDonation) {
                // It's a specific fund (e.g. Building Fund)
                // We use the Event ID in the type: "PROJECT-12"
                type = `PROJECT-${session.selectedEvent.id}`;
            }
            // Standard Menu Choices
            else if (session.choice === '1') type = (session.orgType === 'NON_PROFIT') ? 'DONATION' : 'OFFERING';
            else if (session.choice === '2') type = 'TITHE';
            else if (session.choice === '4') type = 'RECURRING';
            else if (session.choice === 'EVENT') type = `TICKET-${session.selectedEvent.id}`; // Fixed Price Tickets

            // Identify User
            const memberInfo = await prisma.member.findUnique({ where: { phone: cleanPhone } });
            const customerEmail = memberInfo?.email || `${cleanPhone}@seabe.io`;
            
            // Generate Unique Reference
            // Result: "AFM001-PROJECT-5-8833-17234"
            const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            // Generate Link
            const link = (type === 'RECURRING') 
                ? await createSubscriptionLink(amount, ref, customerEmail, session.subaccount, cleanPhone, session.orgName) 
                : await createPaymentLink(amount, ref, customerEmail, session.subaccount, cleanPhone, session.orgName);
            
            if (link) {
                // Clear the selected event so it doesn't stick for next time
                delete session.selectedEvent;
                
                reply = `Tap to pay R${amount}:\n👉 ${link}`;
                
                // Log pending transaction
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
                    // Variable Amount (Project/Building Fund)
                    session.step = 'CHURCH_PAY'; 
                    // We cheat and set choice to '1' (Donation) but append Project Name in Ref later if needed
                    session.choice = '1'; 
                    reply = `🏗️ *${selected.name}*\n\nHow much would you like to contribute?`;
                } else {
                    // Fixed Price (Ticket)
                    session.step = 'CHURCH_PAY'; 
                    session.choice = 'EVENT'; 
                    // For tickets, we usually just confirm. 
                    // Simplified here to just generate link for 1 ticket:
                    const memberInfo = await prisma.member.findUnique({ where: { phone: cleanPhone } });
                    const email = memberInfo?.email || `${cleanPhone}@seabe.io`;
                    const ref = `${session.orgCode}-EVENT-${selected.id}-${Date.now().toString().slice(-5)}`;
                    
                    const link = await createPaymentLink(selected.price, ref, email, session.subaccount, cleanPhone, session.orgName);
                    reply = `Tap to buy ticket for ${selected.name} (R${selected.price}):\n👉 ${link}`;
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
                 // Manage Subscriptions
                 const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
                 const userEmail = member?.email || `${cleanPhone}@seabe.io`;
                 const subs = await listActiveSubscriptions(userEmail);
                 
                 if (subs.length === 0) {
                     reply = "You have no active recurring gifts.";
                     session.step = 'CHURCH_MENU';
                 } else {
                     let subList = "📋 *Your Active Subscriptions:*\n\n";
                     subs.forEach((sub, index) => {
                         const amount = (sub.amount / 100).toFixed(2);
                         subList += `*${index + 1}.* ${sub.plan.name} (R${amount})\n`;
                     });
                     subList += "\nReply with the number to *CANCEL* it, or '0' to go back.";
                     session.activeSubs = subs;
                     session.step = 'CANCEL_SUB_SELECT';
                     reply = subList;
                 }
            } 
            else if (incomingMsg === '3') {
                // UNLINK ORGANIZATION
                await prisma.member.update({ where: { phone: cleanPhone }, data: { churchCode: null } });
                delete session.mode; 
                delete session.orgCode;
                reply = "🔄 You have unlinked from this organization.\n\nReply *Hi* to search for a new one.";
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
                 const selection = parseInt(incomingMsg) - 1;
                 const subs = session.activeSubs;
                 if (subs && subs[selection]) {
                     const targetSub = subs[selection];
                     const success = await cancelSubscription(targetSub.subscription_code, targetSub.email_token);
                     reply = success ? `✅ Cancelled.` : "⚠️ Failed to cancel.";
                     session.step = 'CHURCH_MENU';
                 }
             }
        }

        // SEND REPLY
        if (reply) {
            twiml.message(reply);
            res.type('text/xml').send(twiml.toString());
        }

    } catch (e) { 
        console.error("Church Bot Error:", e);
        res.sendStatus(500);
    }
}

module.exports = { handleChurchMessage };