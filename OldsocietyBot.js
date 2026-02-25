// ==========================================
// bots/societyBot.js - Burial Society Logic Handler
// ==========================================
const ozow = require('./services/ozow'); 
const netcash = require('./services/netcash');

// Toggle check
const ACTIVE_GATEWAY_NAME = process.env.ACTIVE_GATEWAY || 'OZOW'; 
const gateway = ACTIVE_GATEWAY_NAME === 'NETCASH' ? netcash : ozow;

async function handleSocietyMessage(incomingMsg, cleanPhone, session, prisma, twiml, res, req) {
    let reply = "";

    try {
        // 1. MENU TRIGGER
        if (['society', 'menu'].includes(incomingMsg.toLowerCase())) {
            session.step = 'SOCIETY_MENU';
            reply = `🛡️ *${session.orgName}*\n_Burial Society Portal_\n\n` +
                    `1. My Policy 📜\n` +
                    `2. My Dependents 👨‍👩‍👧‍👦\n` +
                    `3. KYC Compliance 🏦\n` +
                    `4. Digital Card 🪪\n` +
                    `5. Pay Premium 💳\n` +
                    `6. Log a Death Claim 📑\n` +
                    `7. Exit to lobby ⛪\n\n` +
                    `Reply with a number:`;
        }

        // 2. MAIN MENU NAVIGATION
        else if (session.step === 'SOCIETY_MENU') {
            
            // OPTION 1: POLICY STATUS
            if (incomingMsg === '1') {
                const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
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
                const link = `https://seabe.tech/kyc-verify?phone=${cleanPhone}`;
                reply = `👤 *KYC Compliance*\n\nPlease verify your identity to ensure your policy remains active:\n\n👉 ${link}`;
            }

            // OPTION 5: PREMIUM PAYMENT
            else if (incomingMsg === '5') {
                const member = await prisma.member.findUnique({ where: { phone: cleanPhone }, include: { society: true } });
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
                session.mode = 'CHURCH';
                session.step = 'START';
                reply = "⛪ *Switching to Church Mode.*\n\nPlease enter your Church Code to continue.";
            }
        }

        // 3. DEPENDENT LOGIC (The "Missing" 50 Lines)
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
            const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
            if (member) {
                await prisma.dependent.create({
                    data: { firstName: session.tempDep.name, lastName: member.lastName, relation: incomingMsg, memberId: member.id }
                });
                reply = `✅ Added ${session.tempDep.name}.\nReply *2* to view list or *menu* for main menu.`;
                session.step = 'SOCIETY_MENU';
            } else {
                reply = "⚠️ Member record not found.";
            }
        }

        // 4. CLAIM UPLOAD LOGIC
        else if (session.step === 'AWAITING_CLAIM_DOCUMENT') {
            const numMedia = req.body.NumMedia ? parseInt(req.body.NumMedia) : 0;
            if (numMedia > 0) {
                const twilioImageUrl = req.body.MediaUrl0;
                reply = "⏳ *Document Received.*\n\nOur Gemini AI is reading the certificate and verifying waiting periods... An admin will be notified shortly.";
                session.step = 'SOCIETY_MENU'; 
                require('../services/aiClaimWorker').processTwilioClaim(cleanPhone, twilioImageUrl, session.orgCode);
            } else {
                reply = "❌ No image detected. Please attach a photo of the certificate.";
            }
        }

        if (reply) {
            twiml.message(reply);
            res.type('text/xml').send(twiml.toString());
        }

    } catch (e) {
        console.error("❌ Society Bot Error:", e.message);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
    }
}

module.exports = { handleSocietyMessage }; 