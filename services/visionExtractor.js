// services/visionExtractor.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function extractDataFromImage(imageBuffer, mimeType) {
    try {
        // 🚀 FIXED: Upgraded model to 2.5 to fix the 404 Not Found error
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
        Analyze this image carefully. It is likely a flyer for a Church Event or a Burial Society/Insurance Plan.
        
        Extract the data into a strict JSON structure.
        
        If it is a **POLICY/PLAN** (e.g., Gold Plan, Silver Plan, Burial Scheme), extract:
        {
            "type": "POLICY",
            "items": [
                {
                    "name": "Plan Name",
                    "price": 100,
                    "benefits": ["Benefit 1", "Benefit 2"],
                    "waitingPeriod": "6 months"
                }
            ]
        }
        
        If it is an **EVENT** (e.g., Conference, Service, Concert), extract:
        {
            "type": "EVENT",
            "title": "Event Name",
            "date": "YYYY-MM-DD",
            "time": "HH:MM",
            "location": "Venue Name",
            "price": 0,
            "description": "Short summary"
        }

        RETURN ONLY THE JSON OBJECT. NO MARKDOWN. NO EXPLANATION.
        `;

        const imagePart = {
            inlineData: {
                data: imageBuffer.toString("base64"),
                mimeType: mimeType,
            },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        // 🛡️ HARDENED PARSING: Find the first '{' and last '}' to ignore generic text
        const jsonStartIndex = text.indexOf('{');
        const jsonEndIndex = text.lastIndexOf('}');

        if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            throw new Error("No JSON found in AI response");
        }

        const jsonString = text.substring(jsonStartIndex, jsonEndIndex + 1);
        return JSON.parse(jsonString);

    } catch (error) {
        console.error("AI Vision Error:", error);
        // Return null so the UI knows it failed gracefully
        return null; 
    }
}

module.exports = { extractDataFromImage };