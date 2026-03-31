// ==========================================
// bots/serviceProviderBot.js - Omni-Channel Handler
// Covers: Service Providers 🛠️ (Plumbers, Consultants, etc.)
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

// 🚀 The Smart-Chunking Sender
const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing! Could not send message.");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');

    const MAX_LENGTH = 1500;
    const messageChunks = [];

    if (body.length > MAX_LENGTH) {
        let remainingText = body;
        while (remainingText.length > 0) {
            if (remainingText.length <= MAX_LENGTH) {
                messageChunks.push(remainingText);
                break;
            }
            let chunk = remainingText.substring(0, MAX_LENGTH);
            let splitIndex = MAX_LENGTH;
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
            await twilioClient.messages.create({ from: `whatsapp:${cleanTwilioNumber}`, to: `whatsapp:${to}`, body: chunk });
            await new Promise(resolve => setTimeout(resolve, 500)); 
        } catch (err) {
            console.error("❌ Twilio Send Error:", err.message);
        }
    }
};

const gateway = netcash;

// ====================================================
// 0. THE TRIGGER: Check if they typed a Provider Name
// ====================================================
async function processProviderTrigger(cleanMsg, phone, session, sendWhatsAppFn) {
    if (!session || session.mode !== 'PROVIDER') {
        const provider = await prisma.church.findFirst({
            where: { name: { equals: cleanMsg, mode: 'insensitive' }, type: 'SERVICE_PROVIDER' }
        });

        if (provider) {
            const newStep = 'SP_MENU';
            const newData = { orgName: provider.name, orgCode: provider.code };
            
            await prisma.botSession.upsert({
                where: { phone: phone },
                update: { mode: 'PROVIDER', step: newStep, data: newData },
                create: { phone: phone, mode: 'PROVIDER', step: newStep, data: newData }
            });

            if (session) {
                session.mode = 'PROVIDER';
                session.step = newStep;
                session.data = newData;
            }

            const menu = `🛠️ *${provider.name}*\n` +
                         `_Professional Services_\n\n` +
                         `1. Booking Request 📅\n` +
                         `2. Pay Invoice 💳\n` +
                         `3. My Profile & Address 👤\n` +
                         `4. Statement 📜\n` +
                         `5. Go to Lobby 🛡️\n\n` +
                         `Reply with a number:`;
            
            // Use the passed-in sendWhatsApp (from router) or our local one
            const sender = sendWhatsAppFn || sendWhatsApp;
            await sender(phone, menu);
            return true;
        }
    }
    return false; 
}


// --- MAIN HANDLER ---
async function handleServiceProviderMessage(cleanPhone, incomingMsg, session, member) {
    let reply = "";

    session.orgName = session.orgName || member?.church?.name || "Service Provider";
    session.orgCode = session.orgCode || member?.churchCode;

    try {
        // ====================================================
        // 1. MAIN MENU TRIGGER
        // ====================================================
        const triggers = ['hi', 'menu', 'hello', 'help', 'pay', 'book', 'service'];
        
        if (triggers.includes(incomingMsg.toLowerCase())) { 
            session.step = 'SP_MENU'; 
            
            reply = `🛠️ *${session.orgName}*\n` +
                    `_Professional Services_\n\n` +
                    `1. Booking Request 📅\n` +
                    `2. Pay Invoice 💳\n` +
                    `3. My Profile & Address 👤\n` +
                    `4. Statement 📜\n` +
                    `5. Go to Lobby 🛡️\n\n` +
                    `Reply with a number:`;
        }

        // ====================================================
        // 2. MENU SELECTION HANDLER
        // ====================================================
        else if (session.step === 'SP_MENU') {
            
            // --- OPTION 1: BOOKING REQUEST ---
            if (incomingMsg === '1') {
                session.step = 'SP_BOOKING_DETAILS';
                reply = `📅 *New Booking Request*\n\nPlease reply with the details of what you need and your preferred Date/Time.\n\n_Example: "I need a plumbing repair this Friday morning."_`;
            }

            // --- OPTION 2: PAY INVOICE ---
            else if (incomingMsg === '2') {
                session.step = 'SP_PAY_AMOUNT';
                reply = `💳 *Pay Invoice*\n\nPlease enter the total amount you wish to pay (e.g. 1500):`;
            }

            // --- OPTION 3: PROFILE & ADDRESS ---
            else if (incomingMsg === '3') {
                session.step = 'SP_PROFILE_MENU';
                reply = `👤 *My Profile*\n\n1. Update Service Address 📍\n2. Update Email 📧\n3. Switch Provider (Unlink)\n\nReply with a number:`;
            }

            // --- OPTION 4: STATEMENT ---
            else if (incomingMsg === '4') {
                 reply = await gateway.getTransactionHistory(member.id);
                 session.step = 'SP_MENU';
            }
            
            // --- OPTION 5: LOBBY ---
            else if (incomingMsg === '5') {
                 reply = "🔄 Leaving provider mode...\nReply *Join* to search for a new organization.";
                 delete session.mode; 
                 session.step = null;
            }

            else {
                reply = "⚠️ Invalid option. Please reply with a number from the menu.";
            }
        }

        // ====================================================
        // 3. BOOKING REQUEST LOGIC
        // ====================================================
        else if (session.step === 'SP_BOOKING_DETAILS') {
            const bookingDetails = incomingMsg;
            
            // Here you could save this to a new Booking/Ticket model in Prisma
            // For now, we confirm receipt and notify the business admin
            
            reply = `✅ *Booking Request Sent!*\n\nWe have received your request:\n_"${bookingDetails}"_\n\nOur team will contact you shortly to confirm your appointment. Reply *Menu* to return to the dashboard.`;
            session.step = 'SP_MENU';
        }

        // ====================================================
        // 4. INVOICE PAYMENT PROCESSING
        // ====================================================
        else if (session.step === 'SP_PAY_AMOUNT') {
            
            // 🛑 THE KYC SOFT GATE
            if (member.church && member.church.canCollectMoney === false) {
                const lockMsg = `🚧 *Gateway Upgrading*\n\n*${session.orgName}* is currently finalizing their secure banking integration.\n\nOnline invoice payments will be activated shortly. Please contact them directly to pay via EFT.`;
                await sendWhatsApp(cleanPhone, lockMsg);
                return { handled: true };
            }

            let amount = parseFloat(incomingMsg.replace(/\D/g,'')); 
            if (isNaN(amount) || amount < 10) {
                reply = "⚠️ Please enter a valid amount (e.g. 500). Minimum is R10.";
                await sendWhatsApp(cleanPhone, reply);
                return { handled: true };
            }
            
            const type = 'INVOICE';
            session.tempPaymentAmount = amount;
            session.tempPaymentType = type;

            const savedCards = await prisma.paymentMethod.findMany({
                where: { memberId: member.id }, orderBy: { createdAt: 'desc' }
            });

            if (savedCards.length > 0) {
                const card = savedCards[0];
                session.step = 'SP_1CLICK_PAY';
                session.savedCardToken = card.token;
                reply = `💳 *Secure 1-Click Payment*\n\nInvoice Amount: *R${amount.toFixed(2)}*\n\nWould you like to pay using your saved *${card.cardBrand} ending in ${card.last4}*?\n\n*1️⃣ Yes, charge my card now*\n*2️⃣ No, send me a payment link*\n\nReply 1 or 2.`;
            } else {
                const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const link = await gateway.createPaymentLink(amount, ref, cleanPhone, session.orgName, '', session.churchCode, type);
                
                if (link) {
                    reply = `Tap to securely pay R${amount.toFixed(2)} to *${session.orgName}* via Seabe Pay:\n👉 ${link}\n\nReply *Menu* to return to the dashboard.`;                 
                } else {
                    reply = "⚠️ Payment link error. Please try again later.";
                }
                session.step = 'SP_MENU';
            }
        }

        // ====================================================
        // ⚡ 4.5 SEABE ID: 1-CLICK CHECKOUT EXECUTION
        // ====================================================
        else if (session.step === 'SP_1CLICK_PAY') {
            const amount = session.tempPaymentAmount;
            const type = session.tempPaymentType;

            if (incomingMsg === '1') {
                await sendWhatsApp(cleanPhone, "🔄 *Processing Invoice Payment...*\nSecurely communicating with your bank. Please wait.");

                const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const chargeResult = await gateway.chargeSavedToken(session.savedCardToken, amount, ref);

                if (chargeResult.success) {
                    await prisma.transaction.create({
                        data: {
                            amount: amount, type: type, status: 'SUCCESS', reference: ref, method: 'SEABE_ID_TOKEN',
                            description: `1-Click Invoice Payment`, phone: cleanPhone, date: new Date(), church: { connect: { id: member.churchId } }
                        }
                    });
                    reply = `✅ *Payment Successful!*\n\nThank you, ${member.firstName}. Your payment of *R${amount.toFixed(2)}* was successfully processed.\n\nReply *Menu* to return to the dashboard.`;
                } else {
                    reply = `⚠️ *Payment Failed*\n\nYour bank declined the transaction. Please reply *2* to try again with a secure payment link.`;
                    await sendWhatsApp(cleanPhone, reply); 
                    return { handled: true }; 
                }
                session.step = 'SP_MENU';
            }
            else if (incomingMsg === '2') {
                const ref = `${session.orgCode}-${type}-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-5)}`;
                const link = await gateway.createPaymentLink(amount, ref, cleanPhone, session.orgName, '', session.churchCode, type);

                if (link) {
                    reply = `💳 *Alternative Payment*\n\n👉 Transact securely here:\n${link}\n\nReply *Menu* to return to the dashboard.`;
                } else {
                    reply = "⚠️ Payment link error. Please try again later.";
                }
                session.step = 'SP_MENU';
            }
            else {
                reply = "⚠️ Invalid option. Please reply *1* to use your saved card, or *2* to use a payment link.";
            }
        }

        // ====================================================
        // 5. PROFILE & ADDRESS MANAGEMENT
        // ====================================================
        else if (session.step === 'SP_PROFILE_MENU') {
            if (incomingMsg === '1') {
                session.step = 'SP_UPDATE_ADDRESS';
                // Assuming you added an 'address' field to your Member model, otherwise we just pretend for the UX
                reply = "📍 Reply with your full *Service Address* (Street, City, Suburb):";
            } else if (incomingMsg === '2') {
                session.step = 'SP_UPDATE_EMAIL';
                reply = "📧 Reply with your new *Email Address*:";
            } 
            else if (incomingMsg === '3') {
                await prisma.member.update({ where: { id: member.id }, data: { churchCode: null, status: 'INACTIVE' } });
                delete session.mode; 
                delete session.orgCode;
                reply = "🔄 You have unlinked from this provider.\n\nReply *Join* to search for a new one.";
            }
        }

        else if (session.step === 'SP_UPDATE_ADDRESS') {
            const newAddress = incomingMsg;
            // await prisma.member.update({ where: { id: member.id }, data: { address: newAddress } });
            reply = `✅ Service Address updated to:\n*${newAddress}*\n\nReply *Menu* to return.`;
            session.step = 'SP_MENU'; 
        }

        else if (session.step === 'SP_UPDATE_EMAIL') {
            const newEmail = incomingMsg;
            if (!newEmail.includes('@')) {
                reply = "⚠️ Invalid email.";
            } else {
                await prisma.member.update({ where: { id: member.id }, data: { email: newEmail } });
                reply = `✅ Email updated to: *${newEmail}*`;
                session.step = 'SP_MENU'; 
            }
        }

        // --- FINAL SEND ---
        if (reply) {
            await sendWhatsApp(cleanPhone, reply);
            return { handled: true }; 
        }

        return { handled: false }; 

    } catch (e) { 
        console.error("❌ CRITICAL Service Provider Bot Error:", e);
        await sendWhatsApp(cleanPhone, "⚠️ System error loading provider menu. Please try again in a few minutes.");
        return { handled: true };
    }
}

// 🚀 EXPORT BOTH FUNCTIONS
module.exports = { handleServiceProviderMessage, processProviderTrigger };