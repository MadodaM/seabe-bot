const { sendWhatsApp } = require('./twilioClient');

// 🧠 THE MASTER KEYWORD DICTIONARY
const VALID_COMMANDS = [
    'menu', 'courses', 'profile', 'join', 'pay', 
    'help', 'support', 'claim', 'appointments', 
    'services', 'next', 'resume', 'exit', 'cancel', 'society'
];

// ==========================================
// 🧮 THE ALGORITHMS (100% Local, No API Needed)
// ==========================================

// STEP 1: HAMMING DISTANCE (Ultra-fast strict length filter)
function getHammingDistance(a, b) {
    if (a.length !== b.length) return Infinity; 
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) distance++;
    }
    return distance;
}

// STEP 2: DAMERAU-LEVENSHTEIN (Catches missing, extra, or flipped letters)
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

            // Check for transposed letters (e.g., c-o-r-s-e-s vs c-o-u-r-s-e-s)
            if (i > 1 && j > 1 && b[i - 1] === a[j - 2] && b[i - 2] === a[j - 1]) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
            }
        }
    }
    return matrix[b.length][a.length];
}

// ==========================================
// 🛟 THE MASTER SUPPORT HANDLER
// ==========================================
async function handleSupportOrTypo(incomingMsg, cleanPhone, orgName) {
    const rawInput = incomingMsg.toLowerCase().trim();
    
    // 🛡️ SAFETY NET: If they typed a perfectly valid command, do not correct them!
    if (VALID_COMMANDS.includes(rawInput)) {
        return { handled: false }; 
    }

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

    // 2. RUN SYNTACTIC CHECKS
    for (const cmd of VALID_COMMANDS) {
        // Step 1: Hamming (Extremely strict, fast filter for exact length typos)
        const hammingDist = getHammingDistance(rawInput, cmd);
        if (hammingDist === 1) {
            candidateCommands.push(cmd);
            continue; 
        }

        // Step 2: Damerau-Levenshtein (Catches missing, extra, or flipped letters)
        const dLevelDist = getDamerauLevenshteinDistance(rawInput, cmd);
        if (dLevelDist <= 2) { // Allow up to 2 typos
            candidateCommands.push(cmd);
        }
    }

    // Remove duplicates
    candidateCommands = [...new Set(candidateCommands)];

    // 3. RESPOND TO THE USER
    if (candidateCommands.length > 0) {
        // We found a highly likely match
        const topGuess = candidateCommands[0];
        
        // Capitalize the first letter for neatness
        const formattedGuess = topGuess.charAt(0).toUpperCase() + topGuess.slice(1);

        const typoMsg = `🤔 I didn't quite catch that. Did you mean to type *${formattedGuess}*?\n\n_Reply with *${formattedGuess}* to continue, or type *Help* to see all options._`;
        await sendWhatsApp(cleanPhone, typoMsg);
        return { handled: true };
    }

    // 4. TOTAL FALLBACK (Complete gibberish or zero matches)
    const fallbackMsg = `⚠️ Oops! I didn't understand that command.\n\nType *Help* to see a list of things I can do, or type *Menu* to start over.`;
    await sendWhatsApp(cleanPhone, fallbackMsg);
    return { handled: true };
}

module.exports = { handleSupportOrTypo };