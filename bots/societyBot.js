// ==========================================
// bots/societyBot.js - Burial Society Logic Handler
// ==========================================
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); 
const ozow = require('../services/ozow'); 
const netcash = require('../services/netcash');

// Safely initialize Twilio for direct background messaging
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

const sendWhatsApp = async (to, body) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing!");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    try {
        await twilioClient.messages.create({
            from: `whatsapp:${cleanTwilioNumber}`,
            to: `whatsapp:${to}`,
            body: body
        });
        console.log(`✅ Society text delivered to ${to}`);
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

// Toggle check
const ACTIVE_GATEWAY_NAME = process.env.ACTIVE_GATEWAY || 'OZOW'; 
const gateway = ACTIVE_GATEWAY_NAME === 'NETCASH' ? netcash : ozow;

// Notice the clean parameters: cleanPhone, incomingMsg, session, member
async function handleSocietyMessage(cleanPhone, incomingMsg, session, member) {
    let reply = "";

    // Ensure session properties exist so we don't crash
    session.orgName = session.orgName || member?.society?.name || "Burial Society";
    session.orgCode = session.orgCode || member?.societyCode;

    try {
        // 1. MENU TRIGGER
        if (['society', 'menu'].includes(incomingMsg.toLowerCase()) || session.step === 'START') {
            session.step = 'SOCIETY_MENU';
            reply = `🛡️ *${session.orgName}*\n_Burial Society Portal_\n\n` +
                    `1. My Policy 📜\n` +
                    `2. My Dependents 👨‍👩‍👧‍👦\n` +
                    `3. KYC Compliance 🏦\n` +
                    `4. Digital Card 🪪\n` +
                    `5. Pay Premium 💳\n` +
                    `6. Log a Death Claim 📑\n` +
                    `7. Exit to Lobby ⛪\n\n` +
                    `Reply with a number:`;
        }

        // 2. MAIN MENU NAVIGATION
        else if (session.step === 'SOCIETY_MENU') {
            
            // OPTION 1: POLICY STATUS
            if (incomingMsg === '1') {
                if (!member) {
                    reply = "⚠️ Policy not found. Please contact support.";
                } else {
                    const statusEmoji = member.status === 'ACTIVE' ? '✅' : '⚠️';
                    reply = `📜 *Policy Status*\n\nPolicy No: ${member.policyNumber || 'N/A'}\nStatus: ${member.status || 'INACTIVE'} ${statusEmoji}\nJoined: ${member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : 'N/A'}\n\nReply *0* to go back.`;
                }
            }

            // OPTION 2: VIEW DEPENDENTS
            else if (incomingMsg === '2') {
                const dependents = await prisma.dependent.findMany({ where: { member: { phone: cleanPhone } } });
                if (dependents.length === 0) {
                    reply = `👨‍👩‍👧‍👦 *My Dependents*\n\nNo dependents linked.\nReply *Add* to add one.`;
                } else {
                    reply = `👨‍👩‍👧‍👦 *Dependents (${dependents.length})*\n` + dependents.map(d => `- ${d.firstName} (${d.relation})`).join('\n') + `\n\nReply *Add* to add more or *0* to back.`;
                }
                session.step = 'DEPENDENT_VIEW';
            }

            // OPTION 3: KYC COMPLIANCE
            else if (incomingMsg === '3') {
                onst host = process.env.HOST_URL || 'seabe-bot-test.onrender.com';
    
				// ✨ This creates the unique token in the DB and returns the full URL
				const link = await generateKYCLink(cleanPhone, host);
				
				reply = `👤 *KYC Compliance*\n\nPlease verify your identity using this secure link (valid for 24h):\n\n👉 ${link}`;
}
            }

            // OPTION 5: PREMIUM PAYMENT
            else if (incomingMsg === '5') {
                if (!member) {
                    reply = "⚠️ Member record not found.";
                } else {
                    const amount = member.monthlyPremium || member.society?.defaultPremium || 150.00;
                    const ref = `${session.orgCode}-PREM-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-4)}`;
                    const link = await gateway.createPaymentLink(amount, ref, cleanPhone, session.orgName);
                    
                    if (link) {
                        await prisma.transaction.create({
                            data: { churchCode: session.orgCode, phone: cleanPhone, amount: parseFloat(amount), reference: ref, status: 'PENDING', type: 'SOCIETY_PREMIUM', date: new Date() }
                        });
                        reply = `💳 *Pay Premium via ${ACTIVE_GATEWAY_NAME}*\nDue: R${amount}.00\n\n👉 ${link}`;
                    } else {
                        reply = "⚠️ Payment link error.";
                    }
                }
            }

            // OPTION 6: LOG A DEATH CLAIM
            else if (incomingMsg === '6') {
                session.step = 'AWAITING_CLAIM_DOCUMENT';
                reply = `📑 *Log a Death Claim*\n\nPlease upload a clear photo of the *Death Certificate* or *DHA-1663 Notification*.\n\nOur AI will process the details instantly.`;
            }

            // OPTION 7: EXIT
            else if (incomingMsg === '7') {
                // Return to the router and force it to handle church logic next
                session.mode = 'CHURCH';
                session.step = 'CHURCH_MENU';
                reply = "⛪ *Switching back to Church Mode...*\n\nReply *Menu* to see your options.";
            }

            else {
                reply = "⚠️ Invalid option. Please reply with a number from the menu.";
            }
        }

        // 3. DEPENDENT LOGIC
        else if (session.step === 'DEPENDENT_VIEW' && incomingMsg.toLowerCase() === 'add') {
            reply = "📝 Type Dependent's First Name:";
            session.step = 'ADD_DEP_NAME';
        }
        else if (session.step === 'ADD_DEP_NAME') {
            session.tempDep = { name: incomingMsg };
            reply = "Type Relation (e.g. Spouse, Child, Parent):";
            session.step = 'ADD_DEP_RELATION';
        }
        else if (session.step === 'ADD_DEP_RELATION') {
            if (member) {
                await prisma.dependent.create({
                    data: { firstName: session.tempDep.name, lastName: member.lastName, relation: incomingMsg, memberId: member.id }
                });
                reply = `✅ Added ${session.tempDep.name}.\nReply *2* to view list or *Menu* for main menu.`;
                session.step = 'SOCIETY_MENU';
            } else {
                reply = "⚠️ Member record not found.";
            }
        }

        // 4. CLAIM UPLOAD LOGIC
        else if (session.step === 'AWAITING_CLAIM_DOCUMENT') {
            // Because we no longer have access to req.body.NumMedia directly in this background function,
            // we will gently redirect them to the AI support bot for claim processing.
            // (You can wire this back up to the router later if you want true multi-media support!)
            reply = "⏳ *Document Upload*\n\nTo submit a claim document, please reply directly to the AI Support bot with the image attached, or contact your society administrator.";
            session.step = 'SOCIETY_MENU'; 
        }

        // --- FINAL SEND ---
        if (reply) {
            await sendWhatsApp(cleanPhone, reply);
        }

    } catch (e) {
        console.error("❌ Society Bot Error:", e.message);
        await sendWhatsApp(cleanPhone, "⚠️ System error loading society menu.");
    }
}

module.exports = { handleSocietyMessage };