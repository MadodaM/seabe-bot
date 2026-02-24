// services/aiSupport.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getAISupportReply(incomingMsg, cleanPhone, memberName = "User") {
    try {
        console.log(`🛎️ AI Support triggered for ${cleanPhone}: "${incomingMsg}"`);

        // 1. You can add database logging here later without cluttering index.js
        // await prisma.supportLog.create({ ... })

        // 2. Ask Gemini for the response
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `You are a helpful customer support AI for "Seabe", a platform for African Churches and Burial Societies. 
        The user (${memberName}) just texted: "${incomingMsg}". 
        Keep your response friendly, empathetic, and strictly under 3 sentences. 
        If they seem lost or are asking for a menu, gently instruct them to type exactly 'Hi' for the Church Menu, or 'Society' for the Burial Society Menu.`;

        const result = await model.generateContent(prompt);
        return result.response.text();

    } catch (error) {
        console.error("❌ AI Support Engine Error:", error);
        // Safe fallback if the AI API ever times out
        return "I'm having a little trouble connecting to my support brain right now. Please type 'Hi' or 'Society' to use the main menus, or try asking your question again in a few minutes.";
    }
}

module.exports = { getAISupportReply };