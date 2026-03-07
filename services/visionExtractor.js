// services/visionExtractor.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function extractDataFromImage(imageBuffer, mimeType) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
        Analyze this image carefully. It is likely a flyer for a Church Event or a Burial Society/Insurance Plan.
        
        Extract the data into a strict JSON structure.
        
        If it is a **POLICY/PLAN** (e.g., Gold Plan, Silver Plan, Burial Scheme), extract:
        - type: "POLICY"
        - items: An array of plans found in the image. Each item must have:
            - name: (e.g., "Gold Plan")
            - price: (Numeric amount only, e.g., 100)
            - benefits: (An array of strings listing the benefits)
            - waitingPeriod: (If mentioned)
        
        If it is an **EVENT** (e.g., Conference, Service, Concert), extract:
        - type: "EVENT"
        - title: (Event name)
        - date: (Date string)
        - time: (Time string)
        - location: (Address or Venue)
        - price: (Ticket price if applicable)
        - description: (Short summary)

        If strictly JSON, no markdown formatting.
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

        // Clean up markdown if Gemini adds it
        const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(jsonString);

    } catch (error) {
        console.error("AI Vision Error:", error);
        return { success: false, error: error.message };
    }
}

module.exports = { extractDataFromImage };