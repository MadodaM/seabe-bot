// ==========================================
// bots/societyBot.js - Burial Society Logic Handler (With Dynamic Billing)
// ==========================================
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const netcash = require('../services/netcash');
const { generatePolicyCard } = require('../services/cardGenerator');
const { generateKYCLink } = require('../routes/kyc');
const { calculateTransaction } = require('../services/pricingEngine');
const { processTwilioClaim } = require('../services/aiClaimWorker');
const { getPrice } = require('../services/pricing'); // 🚀 NEW: Dynamic Pricing

// Safely initialize Twilio for direct background messaging
let twilioClient;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
}

// Upgraded to handle Media URLs!
const sendWhatsApp = async (to, body, mediaUrl = null) => {
    if (!twilioClient) return console.log("⚠️ Twilio Keys Missing!");
    const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
    
    // 🛡️ Ensure to is a clean Twilio string
    let cleanTo = to.replace(/\D/g, '');
    if (cleanTo.startsWith('0')) cleanTo = '27' + cleanTo.substring(1);
    
    try {
        const msgConfig = {
            from: `whatsapp:${cleanTwilioNumber}`,
            to: `whatsapp:+${cleanTo}`,
            body: body
        };
        
        // If an image is provided, attach it!
        if (mediaUrl) msgConfig.mediaUrl = [mediaUrl]; 

        await twilioClient.messages.create(msgConfig);
        console.log(`✅ Society text delivered to +${cleanTo}`);
    } catch (err) {
        console.error("❌ Twilio Send Error:", err.message);
    }
};

const gateway = netcash;

// 💰 NEW: Billing Helper (Now requires Phone)
async function chargeSociety(societyId, phone, amount, type, description) {
    try {
        if (!societyId) return; 
        await prisma.transaction.create({
            data: {
                amount: -amount, // Negative value reduces their payout
                type: type,      
                status: 'SUCCESS',
                reference: `FEE-${Date.now()}`,
                providerRef: 'INTERNAL',
                description: description,
                societyId: societyId,
                phone: phone, // 👈 ADDED: Links the cost to the user who triggered it
                createdAt: new Date()
            }
        });
        console.log(`💰 [BILLING] Charged Society #${societyId} R${amount} for ${type} (User: ${phone})`);
    } catch (e) {
        console.error("❌ Billing Error:", e);
    }
}

async function handleSocietyMessage(cleanPhone, incomingMsg, session, member) {
    let reply = "";
    // Check both relation types depending on how they joined
    const orgName = session.orgName || (member?.church ? member.church.name : (member?.society ? member.society.name : "Burial Society"));
    const orgCode = session.orgCode || member?.churchCode || member?.societyCode;
    const societyId = member?.societyId || 1; // Default to ID 1 if null (Pilot Society)

    try {
        // 1. MENU TRIGGER
        const societyTriggers = ['society', 'policy', 'funeral', 'palour', 'menu', 'hi', 'hello'];
        
        if (societyTriggers.includes(incomingMsg.toLowerCase()) && !['ADD_DEP_NAME', 'ADD_DEP_RELATION', 'PROFILE_MENU', 'UPDATE_NAME', 'UPDATE_EMAIL', 'CONFIRM_UNLINK', 'PAYMENT_OPTIONS', 'KYC_INPUT'].includes(session.step)) {
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
                const dependents = await prisma.dependent.findMany({ where: { memberId: member.id } });
                if (dependents.length === 0) {
                    reply = `👨‍👩‍👧‍👦 *My Dependents*\n\nNo dependents linked.\nReply *Add* to add one.`;
                } else {
                    reply = `👨‍👩‍👧‍👦 *Dependents (${dependents.length})*\n` + dependents.map(d => `- ${d.firstName} (${d.relation})`).join('\n') + `\n\nReply *Add* to add more or *0* to back.`;
                }
                session.step = 'DEPENDENT_VIEW';
            }

            // 🏦 OPTION 3: KYC COMPLIANCE (UPDATED FLOW)
            else if (incomingMsg === '3') {
                // We ask for ID input directly here to trigger billing
                session.step = 'KYC_INPUT'; 
                reply = `👤 *KYC Compliance*\n\nPlease enter the *ID Number* you want to verify (e.g., 8001015009087).\n\n_Note: A standard lookup fee applies to your society._`;
            }

            // OPTION 4: DIGITAL MEMBER CARD 🪪
            else if (incomingMsg === '4') {
                await sendWhatsApp(cleanPhone, "🎨 Generating your digital policy card. Please wait a moment...");

                const orgData = member.church || member.society || { name: session.orgName };
                const cardUrl = await generatePolicyCard(member, orgData);
                
                if (cardUrl) {
                    const statusEmoji = member?.status === 'ACTIVE' ? '✅' : '🔴';
                    reply = `🪪 *DIGITAL MEMBERSHIP CARD*\n\n` +
                            `🏛️ *${orgName}*\n` +
                            `👤 *Name:* ${member?.firstName || 'Member'} ${member?.lastName || ''}\n` +
                            `💳 *Status:* ${member?.status || 'ACTIVE'} ${statusEmoji}\n\n` +
                            `_Show this card to service providers for verification._\n\n` +
                            `Reply *0* to go back.`;
                    await sendWhatsApp(cleanPhone, reply, cardUrl);
                    reply = ""; 
                } else {
                    reply = "⚠️ Error generating image."; 
                }
            }

            // 🚀 OPTION 5: PREMIUM PAYMENT
            else if (incomingMsg === '5') {
                const amount = member?.monthlyPremium || 150.00;
                session.tempPaymentAmount = amount;
                session.step = 'PAYMENT_OPTIONS';

                reply = `💳 *Premium Payment*\nYour base premium is R${amount.toFixed(2)}.\n\nHow would you like to pay today?\n\n` +
                        `*1️⃣ Set up a Monthly Debit Order* (Recommended)\n` +
                        `_Automatically pay every month. R5.00 processing fee applies._\n\n` +
                        `*2️⃣ Make a Once-Off Payment*\n` +
                        `_Pay manually via Capitec Pay or Card today._\n\n` +
                        `Reply 1 or 2.`;
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
        // 🏦 KYC PROCESSING STATE
        // ==========================================
        else if (session.step === 'KYC_INPUT') {
            const idToCheck = incomingMsg.replace(/\D/g, '');
            
            if (idToCheck.length !== 13) {
                reply = "❌ Invalid ID. Please enter a 13-digit SA ID number.";
            } else {
                // 1. Fetch Dynamic Price
				const kycCost = await getPrice('KYC_CHECK');

				// 2. Charge the Society (Pass 'cleanPhone' as the 2nd argument)
				await chargeSociety(societyId, cleanPhone, kycCost, 'KYC_FEE', `Identity Check: ${idToCheck}`);

                // 3. Generate Link (or result)
                const host = process.env.HOST_URL || 'seabe-bot.onrender.com';
                const link = await generateKYCLink(cleanPhone, host, member.id);
                
                reply = `👤 *KYC Request Initiated*\n\nID: ${idToCheck}\n\n👉 Click here to complete verification:\n${link}\n\n_A fee of R${kycCost.toFixed(2)} has been billed to your society._\n\nReply *0* for menu.`;
                session.step = 'SOCIETY_MENU';
            }
        }

        // ==========================================
        // 💳 PAYMENT PROCESSING STATE
        // ==========================================
        else if (session.step === 'PAYMENT_OPTIONS') {
            const amount = session.tempPaymentAmount || 150.00;
            
            if (incomingMsg === '1') {
                // 1. DEBIT ORDER MANDATE
                const ref = `${orgCode}-MANDATE-${cleanPhone.slice(-4)}`;
                const mandateData = await gateway.setupDebitOrderMandate(amount, cleanPhone, orgName, ref);
                
                if (mandateData) {
                    reply = `🛡️ *Automated Debit Order*\n\nBase Premium: R${mandateData.pricing.baseAmount.toFixed(2)}\nService Fee: R${mandateData.pricing.totalFees.toFixed(2)}\n*Monthly Deduction: R${mandateData.pricing.totalChargedToUser.toFixed(2)}*\n\n👉 Tap here to digitally sign your mandate via Netcash:\n${mandateData.mandateUrl}\n\nReply *0* to go back.`;
                } else {
                    reply = "⚠️ Mandate system is temporarily offline.";
                }
                session.step = 'SOCIETY_MENU';

            } else if (incomingMsg === '2') {
                // 2. ONCE-OFF PAYMENT
                const pricing = calculateTransaction(amount, 'STANDARD', 'DEFAULT', true);
                const ref = `${orgCode}-ONCEOFF-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-4)}`;
                const link = await gateway.createPaymentLink(pricing.totalChargedToUser, ref, cleanPhone, orgName);

                if (link) {
                    await prisma.transaction.create({
                        data: { 
                            churchCode: orgCode, 
                            memberId: member.id, 
                            phone: cleanPhone, 
                            amount: pricing.baseAmount, 
                            reference: ref, 
                            status: 'PENDING', 
                            type: 'SOCIETY_PREMIUM', 
                            date: new Date() 
                        }
                    });
                    reply = `💳 *Once-Off Payment*\n\nBase Premium: R${pricing.baseAmount.toFixed(2)}\nService Fee: R${pricing.totalFees.toFixed(2)}\n*Total Due: R${pricing.totalChargedToUser.toFixed(2)}*\n\n👉 Pay securely here:\n${link}\n\nReply *0* to go back.`;
                } else {
                    reply = "⚠️ Payment link error.";
                }
                session.step = 'SOCIETY_MENU';

            } else {
                reply = "⚠️ Invalid option. Please reply 1 or 2.";
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
            await prisma.member.update({ where: { id: member.id }, data: { firstName: fName, lastName: lName } });
            session.step = 'SOCIETY_MENU';
            reply = `✅ Profile updated to *${fName} ${lName}*!\n\nReply *0* to go back.`;
        }
        else if (session.step === 'UPDATE_EMAIL') {
            await prisma.member.update({ where: { id: member.id }, data: { email: incomingMsg.toLowerCase() } });
            session.step = 'SOCIETY_MENU';
            reply = `✅ Email successfully updated!\n\nReply *0* to go back.`;
        }
        else if (session.step === 'CONFIRM_UNLINK') {
            if (incomingMsg.toLowerCase() === 'yes') {
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

        // 🚀 4. CLAIM UPLOAD LOGIC (WITH BILLING)
        else if (session.step === 'AWAITING_CLAIM_DOCUMENT') {
            // Your webhook should pass the Twilio Media URL into the session
            const mediaUrl = session.tempMediaUrl || incomingMsg; 

            if (!mediaUrl || !mediaUrl.startsWith('http')) {
                reply = "⚠️ Please upload a *photo* or *document* of the Death Certificate.";
            } else {
                // 1. Fetch Dynamic Price
				const claimCost = await getPrice('CLAIM_AI');

				// 2. Charge the Society (Pass 'cleanPhone' as the 2nd argument)
				await chargeSociety(societyId, cleanPhone, claimCost, 'CLAIM_FEE', 'Forensic Death Claim Analysis');

                // 3. Send Holding Message
                await sendWhatsApp(cleanPhone, `⏳ *Document Received!*\nOur Forensic AI is currently scanning the Death Certificate.\n\n_A processing fee of R${claimCost.toFixed(2)} has been billed to your society._`);

                // 4. Fire the background worker!
                processTwilioClaim(cleanPhone, mediaUrl, orgCode).catch(e => console.error("Worker trigger failed:", e));
                
                // Clear media from session and return to menu
                delete session.tempMediaUrl;
                session.step = 'SOCIETY_MENU';
            }
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