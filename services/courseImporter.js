const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PrismaClient } = require('@prisma/client');
const prisma = require('./services/prisma-client');


async function processAndImportCoursePDF(pdfBuffer, mimeType, churchId, price = 0) {
    try {
        console.log("⏳ Sending PDF to Gemini for LMS Extraction...");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `You are an expert Learning Management System (LMS) architect. Read the attached course PDF document. 
        Extract the curriculum and format it for a WhatsApp-based drip-feed learning platform.
        
        Rules for Extraction:
        1. Break the content down into daily modules (e.g., Lesson 1.1 is Day 1, Lesson 1.2 is Day 2).
        2. dailyLessonText: Summarize the lecture content into 3-4 powerful, conversational paragraphs suitable for a WhatsApp message.
        3. quizQuestion: Find or create a single, thought-provoking question based on that specific lesson (use the Assessments section if available).
        4. quizAnswer: Provide the correct answer/rubric that an AI grader can use to verify if the student understood the concept.
        
        Return ONLY a raw JSON object with no markdown formatting. It MUST match this exact structure:
        {
            "courseTitle": "Course Name",
            "courseDescription": "A short summary of the entire course",
            "modules": [
                {
                    "title": "Module 1: Title",
                    "dailyLessonText": "...",
                    "quizQuestion": "...",
                    "quizAnswer": "..."
                }
            ]
        }`;

        const result = await model.generateContent([
            prompt,
            { inlineData: { data: pdfBuffer.toString('base64'), mimeType: mimeType } }
        ]);

        const jsonText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const extractedData = JSON.parse(jsonText);

        console.log(`✅ AI Extracted Course: ${extractedData.courseTitle} with ${extractedData.modules.length} modules.`);

        // 💾 Save to Prisma Database
        const newCourse = await prisma.course.create({
            data: {
                churchId: parseInt(churchId),
                title: extractedData.courseTitle,
                description: extractedData.courseDescription,
                price: parseFloat(price),
                modules: {
                    create: extractedData.modules.map((mod, index) => ({
                        title: mod.title,
                        dailyLessonText: mod.dailyLessonText,
                        quizQuestion: mod.quizQuestion,
                        quizAnswer: mod.quizAnswer,
                        order: index + 1, // Day 1, Day 2, etc.
                        contentUrl: "" // Optional: Link to the original PDF
                    }))
                }
            },
            include: { modules: true }
        });

        return { success: true, course: newCourse };

    } catch (error) {
        console.error("❌ Course Import Error:", error);
        return { success: false, error: error.message };
    }
}

module.exports = { processAndImportCoursePDF };