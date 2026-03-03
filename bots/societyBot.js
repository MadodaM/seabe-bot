// ==========================================
// bots/societyBot.js - Burial Society Logic Handler
// ==========================================
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); 
const netcash = require('../services/netcash');
const { generateKYCLink } = require('../routes/kyc');

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

// 🚀 FIX: Forced Netcash exclusively. Removed the undefined 'ozow' variable.
const gateway = netcash;

async function handleSocietyMessage(cleanPhone, incomingMsg, session, member) {
    let reply = "";
    // Check both relation types depending on how they joined
    const orgName = session.orgName || (member?.church ? member.church.name : (member?.society ? member.society.name : "Burial Society"));
    const orgCode = session.orgCode || member?.churchCode || member?.societyCode;

    try {
        // 1. MENU TRIGGER
        const societyTriggers = ['society', 'Policy', 'funeral', 'palour'];
        if (societyTriggers.includes(incomingMsg.toLowerCase()) && session.step !== 'ADD_DEP_NAME' && session.step !== 'ADD_DEP_RELATION' && session.step !== 'PROFILE_MENU' && session.step !== 'UPDATE_NAME' && session.step !== 'UPDATE_EMAIL' && session.step !== 'CONFIRM_UNLINK') {
            session.step = 'SOCIETY_MENU';
            reply = `🛡️ *${orgName}*\n_Burial Society Portal_\n\n` +
                    `1. My Policy 📜\n` +
                    `2. My Dependents 👨‍👩‍👧‍👦\n` +
                    `3. KYC Compliance 🏦\n` +
                    `4. Digital Card 🪪\n` +
                    `5. Pay Premium 💳\n` +
                    `6. Log a Death Claim 📑\n` +
                    `7. My Profile 👤\n` +
                    `8. Exit to Lobby ⛪\n\n` +
                    `Reply with a number:`;
        }

        // 2. MAIN MENU NAVIGATION
        else if (session.step === 'SOCIETY_MENU') {
            
            // OPTION 1: POLICY STATUS
            if (incomingMsg === '1') {
                const statusEmoji = member?.status === 'ACTIVE' ? '✅' : '⚠️';
                reply = `📜 *Policy Status*\n\nPolicy No: ${member?.policyNumber || 'N/A'}\nStatus: ${member?.status || 'INACTIVE'} ${statusEmoji}\nJoined: ${member?.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : 'N/A'}\n\nReply *0* to go back.`;
            }

            // OPTION 2: VIEW DEPENDENTS
            else if (incomingMsg === '2') {
                // 🚀 FIX: Find dependents specifically for this member ID, not just the phone number!
                const dependents = await prisma.dependent.findMany({ where: { memberId: member.id } });
                if (dependents.length === 0) {
                    reply = `👨‍👩‍👧‍👦 *My Dependents*\n\nNo dependents linked.\nReply *Add* to add one.`;
                } else {
                    reply = `👨‍👩‍👧‍👦 *Dependents (${dependents.length})*\n` + dependents.map(d => `- ${d.firstName} (${d.relation})`).join('\n') + `\n\nReply *Add* to add more or *0* to back.`;
                }
                session.step = 'DEPENDENT_VIEW';
            }

            // OPTION 3: KYC COMPLIANCE
            else if (incomingMsg === '3') {
                const host = process.env.HOST_URL || 'seabe-bot-test.onrender.com';
                const link = await generateKYCLink(cleanPhone, host);
                reply = `👤 *KYC Compliance*\n\nPlease verify your identity to ensure your policy remains active (Valid for 24 hours):\n\n👉 ${link}`;
            }

            // OPTION 4: DIGITAL MEMBER CARD 🪪
            else if (incomingMsg === '4') {
                const statusEmoji = member?.status === 'ACTIVE' ? '✅' : '🔴';
                const memberSince = member?.joinedAt ? new Date(member.joinedAt).getFullYear() : '2024';
                
                reply = `🪪 *DIGITAL MEMBERSHIP CARD*\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🏛️ *${orgName}*\n` +
                        `👤 *Name:* ${member?.firstName || 'Member'} ${member?.lastName || ''}\n` +
                        `🆔 *Policy:* ${member?.policyNumber || 'SB-' + cleanPhone.slice(-4)}\n` +
                        `📅 *Member Since:* ${memberSince}\n` +
                        `💳 *Status:* ${member?.status || 'ACTIVE'} ${statusEmoji}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `_Show this card to service providers for verification._\n\n` +
                        `Reply *0* to go back.`;
            }

            // OPTION 5: PREMIUM PAYMENT
            else if (incomingMsg === '5') {
                const amount = member?.monthlyPremium || 150.00;
                const ref = `${orgCode}-PREM-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-4)}`;
                const link = await gateway.createPaymentLink(amount, ref, cleanPhone, orgName);
                
                if (link) {
                    // 🚀 FIX: Attached memberId so Netcash webhook can update the correct profile!
                    await prisma.transaction.create({
                        data: { 
                            churchCode: orgCode, 
                            memberId: member.id, // <--- CRITICAL FIX
                            phone: cleanPhone, 
                            amount: parseFloat(amount), 
                            reference: ref, 
                            status: 'PENDING', 
                            type: 'SOCIETY_PREMIUM', 
                            date: new Date() 
                        }
                    });
                    reply = `💳 *Pay Premium via Netcash*\nDue: R${amount}.00\n\n👉 ${link}`;
                } else {
                    reply = "⚠️ Payment link error.";
                }
            }

            // OPTION 6: LOG A DEATH CLAIM
            else if (incomingMsg === '6') {
                session.step = 'AWAITING_CLAIM_DOCUMENT';
                reply = `📑 *Log a Death Claim*\n\nPlease upload a clear photo of the *Death Certificate*.\n\nOur AI will process the details instantly.`;
            }

            // ✨ OPTION 7: MY PROFILE
            else if (incomingMsg === '7') {
                session.step = 'PROFILE_MENU';
                reply = `👤 *My Profile*\n\n` +
                        `Name: ${member?.firstName} ${member?.lastName}\n` +
                        `Email: ${member?.email || 'Not set'}\n\n` +
                        `1️⃣ Update Name & Surname\n` +
                        `2️⃣ Update Email Address\n` +
                        `3️⃣ Leave Society (Unlink)\n` +
                        `0️⃣ Back to Main Menu`;
            }

            // OPTION 8: EXIT
            else if (incomingMsg === '8') {
                session.mode = 'CHURCH';
                session.step = 'CHURCH_MENU';
                reply = "⛪ *Switching to Church Mode.*\n\nReply *Menu* to see your options.";
            }

            else if (incomingMsg === '0') {
                session.step = 'SOCIETY_MENU';
                return handleSocietyMessage(cleanPhone, 'society', session, member);
            }
        }

        // ==========================================
        // 👤 PROFILE MANAGEMENT STATES
        // ==========================================
        else if (session.step === 'PROFILE_MENU') {
            if (incomingMsg === '1') {
                session.step = 'UPDATE_NAME';
                reply = "✏️ Please reply with your *First Name* and *Last Name* (e.g., John Doe):";
            } else if (incomingMsg === '2') {
                session.step = 'UPDATE_EMAIL';
                reply = "📧 Please reply with your new *Email Address*:";
            } else if (incomingMsg === '3') {
                session.step = 'CONFIRM_UNLINK';
                reply = "⚠️ *WARNING*\n\nAre you sure you want to leave this society? You will no longer receive updates or have access to this menu.\n\nReply *YES* to confirm, or *NO* to cancel.";
            } else if (incomingMsg === '0') {
                session.step = 'SOCIETY_MENU';
                return handleSocietyMessage(cleanPhone, 'society', session, member);
            } else {
                reply = "⚠️ Invalid option. Please reply 1, 2, 3, or 0.";
            }
        }
        else if (session.step === 'UPDATE_NAME') {
            const parts = incomingMsg.split(' ');
            const fName = parts[0] || 'Member';
            const lName = parts.slice(1).join(' ') || '.'; 
            // 🚀 FIX: Use member.id so Prisma doesn't crash on non-unique phone
            await prisma.member.update({ where: { id: member.id }, data: { firstName: fName, lastName: lName } });
            session.step = 'SOCIETY_MENU';
            reply = `✅ Profile updated to *${fName} ${lName}*!\n\nReply *0* to go back.`;
        }
        else if (session.step === 'UPDATE_EMAIL') {
            // 🚀 FIX: Use member.id
            await prisma.member.update({ where: { id: member.id }, data: { email: incomingMsg.toLowerCase() } });
            session.step = 'SOCIETY_MENU';
            reply = `✅ Email successfully updated!\n\nReply *0* to go back.`;
        }
        else if (session.step === 'CONFIRM_UNLINK') {
            if (incomingMsg.toLowerCase() === 'yes') {
                // 🚀 FIX: Use member.id and clear both code fields to ensure a clean break
                await prisma.member.update({ where: { id: member.id }, data: { churchCode: null, societyCode: null, status: 'INACTIVE' } });
                session.mode = null;
                session.step = null;
                reply = "🚪 You have successfully unlinked from the society.\n\nReply *Join* anytime to link to a new organization.";
            } else {
                session.step = 'PROFILE_MENU';
                reply = "🛑 Unlink cancelled. Reply *0* to go back, or *Menu* for the main menu.";
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
                reply = `✅ Added ${session.tempDep.name}.\n\nReply *2* to view list or *0* for main menu.`;
                session.step = 'SOCIETY_MENU';
            } else {
                reply = "⚠️ Member record not found.";
            }
        }

        // 4. CLAIM UPLOAD LOGIC
        else if (session.step === 'AWAITING_CLAIM_DOCUMENT') {
            reply = "⏳ *Document Uploaded*\n\nYour document is being processed by our AI worker. You will receive a notification once the claim is logged.";
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