// ==========================================
// societyBot.js - Burial Society Logic Handler
// ==========================================
const { createPaymentLink } = require('./services/paystack');

// ⚠️ NOTICE: Added 'req' at the end of the parameters so we can process Twilio images
async function handleSocietyMessage(incomingMsg, cleanPhone, session, prisma, twiml, res, req) {
    let reply = "";

    try {
        // 1. MENU TRIGGER (Global catch-all for 'menu' or 'society')
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
            
            // EXIT TO CHURCH MODE (Moved from 6 to 7)
            if (incomingMsg === '7') {
                session.mode = 'CHURCH';
                session.step = 'START';
                session.orgCode = null; // Optional: Clear code so they have to re-enter it
                reply = "⛪ *Switching to Church Mode.*\n\nPlease enter your Church Code (e.g., *AFM01*) to continue.";
            }
            
            // POLICY STATUS
            else if (incomingMsg === '1') {
                const dbLookupPhone = cleanPhone.startsWith('+') ? cleanPhone.slice(1) : cleanPhone;
                const member = await prisma.member.findUnique({ 
                    where: { phone: dbLookupPhone } 
                });

                if (!member) {
                    reply = "⚠️ Policy not found. Please contact support.";
                } else {
                    const statusEmoji = member.status === 'ACTIVE' ? '✅' : '⚠️';
                    reply = `📜 *Policy Status*\n\n` +
                            `Policy No: ${member.policyNumber || 'N/A'}\n` +
                            `Status: ${member.status || 'INACTIVE'} ${statusEmoji}\n` +
                            `Joined: ${member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : 'N/A'}\n\n` +
                            `Reply *0* to go back.`;
                }
            }

            // VIEW DEPENDENTS
            else if (incomingMsg === '2') {
                const dependents = await prisma.dependent.findMany({ where: { member: { phone: cleanPhone } } });
                if (dependents.length === 0) {
                    reply = `👨‍👩‍👧‍👦 *My Dependents*\n\nNo dependents linked.\nReply *Add* to add one.`;
                } else {
                    reply = `👨‍👩‍👧‍👦 *Dependents (${dependents.length})*\n` + dependents.map(d => `- ${d.firstName} (${d.relation})`).join('\n') + `\n\nReply *Add* to add more or *0* to back.`;
                }
                session.step = 'DEPENDENT_VIEW';
            }

            // KYC Compliance
            else if (incomingMsg === '3') {
                const { generateKYCLink } = require('./routes/kyc');
                const link = await generateKYCLink(cleanPhone, res.req.get('host'));
                reply = `👤 *KYC Compliance*\n\nPlease verify your identity here:\n\n${link}`;
            }

            // PREMIUM PAYMENT
            else if (incomingMsg === '5') {
                const member = await prisma.member.findUnique({ 
                    where: { phone: cleanPhone },
                    include: { society: true }
                });

                if (!member) {
                    reply = "⚠️ Member not found.";
                } else {
                    const amount = member.monthlyPremium || member.society?.defaultPremium || 150.00;
                    const email = member.email || `${cleanPhone}@seabe.io`;
                    const ref = `${session.orgCode}-PREM-${cleanPhone.slice(-4)}-${Date.now().toString().slice(-4)}`;

                    const link = await createPaymentLink(amount, ref, email, session.subaccount, cleanPhone, session.orgName);
                    
                    if (link) {
                        await prisma.transaction.create({
                            data: {
                                churchCode: session.orgCode,
                                phone: cleanPhone,
                                amount: amount,
                                reference: ref,
                                status: 'PENDING',
                                type: 'SOCIETY_PREMIUM',
                                //member: { connect: { phone: cleanPhone } }
                            }
                        });
                        reply = `💳 *Pay Premium*\nDue: R${amount}.00\n\n👉 ${link}`;
                    } else {
                        reply = "⚠️ Error generating link.";
                    }
                }
            }

            // 🚀 NEW: LOG A DEATH CLAIM (Option 6)
            else if (incomingMsg === '6') {
                session.step = 'AWAITING_CLAIM_DOCUMENT';
                reply = `📑 *Log a Death Claim*\n\nPlease take a clear photo of the *DHA-1663 (Notification of Death)* or the official *Death Certificate* and send it here.\n\n_Make sure the 13-digit ID number is visible._\n\nReply *menu* at any time to cancel.`;
            }
            
        } // End of SOCIETY_MENU

        // 3. 📸 NEW: PROCESS CLAIM DOCUMENT UPLOAD
        else if (session.step === 'AWAITING_CLAIM_DOCUMENT') {
            // Check if the user attached an image using Twilio's NumMedia parameter
            const numMedia = req.body.NumMedia ? parseInt(req.body.NumMedia) : 0;

            if (numMedia > 0) {
                const twilioImageUrl = req.body.MediaUrl0;
                
                reply = "⏳ *Document Received.*\n\nOur system is verifying the details... An admin will be notified shortly.\n\nReply *menu* to return to the main menu.";
                
                // Reset them so they aren't stuck
                session.step = 'SOCIETY_MENU'; 

                // Note: We will handle the AI worker logic in the background later!
            } else {
                reply = "❌ We didn't detect an image. Please attach a clear photo of the document, or reply *menu* to cancel.";
            }
        }

        // 4. DEPENDENT LOGIC
        else if (session.step === 'DEPENDENT_VIEW' && incomingMsg.toLowerCase() === 'add') {
            reply = "📝 Type Dependent's First Name:";
            session.step = 'ADD_DEP_NAME';
        }
        else if (session.step === 'ADD_DEP_NAME') {
            session.tempDep = { name: incomingMsg };
            reply = "Type Relation (e.g. Spouse, Child):";
            session.step = 'ADD_DEP_RELATION';
        }
        else if (session.step === 'ADD_DEP_RELATION') {
            const member = await prisma.member.findUnique({ where: { phone: cleanPhone } });
            if (member) {
                await prisma.dependent.create({
                    data: {
                        firstName: session.tempDep.name,
                        lastName: member.lastName,
                        relation: incomingMsg,
                        memberId: member.id
                    }
                });
                reply = `✅ Added ${session.tempDep.name}.\nReply *2* to view list or *menu* for main menu.`;
                session.step = 'SOCIETY_MENU';
            } else {
                reply = "⚠️ Error: Member record not found.";
            }
        }

        // --- FINAL SEND LOGIC ---
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