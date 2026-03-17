// services/aiQuizEvaluator.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PrismaClient } = require('@prisma/client');
const prisma = require('./services/prisma-client');
const { sendWhatsAppMedia } = require('./twilioClient');
const { generateCertificate } = require('./certificateGenerator');

/**
 * AI Quiz Evaluator
 * Grades student responses using Gemini and advances their course progress.
 */
async function evaluateQuiz(incomingMsg, cleanPhone, member, pendingQuiz, sendWhatsApp) {
    try {
        // Find the specific module the user is currently on
        const currentModule = pendingQuiz.course.modules.find(m => m.order === pendingQuiz.progress);
        
        if (!currentModule) {
            throw new Error("Could not find the current module in database.");
        }

        // ==========================================
        // 🔄 NEW: THE RESEND COMMAND
        // ==========================================
        if (incomingMsg === 'resend' || incomingMsg === 'lesson' || incomingMsg === 'help') {
            const lessonMessage = `🔄 *Resending Lesson...*\n\n📖 *${pendingQuiz.course.title}*\nModule ${currentModule.order}: ${currentModule.title}\n\n${currentModule.dailyLessonText}\n\n❓ *Quick Assessment:*\n${currentModule.quizQuestion}\n\n_(Reply with your answer when ready!)_`;
            await sendWhatsApp(cleanPhone, lessonMessage);
            return; // Stop here so Gemini doesn't try to grade the word "resend"
        }

        // ==========================================
        // ⏭️ THE SKIP COMMAND
        // ==========================================
        if (incomingMsg === 'skip') {
            const nextProgress = pendingQuiz.progress + 1;
            const totalModules = pendingQuiz.course.modules.length;
            
            await prisma.enrollment.update({
                where: { id: pendingQuiz.id },
                data: { 
                    progress: nextProgress, 
                    quizState: 'IDLE',
                    ...(nextProgress > totalModules && { status: 'COMPLETED' })
                }
            });

            await sendWhatsApp(cleanPhone, "⏭️ *Quiz Skipped.*\n\nNo problem! Your progress is saved. Your next module is queued up for delivery.");
            return;
        }

        await sendWhatsApp(cleanPhone, "⏳ *AI is reviewing your answer...*");

        // 2. Initialize Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
        
        // 3. The Grading Prompt
        const prompt = `
        You are a friendly and encouraging mentor for a course called "${pendingQuiz.course.title}". 
        Today's lesson was: "${currentModule.title}".
        
        Question asked to student: "${currentModule.quizQuestion}"
        The correct concept/rubric: "${currentModule.quizAnswer}"
        Student's Answer: "${incomingMsg}"
        
        Task:
        1. Determine if the student understood the core concept. They don't need to be perfect, just on the right track conceptually.
        2. If they are correct, congratulate them and add one sentence of additional spiritual/practical encouragement.
        3. If they are incorrect, gently explain the correct idea without being discouraging and ask them to try again.
        
        Return ONLY a raw JSON object (no markdown formatting):
        {"passed": true or false, "feedback": "Your conversational reply to the student."}
        `;
        
        const result = await model.generateContent(prompt);
        const jsonText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const evaluation = JSON.parse(jsonText);

        // 4. Process the AI Result
        if (evaluation.passed) {
            const newProgress = pendingQuiz.progress + 1;
            const totalModules = pendingQuiz.course.modules.length;
            
            if (newProgress > totalModules) {
                // 🎉 COURSE COMPLETION
                await prisma.enrollment.update({
                    where: { id: pendingQuiz.id },
                    data: { status: 'COMPLETED', quizState: 'IDLE', updatedAt: new Date() }
                });
                
                // Send the text congratulation
                await sendWhatsApp(cleanPhone, `🎓 *COURSE COMPLETED!*\n\n${evaluation.feedback}\n\nCongratulations, ${member.firstName}! You have successfully finished the course. Generating your certificate now...`);
                
                // 🎨 Generate and send the Certificate!
                const certUrl = await generateCertificate(member.firstName + " " + member.lastName, pendingQuiz.course.title);
                
                if (certUrl) {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Brief pause for dramatic effect
                    await sendWhatsAppMedia(cleanPhone, `Here is your official certificate for *${pendingQuiz.course.title}*! Feel free to share it. 🌟`, certUrl);
                }
            } else {
                // 📈 LEVEL UP
                await prisma.enrollment.update({
                    where: { id: pendingQuiz.id },
                    data: { progress: newProgress, quizState: 'IDLE', updatedAt: new Date() }
                });
                
                await sendWhatsApp(cleanPhone, `✅ *Well done!*\n\n${evaluation.feedback}\n\nYour progress is saved. Look out for the next lesson soon!`);
            }
        } else {
            // 🔄 RETRY
            await sendWhatsApp(cleanPhone, `💡 *Thinking...*\n\n${evaluation.feedback}\n\n_(Try replying again, type *resend* to read the lesson again, or type *skip* to move on)_`);
        }

    } catch (error) {
        console.error("❌ AI EVALUATOR ERROR:", error);
        await sendWhatsApp(cleanPhone, "⚠️ Sorry, I had a momentary glitch grading that. Please try sending your answer once more!");
    }
}

module.exports = { evaluateQuiz };	