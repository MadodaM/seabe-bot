// bots/lwaziBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateTransaction } = require('../services/pricingEngine');
const { processLmsMessage } = require('./LMSlogicBot'); 

// 🚀 THE SLEDGEHAMMER FIX: Isolate Lwazi's Twilio Connection!
const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
const LWAZI_NUMBER = 'whatsapp:+27875511057'; // Force the Lwazi number

// 📬 Dedicated Lwazi Sender (Includes smart chunking)
const sendLwazi = async (to, body, mediaUrl = null) => {
    if (!process.env.TWILIO_SID) return console.log("⚠️ Twilio Keys Missing!");
    
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace('+', '')}`;
    const MAX_LENGTH = 1500;
    const messageChunks = [];

    if (body.length > MAX_LENGTH) {
        let remainingText = body;
        while (remainingText.length > 0) {
            if (remainingText.length <= MAX_LENGTH) {
                messageChunks.push(remainingText);
                break;
            }
            let splitIndex = MAX_LENGTH;
            let chunk = remainingText.substring(0, MAX_LENGTH);
            let lastDoubleNewline = chunk.lastIndexOf('\n\n');
            let lastNewline = chunk.lastIndexOf('\n');
            let lastSpace = chunk.lastIndexOf(' ');

            if (lastDoubleNewline > MAX_LENGTH - 300) splitIndex = lastDoubleNewline; 
            else if (lastNewline > MAX_LENGTH - 200) splitIndex = lastNewline;       
            else if (lastSpace > MAX_LENGTH - 100) splitIndex = lastSpace;         

            messageChunks.push(remainingText.substring(0, splitIndex).trim());
            remainingText = remainingText.substring(splitIndex).trim();
        }
    } else {
        messageChunks.push(body);
    }

    for (const chunk of messageChunks) {
        try {
            const options = { from: LWAZI_NUMBER, to: formattedTo, body: chunk };
            if (mediaUrl) options.mediaUrl = [mediaUrl];
            await twilioClient.messages.create(options);
            await new Promise(res => setTimeout(res, 500));
        } catch (e) { 
            console.error("❌ Lwazi Send Error:", e.message); 
        }
    }
};

// Notice we just ignore the global sendWhatsApp parameter now!
async function processLwaziMessage(phone, msg, session, mediaUrl, _ignoredGlobalSender) {
    
    // 1. Fetch or Create the Payer User
    let member = await prisma.member.findFirst({
        where: { phone: phone, churchCode: 'LWAZI_HQ' },
        include: { church: true } // 🧠 THE FIX: Attach the Org data so the LMS bot can see it!
    });

    if (!member) {
        let lwaziOrg = await prisma.church.findUnique({ where: { code: 'LWAZI_HQ' } });
        if (!lwaziOrg) {
            lwaziOrg = await prisma.church.create({
                data: { name: 'Lwazi Caps Tutor', code: 'LWAZI_HQ', type: 'ACADEMY', accountStatus: 'ACTIVE' }
            });
        }
        member = await prisma.member.create({
            data: { phone: phone, firstName: 'Student', lastName: '.', churchId: lwaziOrg.id, status: 'PENDING_SUBSCRIPTION' },
            include: { church: true } // 🧠 THE FIX: Attach the Org data here too!
        });
    }

    // ================================================
    // 🛒 NOMINATION & CHECKOUT FLOW
    // ================================================
    if (msg === 'subscribe' || msg === 'buy') {
        session.step = 'LWAZI_CHOOSE_PLAN';
        session.nominatedNumbers = [];
        await sendLwazi(phone, "📚 *Lwazi Premium Subscription*\n\nWho will be using this subscription?\n\n1️⃣ *Myself*\n2️⃣ *Nominate Students* (Add up to 5 numbers. The 4th and 5th students get a 5% discount!)\n\n_Reply 1 or 2_");
        return;
    }

    if (session.step === 'LWAZI_CHOOSE_PLAN') {
        if (msg === '1') {
            session.nominatedNumbers = [phone];
            return await generateLwaziCheckout(phone, member, session, sendLwazi);
        } else if (msg === '2') {
            session.step = 'LWAZI_COLLECT_NUMBERS';
            await sendLwazi(phone, "📱 Please reply with the *WhatsApp number* of the first student (e.g., 0821234567):");
            return;
        } else {
            await sendLwazi(phone, "⚠️ Please reply with 1 or 2.");
            return;
        }
    }

    if (session.step === 'LWAZI_COLLECT_NUMBERS') {
        let targetPhone = msg.replace(/\D/g, ''); 
        if (targetPhone.startsWith('0')) targetPhone = '27' + targetPhone.substring(1);
        
        if (targetPhone.length < 10) {
             await sendLwazi(phone, "⚠️ Invalid number. Please enter a valid South African mobile number (e.g., 0821234567).");
             return;
        }

        if (!session.nominatedNumbers) session.nominatedNumbers = [];
        if (!session.nominatedNumbers.includes(targetPhone)) {
             session.nominatedNumbers.push(targetPhone);
        }

        if (session.nominatedNumbers.length >= 5) {
             await sendLwazi(phone, "✅ Maximum of 5 students reached! Generating your checkout link...");
             return await generateLwaziCheckout(phone, member, session, sendLwazi);
        } else {
             session.step = 'LWAZI_MORE_NUMBERS';
             await sendLwazi(phone, `✅ Added +${targetPhone}.\n\nYou have added ${session.nominatedNumbers.length}/5 students.\n\nReply *1* to add another student.\nReply *2* to proceed to checkout.`);
             return;
        }
    }

    if (session.step === 'LWAZI_MORE_NUMBERS') {
        if (msg === '1') {
             session.step = 'LWAZI_COLLECT_NUMBERS';
             await sendLwazi(phone, "📱 Please reply with the *WhatsApp number* of the next student:");
        } else if (msg === '2') {
             return await generateLwaziCheckout(phone, member, session, sendLwazi);
        } else {
             await sendLwazi(phone, "⚠️ Please reply with 1 or 2.");
        }
        return;
    }

    // ================================================
    // 🛑 THE UNSUBSCRIBE TRAPDOOR (Must be ABOVE the Paywall!)
    // ================================================
    if (msg === 'cancel' || msg === 'unsubscribe' || msg === 'stop billing') {
        session.step = 'CONFIRM_CANCEL';
        await sendLwazi(phone, "⚠️ *Cancel Subscription*\n\nAre you sure you want to cancel your Lwazi Premium subscription? You will lose access to the AI Tutor and daily quizzes immediately.\n\nReply *YES* to confirm cancellation, or *NO* to keep learning.");
        return;
    }

    if (session.step === 'CONFIRM_CANCEL') {
        if (msg === 'yes') {
            await prisma.member.update({ where: { id: member.id }, data: { status: 'CANCELED' } });
            await prisma.paymentMethod.updateMany({ where: { memberId: member.id }, data: { isDefault: false } });

            session.step = null;
            await sendLwazi(phone, "🛑 *Subscription Canceled*\n\nYour automatic billing has been securely stopped, and your card has been unlinked. We are sorry to see you go!\n\nIf you ever want to return, just reply *Subscribe*.");
            return;
        } else if (msg === 'no') {
            session.step = null;
            await sendLwazi(phone, "✅ Cancellation aborted. We are glad you're staying! Reply *Menu* to continue learning.");
            return;
        }
    }

    // ================================================
    // 🛡️ THE PREMIUM PAYWALL GATEKEEPER
    // ================================================
    // 🧠 FIX: ANY user who is not active gets stopped here, even if they just said "Hi" for the first time!
    if (member.status !== 'ACTIVE') {
        const paywallMsg = `🦉 *Welcome to Lwazi Caps Micro-Tutor!*\n\n` +
                           `Unlock your full academic potential with Lwazi Premium! From *R69/month* (plus secure gateway fees), you get:\n\n` +
                           `🧠 *Unlimited AI Tutor:* 24/7 help with Math, Science, and more.\n` +
                           `📚 *CAPS-Aligned Courses:* Step-by-step daily lessons.\n` +
                           `📝 *Smart Quizzes:* Instant grading and feedback.\n` +
                           `👨‍👩‍👧‍👦 *Family Plan:* Discounts when adding multiple students.\n\n` +
                           `_Reply *Subscribe* to activate your account and start learning today!_`;
        
        await sendLwazi(phone, paywallMsg);
        return;
    }

    // ================================================
    // 🎓 MAIN MENU & LMS ROUTING (Active Members Only)
    // ================================================
    if (msg === 'menu' || msg === 'hi') {
        await sendLwazi(phone, "🦉 *Lwazi Main Menu*\n\n1️⃣ *Courses* - Browse CAPS subjects by Grade\n2️⃣ *Tutor* - Send a photo of a math problem for AI help\n3️⃣ *Profile* - View your progress\n4️⃣ *Subscribe* - Manage Family Plan\n\n_Reply with a word above._");
        return;
    }

    // Pass everything else to the AI Tutor
    const lmsResult = await processLmsMessage(phone, msg, session, member, mediaUrl, sendLwazi);
    if (!lmsResult.handled) {
        await sendLwazi(phone, "I didn't quite catch that. Reply *Menu*, *Courses*, or *Tutor*.");
    }
}

/**
 * 🧮 Dynamic Checkout Generator (Option 2: Fully-Loaded Price Display)
 */
async function generateLwaziCheckout(payerPhone, payerMember, session, sendLwazi) {
    let totalBaseCost = 0;
    let targetIds = [];

    // 1. Do the math silently in the background first
    for (let i = 0; i < session.nominatedNumbers.length; i++) {
        const num = session.nominatedNumbers[i];
        let cost = 69.00;
        if (i === 3 || i === 4) cost = 69.00 * 0.95; // 5% discount
        totalBaseCost += cost;

        let student = await prisma.member.findFirst({ where: { phone: num, churchCode: 'LWAZI_HQ' } });
        if (!student) {
            let lwaziOrg = await prisma.church.findUnique({ where: { code: 'LWAZI_HQ' } });
            student = await prisma.member.create({
                 data: { phone: num, firstName: 'Lwazi', lastName: 'Student', churchId: lwaziOrg.id, status: 'PENDING_SUBSCRIPTION', parentId: payerMember.id }
            });
        }
        targetIds.push(student.id);
    }

    // 2. Calculate the FINAL price including the gateway service fees
    const pricing = await calculateTransaction(totalBaseCost, 'LWAZI_SUB', 'CARD', true);
    
    // 3. Build a clean, single-price message for the user
    let breakdownMsg = "🛒 *Subscription Summary*\n\n";
    breakdownMsg += `👨‍👩‍👧‍👦 Total Students: ${session.nominatedNumbers.length}\n`;
    if (session.nominatedNumbers.length >= 4) breakdownMsg += `_Includes Family Discount for students 4 & 5!_\n`;
    
    // Only show them the fully loaded final cost
    breakdownMsg += `\n*Total Monthly Subscription: R${pricing.totalChargedToUser.toFixed(2)}*\n`;
    breakdownMsg += `_(Includes secure Netcash gateway & network fees)_\n\n`;

    const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
    const idsParam = targetIds.join(',');
    const payLink = `${host}/pay?targetIds=${idsParam}&payerId=${payerMember.id}&amount=${pricing.totalChargedToUser}&type=LWAZI_MULTI&setupToken=true`;

    breakdownMsg += `💳 *Tap to securely activate subscriptions:*\n👉 ${payLink}\n\n`;
    breakdownMsg += `_Students will receive a welcome message instantly upon payment._`;

    await sendLwazi(payerPhone, breakdownMsg);
    
    session.step = null; 
    session.nominatedNumbers = [];
}

module.exports = { processLwaziMessage };