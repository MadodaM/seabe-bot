const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * AI Quiz Evaluator
 * Grades student responses using Gemini and advances their course progress.
 */
async function evaluateQuiz(incomingMsg, cleanPhone, member, pendingQuiz, sendWhatsApp) {
    await sendWhatsApp(cleanPhone, "⏳ *AI is reviewing your answer...*");

    try {
        // Find the specific module the user is currently on
        const currentModule = pendingQuiz.course.modules.find(m => m.order === pendingQuiz.progress);
        
        if (!currentModule) {
            throw new Error("Could not find the current module in database.");
        }

        // 1. Handle Graceful Skip
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

            await sendWhatsApp(cleanPhone, "⏭️ *Quiz Skipped.*\n\nNo problem! Your progress is saved. I'll send you the next lesson tomorrow morning.");
            return;
        }

        // 2. Initialize Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
        
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
                    data: { status: 'COMPLETED', quizState: 'IDLE' }
                });
                
                await sendWhatsApp(cleanPhone, `🎓 *COURSE COMPLETED!*\n\n${evaluation.feedback}\n\nCongratulations, ${member.firstName}! You have successfully finished the course. Keep an eye out for your digital certificate!`);
            } else {
                // 📈 LEVEL UP
                await prisma.enrollment.update({
                    where: { id: pendingQuiz.id },
                    data: { progress: newProgress, quizState: 'IDLE' }
                });
                
                await sendWhatsApp(cleanPhone, `✅ *Well done!*\n\n${evaluation.feedback}\n\nYour progress is saved. Look out for tomorrow's lesson at 07:00 AM!`);
            }
        } else {
            // 🔄 RETRY
            await sendWhatsApp(cleanPhone, `💡 *Thinking...*\n\n${evaluation.feedback}\n\n(Try replying again, or type *skip* to move to the next lesson)`);
        }

    } catch (error) {
        console.error("❌ AI EVALUATOR ERROR:", error);
        await sendWhatsApp(cleanPhone, "⚠️ Sorry, I had a momentary glitch grading that. Please try sending your answer once more!");
    }
}

module.exports = { evaluateQuiz };