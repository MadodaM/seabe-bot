const { sendWhatsApp } = require('./whatsapp');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 🧠 THE MASTER KEYWORD DICTIONARY
const VALID_COMMANDS = [
    'menu', 'courses', 'profile', 'join', 'pay', 
    'help', 'support', 'claim', 'appointments', 
    'services', 'next', 'resume', 'exit', 'cancel'
];

// Initialize Gemini for Step 3 (Embeddings)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// ==========================================
// 🧮 THE HYBRID ALGORITHMS
// ==========================================

// STEP 1: HAMMING DISTANCE (Ultra-fast strict length filter)
function getHammingDistance(a, b) {
    if (a.length !== b.length) return Infinity; // Only compares exact length words
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) distance++;
    }
    return distance;
}

// STEP 2: DAMERAU-LEVENSHTEIN (Catches transpositions like "taht" -> "that")
function getDamerauLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = a[j - 1] === b[i - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,       // deletion
                matrix[i][j - 1] + 1,       // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );

            // The "Damerau" Magic: Check for transposed letters (e.g., c-u-r-s-e-s vs c-o-u-r-s-e-s)
            if (i > 1 && j > 1 && b[i - 1] === a[j - 2] && b[i - 2] === a[j - 1]) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
            }
        }
    }
    return matrix[b.length][a.length];
}

// STEP 3: COSINE SIMILARITY (Contextual & Semantic matching)
function calculateCosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbedding(text) {
    try {
        const result = await embeddingModel.embedContent(text);
        return result.embedding.values;
    } catch (e) {
        console.error("Embedding Error:", e);
        return null;
    }
}

// ==========================================
// 🛟 THE MASTER SUPPORT HANDLER
// ==========================================
async function handleSupportOrTypo(incomingMsg, cleanPhone, orgName) {
    const rawInput = incomingMsg.toLowerCase().trim();

    // 1. EXPLICIT HELP MENU
    if (rawInput === 'help' || rawInput === 'support' || rawInput === 'agent') {
        const helpMsg = `🛟 *${orgName || 'Seabe'} Support Desk*\n\nHere are the main keywords you can type at any time to navigate:\n\n` +
        `🏠 *Menu* - Go to the main menu\n` +
        `🎓 *Courses* - Open the Academy\n` +
        `👤 *Profile* - View your active details\n` +
        `📅 *Appointments* - See or book a slot\n` +
        `📑 *Claim* - Log a Surepol burial claim\n\n` +
        `_If you ever get stuck, just type *Menu* to start over!_`;
        
        await sendWhatsApp(cleanPhone, helpMsg);
        return { handled: true };
    }

    // Array to hold our best guesses
    let candidateCommands = [];

    // 2. RUN STEP 1 & 2: SYNTACTIC CHECKS (Fast local math)
    for (const cmd of VALID_COMMANDS) {
        // Step 1: Hamming (Extremely strict, fast filter for exact length typos)
        const hammingDist = getHammingDistance(rawInput, cmd);
        if (hammingDist === 1) {
            candidateCommands.push(cmd);
            continue; // Move to next command, we already found a great match
        }

        // Step 2: Damerau-Levenshtein (Catches missing, extra, or flipped letters)
        const dLevelDist = getDamerauLevenshteinDistance(rawInput, cmd);
        if (dLevelDist <= 2) { // Allow up to 2 typos
            candidateCommands.push(cmd);
        }
    }

    // Remove duplicates from our candidates array
    candidateCommands = [...new Set(candidateCommands)];

    // 3. RUN STEP 3: SEMANTIC EMBEDDINGS (If local math failed, or user typed a full sentence)
    // Example: User types "I want to see my classes" -> No typo match, but high semantic match to "courses"
    if (candidateCommands.length === 0 && rawInput.length > 5) {
        
        const userVector = await getEmbedding(rawInput);
        
        if (userVector) {
            let bestSemanticMatch = null;
            let highestSimilarity = 0;

            // Compare the user's sentence against our core commands
            for (const cmd of VALID_COMMANDS) {
                const cmdVector = await getEmbedding(cmd);
                if (cmdVector) {
                    const similarity = calculateCosineSimilarity(userVector, cmdVector);
                    // A cosine similarity > 0.75 usually means strong contextual relation
                    if (similarity > 0.75 && similarity > highestSimilarity) {
                        highestSimilarity = similarity;
                        bestSemanticMatch = cmd;
                    }
                }
            }

            if (bestSemanticMatch) {
                candidateCommands.push(bestSemanticMatch);
            }
        }
    }

    // 4. RESPOND TO THE USER
    if (candidateCommands.length > 0) {
        // If we found exactly one highly likely match, politely ask if that's what they meant
        const topGuess = candidateCommands[0];
        
        // Capitalize the first letter for neatness
        const formattedGuess = topGuess.charAt(0).toUpperCase() + topGuess.slice(1);

        const typoMsg = `🤔 I didn't quite catch that. Did you mean to type *${formattedGuess}*?\n\n_Reply with *${formattedGuess}* to continue, or type *Help* to see all options._`;
        await sendWhatsApp(cleanPhone, typoMsg);
        return { handled: true };
    }

    // 5. TOTAL FALLBACK (Complete gibberish or zero matches)
    const fallbackMsg = `⚠️ Oops! I didn't understand that command.\n\nType *Help* to see a list of things I can do, or type *Menu* to start over.`;
    await sendWhatsApp(cleanPhone, fallbackMsg);
    return { handled: true };
}

module.exports = { handleSupportOrTypo };