// bots/stokvelBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/twilioClient'); 
const { generatePolicyCard } = require('../services/cardGenerator'); 
const { chargeSavedToken, createPaymentLink } = require('../services/netcash'); // 🚀 NEW
const { calculateTransaction } = require('../services/pricingEngine'); // 🚀 NEW

async function handleStokvelMessage(cleanPhone, incomingMsg, session, member) {
    const org = await prisma.church.findUnique({ where: { code: member.churchCode } });
    const stokvelName = org?.name || "Your Savings Club";
    const orgCode = member.churchCode;

    // 1. Trigger the Main Menu
    if (incomingMsg.toLowerCase() === 'stokvel' || incomingMsg.toLowerCase() === 'menu') {
        session.step = 'STOKVEL_MENU';
        const msg = `👋 *Welcome to ${stokvelName}*\n\n` +
                    `*Main Menu:*\n` +
                    `1️⃣ Pay Now (Contributions)\n` +
                    `2️⃣ My Profile\n` +
                    `3️⃣ KYC Status\n` +
                    `4️⃣ My Stokvel Card\n` +
                    `5️⃣ Total Contributions\n\n` +
                    `👇 _Reply with a number to proceed_`;
        await sendWhatsApp(cleanPhone, msg);
        return;
    }

    // 2. Handle Menu Selections
    if (session.step === 'STOKVEL_MENU') {
        switch(incomingMsg) {
            case '1':
                // 💰 Pay Now - Ask for Amount First
                session.step = 'STOKVEL_PAYMENT_AMOUNT';
                await sendWhatsApp(cleanPhone, `💳 *Make a Contribution*\n\nPlease reply with the amount you wish to save/contribute today (e.g., 500):`);
                break;
                
            case '2':
                // 👤 My Profile
                await sendWhatsApp(cleanPhone, `👤 *My Profile*\n\n*Name:* ${member.firstName || 'Not Set'} ${member.lastName || ''}\n*Phone:* ${member.phone}\n*ID:* ${member.idNumber ? 'Stored Securely 🔒' : 'Not Provided'}\n*Status:* ${member.status}\n\nReply *Menu* to go back.`);
                break;
                
            case '3':
                // 🛡️ KYC Status
                let kycMsg = `🛡️ *KYC Compliance Status*\n\nCurrent Status: *${member.kycStatus || 'UNVERIFIED'}*\n\n`;
                if (member.kycStatus === 'UNVERIFIED' || member.kycStatus === 'REJECTED') {
                    kycMsg += `⚠️ Your account is restricted.\n\nTo verify your identity, please reply directly to this message with a clear photo of your *ID Document* (Green book or Smart Card).`;
                    session.step = 'AWAITING_MEMBER_ID'; 
                } else if (member.kycStatus === 'PENDING') {
                    kycMsg += `⏳ Your documents are currently under review by the Club Admin. We will notify you once approved.\n\nReply *Menu* to go back.`;
                } else {
                    kycMsg += `✅ Your account is fully verified and compliant!\n\nReply *Menu* to go back.`;
                }
                await sendWhatsApp(cleanPhone, kycMsg);
                break;
                
            case '4':
                // 🪪 My Stokvel Card 
                await sendWhatsApp(cleanPhone, `🎨 Generating your Digital ID Card... Please wait a moment.`);
                try {
                    const cardUrl = await generatePolicyCard(member, org);
                    if (cardUrl) {
                        const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
                        const botPhone = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                        await twilioClient.messages.create({
                            from: `whatsapp:${botPhone}`,
                            to: `whatsapp:${member.phone}`,
                            body: `🪪 *Here is your official Digital ID Card for ${stokvelName}.*\n\nYou can save this image to your phone or present the QR code at events for quick verification.\n\nReply *Menu* to go back.`,
                            mediaUrl: [cardUrl] 
                        });
                    } else {
                        await sendWhatsApp(cleanPhone, `⚠️ Sorry, we encountered an error generating your card. Please try again later.\n\nReply *Menu* to go back.`);
                    }
                } catch (error) {
                    console.error("Card Generation Error:", error);
                    await sendWhatsApp(cleanPhone, `⚠️ System error generating card.\n\nReply *Menu* to go back.`);
                }
                break;
                
            case '5':
                // 📈 Total Contributions
                const txs = await prisma.transaction.aggregate({
                    where: { phone: member.phone, churchCode: member.churchCode, status: 'SUCCESS' },
                    _sum: { amount: true }
                });
                const total = txs._sum.amount || 0;
                await sendWhatsApp(cleanPhone, `💰 *Contribution Summary*\n\nYour total approved savings/contributions to ${stokvelName} amount to:\n\n⭐ *R ${total.toFixed(2)}*\n\nKeep up the great saving habit! 📈\n\nReply *Menu* to go back.`);
                break;
                
            default:
                await sendWhatsApp(cleanPhone, `⚠️ Invalid selection. Please reply with a number from 1 to 5, or type *Menu*.`);
        }
        return;
    }

    // ==========================================
    // 💳 SEABE ID: STOKVEL CHECKOUT FLOW
    // ==========================================
    if (session.step === 'STOKVEL_PAYMENT_AMOUNT') {
        const amount = parseFloat(incomingMsg.replace(/\D/g, ''));
        if (isNaN(amount) || amount < 10) {
            await sendWhatsApp(cleanPhone, "⚠️ Invalid amount. Please enter a minimum of R10 (e.g., '100').");
            return;
        }

        session.tempPaymentAmount = amount;

        // 🔍 Check for Seabe ID Saved Cards
        const savedCards = await prisma.paymentMethod.findMany({ 
            where: { memberId: member.id }, orderBy: { createdAt: 'desc' }
        });

        if (savedCards.length > 0) {
            const card = savedCards[0];
            session.step = 'STOKVEL_1CLICK_PAY';
            session.savedCardToken = card.token;
            await sendWhatsApp(cleanPhone, `💳 *Secure 1-Click Checkout*\n\nContribution: *R${amount.toFixed(2)}*\n\nWould you like to pay using your saved *${card.cardBrand} ending in ${card.last4}*?\n\n*1️⃣ Yes, charge my card now*\n*2️⃣ No, send me a payment link*\n\nReply 1 or 2.`);
        } else {
            // Generate standard payment link
            const pricing = await calculateTransaction(amount, 'STANDARD', 'DEFAULT', true);
            const ref = `${orgCode}-ONCEOFF-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-4)}`;
            const link = await createPaymentLink(pricing.totalChargedToUser, ref, cleanPhone, stokvelName);
            
            session.step = 'STOKVEL_MENU';
            await sendWhatsApp(cleanPhone, `💳 *Contribution Payment*\n\nAmount: R${pricing.baseAmount.toFixed(2)}\nService Fee: R${pricing.totalFees.toFixed(2)}\n*Total: R${pricing.totalChargedToUser.toFixed(2)}*\n\n👉 Pay securely here:\n${link}\n\nReply *Menu* to go back.`);
        }
        return;
    }

    if (session.step === 'STOKVEL_1CLICK_PAY') {
        const amount = session.tempPaymentAmount;

        if (incomingMsg === '1') {
            await sendWhatsApp(cleanPhone, "🔄 *Processing Contribution...*\nSecurely communicating with your bank. Please wait.");
            const ref = `${orgCode}-ONCEOFF-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-4)}`;
            const chargeResult = await chargeSavedToken(session.savedCardToken, amount, ref);

            if (chargeResult.success) {
                // Log the transaction
                await prisma.transaction.create({
                    data: {
                        amount: amount, type: 'CONTRIBUTION', status: 'SUCCESS',
                        reference: ref, method: 'SEABE_ID_TOKEN', description: 'Stokvel Contribution via 1-Click',
                        phone: cleanPhone, date: new Date(), church: { connect: { id: org.id } }
                    }
                });
                await sendWhatsApp(cleanPhone, `✅ *Contribution Successful!*\n\nThank you, ${member.firstName}. We have successfully added *R${amount.toFixed(2)}* to your savings using your saved card.\n\nReply *Menu* to return to your dashboard.`);
            } else {
                await sendWhatsApp(cleanPhone, `⚠️ *Payment Failed*\n\nYour bank declined the transaction. Please check your funds or use a different method.\n\nReply *1* in the main menu to try again.`);
            }
        } 
        else if (incomingMsg === '2') {
            const pricing = await calculateTransaction(amount, 'STANDARD', 'DEFAULT', true);
            const ref = `${orgCode}-ONCEOFF-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-4)}`;
            const link = await createPaymentLink(pricing.totalChargedToUser, ref, cleanPhone, stokvelName);
            await sendWhatsApp(cleanPhone, `💳 *Alternative Payment*\n\n👉 Pay securely here:\n${link}\n\nReply *Menu* to go back.`);
        } 
        else {
            await sendWhatsApp(cleanPhone, "⚠️ Invalid option. Please reply *1* to use your saved card, or *2* for a payment link.");
            return;
        }
        session.step = 'STOKVEL_MENU';
        return;
    }
}

module.exports = { handleStokvelMessage };