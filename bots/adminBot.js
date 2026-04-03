// bots/adminBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports.process = async (incomingMsg, cleanPhone, member, sendWhatsApp) => {
    const msg = incomingMsg.trim();
    const command = msg.toLowerCase();

    // 1. FAIL FAST: Is the user trying to use an admin command?
    if (!command.startsWith('admin')) return false;

    // 2. AUTHENTICATION: Check if this phone number belongs to an Org Admin
    const localPhone = '0' + cleanPhone.substring(2);
    
    const org = await prisma.church.findFirst({
        where: {
            OR: [
                { adminPhone: cleanPhone },
                { adminPhone: localPhone },
                { adminPhone: '+' + cleanPhone }
            ]
        }
    });

    // If they aren't in the database as an admin, lock them out immediately
    if (!org) {
        await sendWhatsApp(cleanPhone, "⛔ *Security Alert: Access Denied*\nThis phone number is not registered as an administrator for any workspace.");
        return true; 
    }

    // 3. PARSE THE ACTION
    const parts = msg.split(' ');
    const action = parts[1] ? parts[1].toLowerCase() : 'menu';

    // ==========================================
    // 📱 ADMIN MENU
    // ==========================================
    if (action === 'menu') {
        await sendWhatsApp(cleanPhone, `💼 *${org.name} Admin Portal*\nWelcome back! Here are your quick commands:\n\n📊 *Admin Stats* - View pending payouts & member count\n📅 *Admin Schedule* - View today's appointments\n📢 *Admin Blast [Message]* - Send a broadcast to all clients\n\n_Example: Admin Blast We are closed tomorrow due to the holiday._`);
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
            scheduleMsg += `${statusIcon} *${time}* - ${appt.member.firstName} (${appt.product.name})\n`;
        });

        await sendWhatsApp(cleanPhone, scheduleMsg);
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