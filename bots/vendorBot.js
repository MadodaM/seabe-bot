// bots/vendorBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports.process = async (incomingMsg, cleanPhone, sendWhatsApp) => {
    const msg = incomingMsg.trim();
    const command = msg.toLowerCase();

    // 1. Is this a quote submission? If not, ignore and let other bots handle it.
    if (!command.startsWith('quote ')) return false;

    const parts = msg.split(' ');
    
    if (parts.length < 3) {
        await sendWhatsApp(cleanPhone, "⚠️ *Format Error*\nPlease reply with: *Quote [RFQ_ID] [Amount]*\nExample: Quote 42 1500");
        return true;
    }

    const rfqId = parseInt(parts[1], 10);
    // Strip out 'R' or commas just in case the vendor types "R1,500"
    const amountStr = parts[2].replace(/[^\d.]/g, ''); 
    const amount = parseFloat(amountStr);

    if (isNaN(rfqId) || isNaN(amount)) {
        await sendWhatsApp(cleanPhone, "⚠️ *Format Error*\nMake sure the RFQ ID and Amount are numbers.");
        return true;
    }

    // 2. Identify the Vendor by their WhatsApp number
    const localPhone = '0' + cleanPhone.substring(2);
    const vendor = await prisma.vendor.findFirst({
        where: {
            OR: [
                { phone: cleanPhone },
                { phone: '+' + cleanPhone },
                { phone: localPhone }
            ],
            status: 'ACTIVE'
        },
        include: { church: true }
    });

    if (!vendor) {
        await sendWhatsApp(cleanPhone, "❌ *Access Denied*\nYour number is not registered as an active vendor for this request. Please contact the administrator.");
        return true;
    }

    // 3. Verify the RFQ is still open
    const rfq = await prisma.requestForQuote.findUnique({
        where: { id: rfqId }
    });

    if (!rfq || rfq.churchId !== vendor.churchId) {
        await sendWhatsApp(cleanPhone, "❌ *Error*\nWe couldn't find an open RFQ with that ID.");
        return true;
    }

    if (rfq.status !== 'OPEN') {
        await sendWhatsApp(cleanPhone, `⚠️ *Notice*\nThis Request for Quote (ID: ${rfqId}) has been closed and is no longer accepting bids.`);
        return true;
    }

    // 4. Save the Quote to the Database
    const quote = await prisma.quote.create({
        data: {
            rfqId: rfq.id,
            vendorId: vendor.id,
            amount: amount,
            notes: parts.slice(3).join(' ') || null, // Captures any extra text they sent
            status: 'PENDING'
        }
    });

    // 5. Confirm to the Vendor
    await sendWhatsApp(cleanPhone, `✅ *Quote Submitted!*\n\n*RFQ ID:* ${rfq.id}\n*Amount:* R${amount.toFixed(2)}\n\nThank you, ${vendor.name}. We have notified ${vendor.church.name}.`);

    // 6. Notify the Admin instantly!
    const adminPhone = vendor.church.adminPhone;
    if (adminPhone) {
        const cleanAdmin = adminPhone.startsWith('0') ? '27' + adminPhone.substring(1) : adminPhone.replace('+', '');
        const adminMsg = `🔔 *New Quote Received!*\n\n*Vendor:* ${vendor.name}\n*RFQ ID:* ${rfq.id} (${rfq.title})\n*Amount:* R${amount.toFixed(2)}\n\n_We will add a command to view all quotes soon._`;
        try {
            await sendWhatsApp(cleanAdmin, adminMsg);
        } catch (err) {
            console.error("Failed to notify admin of new quote:", err);
        }
    }

    return true; // Tells the router to stop processing this message
};