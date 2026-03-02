const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function evaluateQuiz(incomingMsg, cleanPhone, member, pendingQuiz, sendWhatsApp) {
    await sendWhatsApp(cleanPhone, "⏳ *Evaluating your answer...*");

    try {
        const currentModule = pendingQuiz.course.modules.find(m => m.order === pendingQuiz.progress);
        
        // 1. Let them gracefully skip if they are stuck
        if (incomingMsg === 'skip') {
            await prisma.enrollment.update({
                where: { id: pendingQuiz.id },
                data: { progress: pendingQuiz.progress + 1, quizState: 'IDLE' }
            });
            await sendWhatsApp(cleanPhone, "⏭️ Quiz skipped. Your progress is saved, and I'll send you the next module tomorrow morning!");
            return;
        }

        // 2. Call Gemini AI for grading
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
        
        const prompt = `You are a friendly, encouraging mentor grading a daily WhatsApp check-in for a course titled "${pendingQuiz.course.title}".
        Question asked: "${currentModule.quizQuestion}"
        Correct Answer/Rubric: "${currentModule.quizAnswer}"
        Student's Answer: "${incomingMsg}"
        
        Did the student grasp the core concept? It does not need to be perfectly worded, just conceptually on the right track.
        Return ONLY a JSON object with this format:
        {"passed": true or false, "feedback": "Your conversational, empathetic reply. If they passed, congratulate them and add a brief encouraging thought based on the lesson. If they failed, gently explain the correct concept and ask them to try again."}`;
        
        const result = await model.generateContent(prompt);
        const jsonText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const evaluation = JSON.parse(jsonText);

        // 3. Process the Result
        if (evaluation.passed) {
            const newProgress = pendingQuiz.progress + 1;
            const totalModules = pendingQuiz.course.modules.length;
            
            if (newProgress > totalModules) {
                // 🎓 Course Completed!
                await prisma.enrollment.update({
                    where: { id: pendingQuiz.id },
                    data: { status: 'COMPLETED', quizState: 'IDLE' }
                });
                await sendWhatsApp(cleanPhone, `🎓 *COURSE COMPLETED!*\n\n${evaluation.feedback}\n\nAmazing job, ${member.firstName}! You have successfully finished *${pendingQuiz.course.title}*. We are generating your official digital certificate, which will be available in your profile soon!`);
            } else {
                // 📅 Next Day Ready
                await prisma.enrollment.update({
                    where: { id: pendingQuiz.id },
                    data: { progress: newProgress, quizState: 'IDLE' }
                });
                await sendWhatsApp(cleanPhone, `✅ *Spot on!*\n\n${evaluation.feedback}\n\nYour progress has been saved. Look out for your next lesson tomorrow at 07:00 AM!`);
            }
        } else {
            // 🔄 Try Again
            await sendWhatsApp(cleanPhone, `💡 *Almost there!*\n\n${evaluation.feedback}\n\n(Reply with your new answer, or type *skip* to move to tomorrow's lesson)`);
        }
    } catch (error) {
        console.error("AI Quiz Evaluation Error:", error);
        await sendWhatsApp(cleanPhone, "⚠️ Whoops! My grading brain had a tiny glitch. Please resend your answer.");
    }
}

module.exports = { evaluateQuiz };