// jobs/engagementMonitor.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWhatsApp } = require('../services/whatsapp');

async function runEngagementMonitor() {
    console.log("🔍 Starting Member Engagement Scan...");

    // Calculate the date 60 days ago
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // 1. Find ACTIVE members who haven't interacted in 60 days
    const atRiskMembers = await prisma.member.findMany({
        where: {
            status: 'ACTIVE',
            lastInteractionAt: { lt: sixtyDaysAgo },
            engagementScore: { gt: 50 } // Only target them if we haven't already dropped their score
        },
        include: { church: true }
    });

    console.log(`⚠️ Found ${atRiskMembers.length} ACTIVE members at risk of churning.`);

    for (const member of atRiskMembers) {
        if (!member.phone) continue;
        const cleanPhone = member.phone.startsWith('0') ? '27' + member.phone.substring(1) : member.phone.replace('+', '');
        
        const orgName = member.church ? member.church.name : "Seabe Digital";
        const message = `👋 Hi ${member.firstName},\n\nIt's been a while since we last heard from you at *${orgName}*!\n\nTo ensure your profile remains active and you don't miss out on any updates or benefits, please reply with *Menu* to view your dashboard.\n\n_If you need any assistance, just reply 'Help'._`;

        try {
            await sendWhatsApp(cleanPhone, message);
            
            // Drop their score so we don't spam them again tomorrow
            await prisma.member.update({
                where: { id: member.id },
                data: { engagementScore: 50 } 
            });
        } catch (err) {
            console.error(`Failed to send re-engagement to ${cleanPhone}:`, err);
        }
    }

    // 2. Find LEAD members who haven't interacted in 14 days (Leads get cold faster!)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const coldLeads = await prisma.member.findMany({
        where: {
            status: 'LEAD',
            lastInteractionAt: { lt: fourteenDaysAgo },
            engagementScore: { gt: 10 }
        },
        include: { church: true }
    });

    console.log(`🥶 Found ${coldLeads.length} cold LEADs.`);

    for (const lead of coldLeads) {
        if (!lead.phone) continue;
        const cleanPhone = lead.phone.startsWith('0') ? '27' + lead.phone.substring(1) : lead.phone.replace('+', '');
        
        const orgName = lead.church ? lead.church.name : "Seabe Digital";
        const message = `Hi ${lead.firstName}, just following up! 🌟\n\nYou recently requested more info about joining *${orgName}*. Did you manage to get sorted?\n\nReply *Join* if you are ready to complete your registration, or let us know if you have any questions!`;

        try {
            await sendWhatsApp(cleanPhone, message);
            
            // Drop score to prevent spamming
            await prisma.member.update({
                where: { id: lead.id },
                data: { engagementScore: 10 } 
            });
        } catch (err) {
            console.error(`Failed to chase lead ${cleanPhone}:`, err);
        }
    }

    console.log("✅ Engagement Scan Complete.");
}

module.exports = { runEngagementMonitor };