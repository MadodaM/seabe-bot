// bots/adminBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports.process = async (incomingMsg, cleanPhone, member, sendWhatsApp, session) => {
    const msg = incomingMsg.trim();
    const command = msg.toLowerCase();

    if (!command.startsWith('admin')) return false;

    const parts = msg.split(' ');
    const action = parts[1] ? parts[1].toLowerCase() : 'menu';
    const localPhone = '0' + cleanPhone.substring(2);

    // ==========================================
    // 1. AUTHENTICATION & MULTI-TENANT PICKER
    // ==========================================
    
    // Find ALL organizations where this person is an admin
    const authorizedOrgs = await prisma.church.findMany({
        where: {
            OR: [
                { adminPhone: cleanPhone },
                { adminPhone: localPhone },
                { adminPhone: '+' + cleanPhone }
            ]
        }
    });

    if (authorizedOrgs.length === 0) {
        await sendWhatsApp(cleanPhone, "⛔ *Security Alert: Access Denied*\nThis number is not registered as an administrator.");
        return true;
    }

    // Determine which Org we are currently managing
    // Priority: 1. Explicitly switched session code, 2. The first authorized org
    let org = authorizedOrgs[0];
    if (session?.adminOrgCode) {
        const switchedOrg = authorizedOrgs.find(o => o.code === session.adminOrgCode);
        if (switchedOrg) org = switchedOrg;
    }

    // ==========================================
    // 2. NEW: SWITCH & LIST COMMANDS
    // ==========================================

    // COMMAND: Admin List
    if (action === 'list' || action === 'orgs') {
        let listMsg = `📂 *Your Authorized Workspaces:*\n\n`;
        authorizedOrgs.forEach((o, i) => {
            const active = o.code === org.code ? '✅ *ACTIVE*' : '🔹';
            listMsg += `${active} ${o.name} (${o.code})\n`;
        });
        listMsg += `\n_To switch, type:_\n*Admin Switch [Code]*`;
        await sendWhatsApp(cleanPhone, listMsg);
        return true;
    }

    // COMMAND: Admin Switch [CODE]
    if (action === 'switch') {
        const targetCode = parts[2]?.toUpperCase();
        const targetOrg = authorizedOrgs.find(o => o.code === targetCode);

        if (!targetOrg) {
            await sendWhatsApp(cleanPhone, `❌ *Switch Failed*\nYou are not authorized for code: ${targetCode || 'EMPTY'}.\nType *Admin List* to see your options.`);
            return true;
        }

        // Update the session to persist the switch
        session.adminOrgCode = targetOrg.code;
        await sendWhatsApp(cleanPhone, `🔄 *Switched to ${targetOrg.name}*\nYour admin commands will now apply to this workspace.`);
        return true;
    }

    // ==========================================
    // 3. REST OF COMMANDS (Menu, Stats, Schedule, Bill, Blast)
    // ==========================================
    
    if (action === 'menu') {
        await sendWhatsApp(cleanPhone, `💼 *${org.name} Admin Portal*\nActive Workspace: *${org.code}*\n\n📊 *Admin Stats*\n📅 *Admin Schedule*\n📂 *Admin List* - Switch organizations\n📢 *Admin Blast [Message]*\n\n_Type Admin Switch [Code] to change businesses._`);
        return true;
    }

    // ==========================================
    // 📊 DASHBOARD STATS
    // ==========================================
    if (action === 'stats') {
        const pendingStats = await prisma.transaction.aggregate({
            where: { churchCode: org.code, status: 'SUCCESS', payoutId: null },
            _sum: { netSettlement: true }
        });
        const pendingPayout = pendingStats._sum.netSettlement || 0;

        const memberCount = await prisma.member.count({
            where: { churchCode: org.code, status: 'ACTIVE' }
        });

        await sendWhatsApp(cleanPhone, `📊 *${org.name} Dashboard*\n\n👥 *Active Clients:* ${memberCount}\n💰 *Pending Payout:* R${pendingPayout.toFixed(2)}\n\n_Log in to your web dashboard for full ledger details._`);
        return true;
    }

// ==========================================
    // 📅 TODAY'S SCHEDULE
    // ==========================================
    if (action === 'schedule') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const todayAppts = await prisma.appointment.findMany({
            where: {
                churchId: org.id,
                bookingDate: { gte: startOfDay, lte: endOfDay }
            },
            include: { member: true, product: true },
            orderBy: { bookingDate: 'asc' }
        });

        if (todayAppts.length === 0) {
            await sendWhatsApp(cleanPhone, `📅 *Today's Schedule*\n\nYou have no appointments booked for today.`);
            return true;
        }

        let scheduleMsg = `📅 *Today's Schedule (${todayAppts.length})*\n\n`;
        todayAppts.forEach(appt => {
            const time = new Date(appt.bookingDate).toLocaleTimeString('en-ZA', { hour: '2-digit', minute:'2-digit' });
            const statusIcon = appt.status === 'CONFIRMED' ? '✅' : (appt.status === 'PENDING_PAYMENT' ? '⏳' : '🗓️');
            // 🚀 Added [ID] so the admin knows which number to bill
            scheduleMsg += `${statusIcon} *[ID: ${appt.id}]* ${time} - ${appt.member.firstName} (${appt.product.name})\n`;
        });
        
        scheduleMsg += `\n_To check a client out, type:_\n*Admin Bill [ID] [Amount] [Extras]*\n_Example: Admin Bill 14 150 Premium Beard Oil_`;

        await sendWhatsApp(cleanPhone, scheduleMsg);
        return true;
    }
	
	// ==========================================
    // 🛒 VENDOR MANAGEMENT DIRECTORY
    // ==========================================
    if (action === 'vendor') {
        const subAction = parts[2] ? parts[2].toLowerCase() : 'list';

        // 🟢 COMMAND: Admin Vendor Add [Name] [Phone] [Category]
        if (subAction === 'add') {
            const vendorName = parts[3];
            const vendorPhone = parts[4] || '';
            const vendorCategory = parts.slice(5).join(' ') || 'General';

            if (!vendorName) {
                await sendWhatsApp(cleanPhone, "⚠️ *Invalid Format*\nPlease use: *Admin Vendor Add [Name] [Phone] [Category]*\n\n_Example: Admin Vendor Add Makro 0800123456 Wholesale_");
                return true;
            }

            // Save to Database
            const newVendor = await prisma.vendor.create({
                data: {
                    name: vendorName,
                    phone: vendorPhone,
                    category: vendorCategory,
                    churchId: org.id
                }
            });

            await sendWhatsApp(cleanPhone, `✅ *Vendor Added Successfully!*\n\n*Name:* ${newVendor.name}\n*Category:* ${newVendor.category}\n*Phone:* ${newVendor.phone}\n\nType *Admin Vendor List* to view your directory.`);
            return true;
        }

        // 🔵 COMMAND: Admin Vendor List
        if (subAction === 'list') {
            const vendors = await prisma.vendor.findMany({
                where: { churchId: org.id },
                take: 15,
                orderBy: { name: 'asc' }
            });

            if (vendors.length === 0) {
                await sendWhatsApp(cleanPhone, `📂 *Vendor Directory*\n\nYou currently have no vendors saved. Add one by typing:\n*Admin Vendor Add [Name] [Phone]*`);
                return true;
            }

            let msg = `📂 *${org.name} Vendor Directory*\n\n`;
            vendors.forEach(v => {
                msg += `🏢 *${v.name}* (${v.category})\n📞 ${v.phone || 'N/A'}\n_ID: ${v.id}_\n\n`;
            });
            
            // Teaser for the next feature we will build
            msg += `_To pay a vendor, type:_\n*Admin PO Create [VendorID] [Amount] [Details]*`;

            await sendWhatsApp(cleanPhone, msg);
            return true;
        }
    }
	
	// ==========================================
    // 📢 PROCUREMENT: REQUEST FOR QUOTE (RFQ) ENGINE
    // ==========================================
    if (action === 'rfq') {
        // Expected format: Admin RFQ Category | Description
        // e.g., Admin RFQ Tent Hire | Need a 100-seater marquee for Saturday
        const fullMessage = msg.substring(10).trim(); // Removes "admin rfq "
        const splitIndex = fullMessage.indexOf('|');

        if (splitIndex === -1) {
            await sendWhatsApp(cleanPhone, "⚠️ *Invalid Format*\nPlease use: *Admin RFQ [Category] | [Description]*\n\n_Example: Admin RFQ Tent Hire | Need a 100-seater marquee for Saturday_");
            return true;
        }

        const category = fullMessage.substring(0, splitIndex).trim();
        const description = fullMessage.substring(splitIndex + 1).trim();

        if (!category || !description) {
            await sendWhatsApp(cleanPhone, "⚠️ *Error:* Category and description cannot be empty.");
            return true;
        }

        // 1. Find Matching Vendors for this Business/Church
        const vendors = await prisma.vendor.findMany({
            where: {
                churchId: org.id,
                category: {
                    equals: category,
                    mode: 'insensitive' // Ensures "tent hire" matches "Tent Hire"
                },
                status: 'ACTIVE'
            }
        });

        if (vendors.length === 0) {
            await sendWhatsApp(cleanPhone, `❌ *No Vendors Found*\nYou don't have any ACTIVE vendors listed under the category: *${category}*.\n\nType *Admin Vendor List* to check your categories.`);
            return true;
        }

        // 2. Create the RFQ in the database
        const requiredDate = new Date();
        requiredDate.setDate(requiredDate.getDate() + 3); // Default: Quotes required in 3 days

        const rfq = await prisma.requestForQuote.create({
            data: {
                churchId: org.id,
                title: `${category} Request`,
                description: description,
                requiredBy: requiredDate,
                status: 'OPEN'
            }
        });

        // 3. Broadcast to Vendors via WhatsApp
        let successfulSends = 0;
        for (const vendor of vendors) {
            if (!vendor.phone) continue;

            const vendorPhone = vendor.phone.startsWith('0') ? '27' + vendor.phone.substring(1) : vendor.phone.replace('+', '');
            
            const rfqMessage = `📢 *New Request for Quote*\n*From:* ${org.name}\n\n*Job Description:*\n${description}\n\nTo submit your quote, reply directly to this message exactly like this:\n*Quote ${rfq.id} [Your Amount]*\n\n_Example: Quote ${rfq.id} 1500_`;

            try {
                await sendWhatsApp(vendorPhone, rfqMessage);
                successfulSends++;
            } catch (err) {
                console.error(`Failed to send RFQ to vendor ${vendor.name}:`, err);
            }
        }

        // 4. Confirm with the Admin
        await sendWhatsApp(cleanPhone, `✅ *RFQ Broadcast Sent!*\n\n*RFQ ID:* ${rfq.id}\n*Category:* ${category}\n*Sent to:* ${successfulSends} vendor(s)\n\nWe will notify you here when the quotes start coming in.`);
        return true;
    }

    // ==========================================
    // 💳 SEND BILL + CONSUMABLES
    // ==========================================
    if (action === 'bill' || action === 'checkout') {
        // Expected format: "Admin Bill 14 150 Hair dye and wash"
        const apptId = parseInt(parts[2]);
        const newAmount = parseFloat(parts[3]);
        const extras = parts.slice(4).join(' ').trim(); // Grabs everything after the amount as text

        if (!apptId || !newAmount) {
            await sendWhatsApp(cleanPhone, "⚠️ *Invalid Format*\nPlease use: *Admin Bill [ID] [Amount] [Extras]*\n\n_Example: Admin Bill 14 150 Hair Dye_");
            return true;
        }

        // 1. Verify the appointment belongs to this salon
        const appt = await prisma.appointment.findUnique({
            where: { id: apptId },
            include: { member: true, product: true, church: true }
        });

        if (!appt || appt.churchId !== org.id) {
            await sendWhatsApp(cleanPhone, "⚠️ *Error:* Appointment ID not found.");
            return true;
        }

        // 2. Update the DB with the final amount and consumables
        const updatedAppt = await prisma.appointment.update({
            where: { id: apptId },
            data: {
                finalAmount: newAmount,
                addedItems: extras || null,
                status: 'PENDING_PAYMENT',
                updatedAt: new Date()
            }
        });

        // 3. Generate the Payment Link and Message for the Client
        const host = process.env.HOST_URL || 'https://seabe.tech';
        const payLink = `${host}/pay?apptId=${appt.id}&amount=${newAmount}`;
        const extrasText = extras ? `\n➕ *Extras:* ${extras}` : '';
        
        const clientMsg = `🧾 *${appt.church.name} - Invoice*\n\nHi ${appt.member.firstName}, your payment link is ready.\n\n✂️ *Service:* ${appt.product.name}${extrasText}\n💰 *Total Due:* R${newAmount.toFixed(2)}\n\n👉 Click to securely pay via Ozow/Card:\n${payLink}`;

        // 4. Send the WhatsApp message to the Client
        const clientPhone = appt.member.phone.startsWith('0') ? '27' + appt.member.phone.substring(1) : appt.member.phone.replace('+', '');
        await sendWhatsApp(clientPhone, clientMsg);

        // 5. Confirm success back to the Admin
        await sendWhatsApp(cleanPhone, `✅ *Bill Sent!*\n\nInvoice for R${newAmount.toFixed(2)} sent to ${appt.member.firstName}.\nThe appointment status is now ⏳ PENDING_PAYMENT.`);
        return true;
    }

    // ==========================================
    // 📢 QUICK BROADCAST (BLAST)
    // ==========================================
    if (action === 'blast' || action === 'broadcast') {
        const broadcastMessage = parts.slice(2).join(' ').trim();

        if (!broadcastMessage) {
            await sendWhatsApp(cleanPhone, "⚠️ *Error:* You forgot to include a message.\n\n_Type: Admin Blast Hello everyone!_");
            return true;
        }

        const activeMembers = await prisma.member.findMany({
            where: { churchCode: org.code, status: 'ACTIVE' }
        });

        if (activeMembers.length === 0) {
            await sendWhatsApp(cleanPhone, "⚠️ No active clients found to broadcast to.");
            return true;
        }

        let count = 0;
        for (const m of activeMembers) {
            if (m.phone) {
                const cleanDest = m.phone.startsWith('0') ? '27' + m.phone.substring(1) : m.phone.replace('+', '');
                sendWhatsApp(cleanDest, `📢 *${org.name} Update*\n\n${broadcastMessage}`).catch(console.error);
                count++;
            }
        }

        await prisma.ad.create({
            data: {
                content: broadcastMessage,
                churchId: org.id,
                status: 'Sent',
                views: count,
                expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            }
        });

        await sendWhatsApp(cleanPhone, `🚀 *Broadcast Sent!*\nYour message is being delivered to ${count} clients.`);
        return true;
    }

    // Fallback if they typed something weird
    await sendWhatsApp(cleanPhone, "⚠️ Unknown admin command. Type *Admin Menu* for a list of valid commands.");
    return true;
};