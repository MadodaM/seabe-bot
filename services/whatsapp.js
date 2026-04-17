/**
 * Sends a WhatsApp message with dynamic sender support and chunking.
 */
async function sendWhatsApp(to, body, mediaUrl = null, fromOverride = null) {
    if (!ACCOUNT_SID || !AUTH_TOKEN) {
        console.log("⚠️ Twilio Credentials missing");
        return false;
    }

    try {
        const cleanTo = to.replace('whatsapp:', '').replace('+', '').trim();
        const formattedTo = `whatsapp:+${cleanTo}`;

        // 🧠 TENANT ROUTER: Default to Seabe Digital
        let sender = DEFAULT_FROM; 

        // 🛑 STRICT TENANT OVERRIDE: Route Lwazi traffic to their dedicated number
        if (fromOverride === 'LWAZI' || fromOverride === 'LWAZI_HQ') {
            sender = process.env.LWAZI_WHATSAPP_NUMBER;
            if (!sender) console.log("⚠️ CRITICAL: LWAZI_WHATSAPP_NUMBER is missing from .env!");
        } else if (fromOverride) {
            // Fallback: If a raw phone number was passed instead of a tenant code
            sender = fromOverride;
        }

        // Format the sender correctly for Twilio
        if (!sender.startsWith('whatsapp:')) {
            sender = `whatsapp:${sender.startsWith('+') ? sender : '+' + sender}`;
        }

        const MAX_LENGTH = 1500;
        const messageChunks = [];

        // --- Smart Chunking Logic ---
        if (body.length > MAX_LENGTH) {
            let remainingText = body;
            while (remainingText.length > 0) {
                if (remainingText.length <= MAX_LENGTH) {
                    messageChunks.push(remainingText);
                    break;
                }
                
                let chunk = remainingText.substring(0, MAX_LENGTH);
                let splitIndex = MAX_LENGTH;
                
                let lastDoubleNewline = chunk.lastIndexOf('\n\n');
                let lastNewline = chunk.lastIndexOf('\n');
                let lastSpace = chunk.lastIndexOf(' ');

                if (lastDoubleNewline > MAX_LENGTH - 300) splitIndex = lastDoubleNewline; 
                else if (lastNewline > MAX_LENGTH - 200) splitIndex = lastNewline;       
                else if (lastSpace > MAX_LENGTH - 100) splitIndex = lastSpace;         

                messageChunks.push(remainingText.substring(0, splitIndex).trim());
                remainingText = remainingText.substring(splitIndex).trim();
            }
        } else {
            messageChunks.push(body);
        }

        // --- Send the Chunks ---
        for (const chunk of messageChunks) {
            const messageOptions = {
                from: sender, // 👈 Dynamically routes through the correct Meta number
                to: formattedTo,
                body: chunk
            };
            if (mediaUrl) messageOptions.mediaUrl = [mediaUrl];

            const message = await client.messages.create(messageOptions);
            console.log(`✅ Sent from ${sender} to ${formattedTo} (SID: ${message.sid})`);
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }
        return true;

    } catch (error) {
        console.error("❌ Twilio Send Error:", error.message);
        if (error.code === 63016) {
            console.error("⛔ WINDOW BLOCKED: Attempted to message outside 24h window without template.");
        }
        return false;
    }
}