// ==========================================
// societyBot.js - Burial Society Logic Handler
// ==========================================
const { createPaymentLink } = require('./services/paystack');

async function handleSocietyMessage(incomingMsg, cleanPhone, session, prisma, twiml, res) {
    let reply = "";

    try {
        // 1. MENU TRIGGER
        if (['society', 'menu'].includes(incomingMsg.toLowerCase())) {
            session.step = 'SOCIETY_MENU';
            reply = `🛡️ *${session.orgName}*\n_Burial Society Portal_\n\n` +
                    `1. My Policy 📜\n` +
                    `2. My Dependents 👨‍👩‍👧‍👦\n` +
                    `3. Banking Details 🏦\n` +
                    `4. Digital Card 🪪\n` +
                    `5. Pay Premium 💳\n` +
                    `6. Exit to Church ⛪\n\n` +
                    `Reply with a number:`;
        }

        // 2. MENU OPTIONS
        else if (session.step === 'SOCIETY_MENU') {
            
            // POLICY STATUS
            if (incomingMsg === '1') {
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

            // DEPENDENTS
            else if (incomingMsg === '2') {
                const dependents = await prisma.dependent.findMany({ where: { member: { phone: cleanPhone } } });
                if (dependents.length === 0) {
                    reply = `👨‍👩‍👧‍👦 *My Dependents*\n\nNo dependents linked.\nReply *Add* to add one.`;
                } else {
                    reply = `👨‍👩‍👧‍👦 *Dependents (${dependents.length})*\n` + dependents.map(d => `- ${d.firstName} (${d.relation})`).join('\n') + `\n\nReply *Add* to add more or *0* to back.`;
                }
                session.step = 'DEPENDENT_VIEW';
            }

            // BANKING
            else if (incomingMsg === '3') {
                reply = `🏦 *Banking Details*\n\nBank: Standard Bank\nAcc: 123456789\nRef: ${cleanPhone}`;
            }

            // PREMIUM PAYMENT
// PREMIUM PAYMENT
else if (incomingMsg === '5') {
    const member = await prisma.member.findUnique({ 
        where: { phone: cleanPhone },
        include: { society: true }
    });

    // FIXED LINE: Added 'amount ='
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
                type: 'SOCIETY_PREMIUM'
            }
        });
        reply = `💳 *Pay Premium*\nDue: R${amount}.00\n\n👉 ${link}`;
    } else {
        reply = "⚠️ Error generating link.";
    }
}

        // 3. DEPENDENT LOGIC
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
                reply = `✅ Added ${session.tempDep.name}.\nReply *2* to view list.`;
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
} // <--- Added missing closing brace for the function

module.exports = { handleSocietyMessage };