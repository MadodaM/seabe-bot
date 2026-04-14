const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateTransaction } = require('../services/pricingEngine');
const { processLmsMessage } = require('./LMSlogicBot'); 

// 🚀 Explicitly define the Lwazi Sender ID
const LWAZI_NUMBER = 'whatsapp:+27875511057';

async function processLwaziMessage(phone, msg, mediaUrl, sendWhatsApp) {
    // Helper function to force all Lwazi messages through the correct number
    const sendLwazi = async (to, body, media = null) => {
        return await sendWhatsApp(to, body, media, LWAZI_NUMBER);
    };

    // 1. Fetch or Create the Lwazi User
    let member = await prisma.member.findFirst({
        where: { phone: phone, churchCode: 'LWAZI_HQ' }
    });

    if (!member) {
        let lwaziOrg = await prisma.church.findUnique({ where: { code: 'LWAZI_HQ' } });
        if (!lwaziOrg) {
            lwaziOrg = await prisma.church.create({
                data: { name: 'Lwazi Caps Tutor', code: 'LWAZI_HQ', type: 'ACADEMY', accountStatus: 'ACTIVE' }
            });
        }

        member = await prisma.member.create({
            data: { phone: phone, firstName: 'Student', lastName: '.', churchId: lwaziOrg.id, status: 'PENDING_SUBSCRIPTION' }
        });
        
        await sendLwazi(phone, "🦉 *Welcome to Lwazi Caps Micro-Tutor!*\n\nYour pocket-sized, CAPS-aligned AI tutor for Grades 4-12.\n\nTo unlock daily quizzes, step-by-step math breakdowns, and past papers, subscribe for just *R69/month*.\n\nReply *Subscribe* to get your secure payment link.");
        return;
    }

    // 2. Handle Subscription & Pricing Engine
    if (msg === 'subscribe' || member.status === 'PENDING_SUBSCRIPTION') {
        const pricing = await calculateTransaction(69.00, 'LWAZI_SUB', 'CARD', false);
        const host = process.env.HOST_URL || 'https://seabe.tech';
        
        const payLink = `${host}/pay?memberId=${member.id}&amount=${pricing.totalChargedToUser}&type=LWAZI&setupToken=true`;

        await sendLwazi(phone, `📚 *Lwazi Premium Subscription*\n\nMonthly Fee: R${pricing.totalChargedToUser.toFixed(2)}\n\n💳 *Tap to securely link your card:*\n👉 ${payLink}\n\nYour card will be charged R69 today, and automatically every 30 days. You can cancel at any time.`);
        return;
    }

    // 3. Subscription Gatekeeper
    if (member.status !== 'ACTIVE') {
        await sendLwazi(phone, "⚠️ Your Lwazi subscription is inactive. Reply *Subscribe* to restore access.");
        return;
    }

    // 4. Lwazi Main Menu
    if (msg === 'menu' || msg === 'hi') {
        await sendLwazi(phone, "🦉 *Lwazi Main Menu*\n\n1️⃣ *Courses* - Browse CAPS subjects by Grade\n2️⃣ *Tutor* - Send a photo of a math problem for AI help\n3️⃣ *Profile* - View your progress\n\n_Reply with a word above._");
        return;
    }

    // 5. 🚀 THE MAGIC: Pass everything else into the existing AI Tutor!
    const dummySession = { step: null }; 
    
    // We override the sendWhatsApp function inside processLmsMessage by wrapping it
    const lmsResult = await processLmsMessage(phone, msg, dummySession, member, mediaUrl, sendLwazi);

    if (!lmsResult.handled) {
        await sendLwazi(phone, "I didn't quite catch that. Reply *Menu*, *Courses*, or *Tutor*.");
    }
}

module.exports = { processLwaziMessage };