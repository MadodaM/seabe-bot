// ==========================================
// churchBot.js - Church Logic Handler (Fixed)
// ==========================================
const { 
    createPaymentLink, 
    createSubscriptionLink, 
    getTransactionHistory,
    listActiveSubscriptions,
    cancelSubscription
} = require('./services/paystack');

// --- HELPER: DYNAMIC ADS ---
async function getAdSuffix(churchId, prisma) {
    try {
        const ad = await prisma.ad.findFirst({ 
            where: { churchId: churchId, status: 'Active', expiryDate: { gte: new Date() } },
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
        // 1. MAIN MENU TRIGGER
        if (['hi', 'menu', 'hello'].includes(incomingMsg)) {
            session.step = 'CHURCH_MENU';
            const adText = await getAdSuffix(session.churchId, prisma);
            
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

        // 2. MENU SELECTION HANDLER
        else if (session.step === 'CHURCH_MENU') {
            
            // PAYMENTS (Offering, Tithe, Partner)
            if (['1', '2', '4'].includes(incomingMsg)) {
                session.choice = incomingMsg;
                session.step = 'CHURCH_PAY';
                let label = incomingMsg === '1' ? 'Offering' : (incomingMsg === '2' ? 'Tithe' : 'Partnership');
                reply = `💰 *${label}*\n\nPlease enter the amount (e.g. 100):`;
            }

            // EVENTS
            else if (incomingMsg === '3') {
                const events = await prisma.event.findMany({ 
                    where: { churchCode: session.orgCode, status: 'Active', expiryDate: { gte: new Date() } } 
                });
                if (events.length === 0) { 
                    reply = "⚠️ No active events found."; 
                    session.step = 'CHURCH_MENU'; 
                } else {
                    let list = "*Select an Event:*\n"; 
                    events.forEach((e, index) => { list += `*${index + 1}.* ${e.name} (R${e.price})\n`; });
                    reply = list; 
                    session.step = 'EVENT_SELECT'; 
                    session.availableEvents = events; 
                }
            }

            // NEWS
            else if (incomingMsg === '5') {
                 const news = await prisma.news.findMany({ 
                    where: { status: 'Active', expiryDate: { gte: new Date() } }, 
                    orderBy: { createdAt: 'desc' }, 
                    take: 3 
                });
                reply = news.length === 0 ? "📰 No news updates." : "*Latest News:*\n\n" + news.map(n => `📌 *${n.headline}*\n${n.body || ''}\n\n`).join('');
                session.step = 'CHURCH_MENU';
            }

            // PROFILE
            else if (incomingMsg === '6') {
                session.step = 'PROFILE_MENU';
                reply = "👤 *My Profile*\n\n1. Update Email\n2. Manage Recurring Gifts\n3. Switch Church (Unlink)\n\nReply with a number:";
            }

            // HISTORY
            else if (incomingMsg === '7') {
                 const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
                 const userEmail = member?.email || `${cleanPhone}@seabe.io`; 
                 reply = await getTransactionHistory(userEmail);
                 session.step = 'CHURCH_MENU';
            }
            
            // SWITCH TO SOCIETY
            else if (incomingMsg === '8') {
                 reply = "🔄 Switching to Burial Society mode...\nReply *Society* to continue.";
                 delete session.mode; 
            }

            else {
                reply = "⚠️ Invalid option.";
            }
        }

        // 3. PAYMENT LOGIC
        else if (session.step === 'CHURCH_PAY') {
            let amount = incomingMsg.replace(/\D/g,''); 
            let type = ''; 
            
            if (session.choice === '1') type = 'OFFERING';
            else if (session.choice === '2') type = 'TITHE';
            else if (session.choice === '4') type = 'RECURRING';

            const memberInfo = await prisma.member.findUnique({ where: { phone: cleanPhone } });
            const customerEmail = memberInfo?.email || `${cleanPhone}@seabe.io`;
            const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;

            const link = (type === 'RECURRING') 
                ? await createSubscriptionLink(amount, ref, customerEmail, session.subaccount, cleanPhone, session.orgName) 
                : await createPaymentLink(amount, ref, customerEmail, session.subaccount, cleanPhone, session.orgName);
            
            if (link) {
                reply = `Tap to pay R${amount}:\n👉 ${link}`;
                await prisma.transaction.create({ 
                    data: { churchCode: session.orgCode, phone: cleanPhone, type, amount: parseFloat(amount), reference: ref, status: 'PENDING', date: new Date() } 
                });
            } else {
                reply = "⚠️ Payment link error.";
            }
            session.step = 'CHURCH_MENU';
        }

        // 4. EVENT SELECTION
        else if (session.step === 'EVENT_SELECT') {
            const index = parseInt(incomingMsg) - 1;
            const events = session.availableEvents;
            if (events && events[index]) { 
                session.step = 'CHURCH_PAY'; 
                session.choice = 'EVENT'; 
                session.selectedEvent = events[index]; 
                reply = `Confirm Ticket for *${events[index].name}* (R${events[index].price})?\nReply *Yes* to continue.`; 
            }
        }

        // 5. PROFILE SUB-MENUS
        else if (session.step === 'PROFILE_MENU') {
            if (incomingMsg === '1') {
                session.step = 'UPDATE_EMAIL';
                reply = "📧 Reply with your new *Email Address*:";
            } else if (incomingMsg === '2') {
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
            // OPTION 3: SWITCH CHURCH (UNLINK)
            else if (incomingMsg === '3') {
                await prisma.member.update({ where: { phone: cleanPhone }, data: { churchCode: null } });
                delete session.mode; 
                delete session.orgCode;
                reply = "🔄 You have left this church.\n\nReply *Hi* to search for a new one.";
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
        
        // CANCEL SUB LOGIC
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

    } catch (e) {  // 👈 THIS WAS MISSING
        console.error("Church Bot Error:", e);
        res.sendStatus(500);
    }
}

module.exports = { handleChurchMessage };