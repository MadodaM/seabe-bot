// bots/stokvelBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/twilioClient'); 
const { generatePolicyCard } = require('../services/cardGenerator'); // 👈 ADDED IMPORT

async function handleStokvelMessage(cleanPhone, incomingMsg, session, member) {
    // 🚀 We now fetch the full church object just in case it wasn't pre-loaded
    const org = await prisma.church.findUnique({ where: { code: member.churchCode } });
    const stokvelName = org?.name || "Your Savings Club";

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
                // 💰 Pay Now
                const host = process.env.HOST_URL || 'https://seabe.tech';
                const paymentLink = `${host}/pay?memberId=${member.id}&code=${member.churchCode}`; 
                await sendWhatsApp(cleanPhone, `💳 *Make a Contribution*\n\nClick below to securely transfer funds to ${stokvelName}:\n👉 ${paymentLink}\n\nReply *Menu* to go back.`);
                break;
                
            case '2':
                // 👤 My Profile
                await sendWhatsApp(cleanPhone, `👤 *My Profile*\n\n*Name:* ${member.firstName || 'Not Set'} ${member.lastName || ''}\n*Phone:* ${member.phone}\n*ID:* ${member.idNumber ? 'Stored Securely 🔒' : 'Not Provided'}\n*Status:* ${member.status}\n\nReply *Menu* to go back.`);
                break;
                
            case '3':
                // 🛡️ KYC Status (Ties directly into our Gemini Vision AI!)
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
                // 🪪 My Stokvel Card (Now powered by Cloudinary & Canvas!)
                await sendWhatsApp(cleanPhone, `🎨 Generating your Digital ID Card... Please wait a moment.`);
                
                try {
                    // Call the generator
                    const cardUrl = await generatePolicyCard(member, org);
                    
                    if (cardUrl) {
                        // If it worked, we send it as a Media Message via Twilio
                        const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
                        const botPhone = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                        
                        await twilioClient.messages.create({
                            from: `whatsapp:${botPhone}`,
                            to: `whatsapp:${member.phone}`,
                            body: `🪪 *Here is your official Digital ID Card for ${stokvelName}.*\n\nYou can save this image to your phone or present the QR code at events for quick verification.\n\nReply *Menu* to go back.`,
                            mediaUrl: [cardUrl] // 👈 Boom! Image attachment!
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
                    where: { 
                        phone: member.phone, 
                        churchCode: member.churchCode, 
                        status: 'SUCCESS' 
                    },
                    _sum: { amount: true }
                });
                
                const total = txs._sum.amount || 0;
                await sendWhatsApp(cleanPhone, `💰 *Contribution Summary*\n\nYour total approved savings/contributions to ${stokvelName} amount to:\n\n⭐ *R ${total.toFixed(2)}*\n\nKeep up the great saving habit! 📈\n\nReply *Menu* to go back.`);
                break;
                
            default:
                await sendWhatsApp(cleanPhone, `⚠️ Invalid selection. Please reply with a number from 1 to 5, or type *Menu*.`);
        }
    }
}

module.exports = { handleStokvelMessage };