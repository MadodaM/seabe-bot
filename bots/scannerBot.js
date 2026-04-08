// bots/scannerBot.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { decodeBarcode } = require('../services/localScanner'); 
const { GoogleGenerativeAI } = require('@google/generative-ai'); // 👈 Bring the AI back

async function processBarcodeScan(reqBody, cleanPhone, session, member, sendWhatsApp) {
    const numMedia = parseInt(reqBody.NumMedia || '0');

    if (numMedia > 0 && session.step === 'ADMIN_AWAITING_BARCODE') {
        if (!member || !member.churchId) {
            await sendWhatsApp(cleanPhone, "⚠️ Session expired or invalid organization.");
            return { handled: true, clearSessionFlag: true };
        }

        const imgUrl = reqBody.MediaUrl0; 
        const mimeType = reqBody.MediaContentType0 || 'image/jpeg';
        await sendWhatsApp(cleanPhone, "🔍 *Scanning barcode...*");

        try {
            // 1. Fetch Image from Twilio into a Buffer
            const authHeader = 'Basic ' + Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH}`).toString('base64');
            const imgResponse = await fetch(imgUrl, { headers: { 'Authorization': authHeader } });
            const arrayBuffer = await imgResponse.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // 2. ⚡ ATTEMPT 1: FAST LOCAL SCAN (Free)
            let barcode = await decodeBarcode(buffer);

            // 3. 🧠 ATTEMPT 2: AI FALLBACK (If the local scanner couldn't read it)
            if (!barcode) {
                console.log("Local scan failed, handing over to Gemini AI...");
                const base64Image = buffer.toString('base64');
                const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
                
                const prompt = `You are a high-speed retail barcode scanner. Look at this image and extract the exact numerical sequence of the barcode. Return ONLY the numbers, with no spaces, no letters, and no markdown formatting. If you absolutely cannot see or read a barcode, return the exact word 'FAILED'.`;
                
                const result = await model.generateContent([ prompt, { inlineData: { data: base64Image, mimeType: mimeType } } ]);
                const aiResult = result.response.text().trim();

                if (aiResult !== 'FAILED' && /^\d+$/.test(aiResult)) {
                    barcode = aiResult;
                    console.log("Gemini successfully rescued the scan!");
                }
            }

            // 4. FINAL CHECK: Did both systems fail?
            if (!barcode) {
                await sendWhatsApp(cleanPhone, "⚠️ *Scan Failed*\nBoth our fast-scanner and AI couldn't read the barcode. Please ensure the photo is clear, well-lit, and flat. Try again, or type *Exit*.");
                return { handled: true, clearSessionFlag: false };
            }

            // 5. Lookup the Product in the DB
            const product = await prisma.product.findFirst({ 
                where: { barcode: barcode, churchId: member.churchId } 
            });

            if (product) {
                await sendWhatsApp(cleanPhone, `✅ *Product Identified!*\n\n📦 *${product.name}*\n💰 Price: R${product.price.toFixed(2)}\n📊 Current Stock: ${product.stockLevel}\n\n_To add stock, type:_\n*Admin Product Stock ${barcode} 10*\n\n_To bill a client for this, type:_\n*Admin Bill [ID] ${product.price} ${product.name}*`);
            } else {
                await sendWhatsApp(cleanPhone, `⚠️ *Unrecognized Barcode*\n\nScanned Code: *${barcode}*\n\nThis product is not in your inventory. Would you like to add it?\n\n_Copy and paste this to add it:_\n*Admin Product Add [Name] | [Price] | ${barcode}*`);
            }

            return { handled: true, clearSessionFlag: true };

        } catch (error) {
            console.error("Barcode Scan Error:", error);
            await sendWhatsApp(cleanPhone, "❌ System error while scanning. Please try again.");
            return { handled: true, clearSessionFlag: true };
        }
    }

    return { handled: false };
}

module.exports = { processBarcodeScan };