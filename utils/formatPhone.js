/**
 * Standardizes South African phone numbers to 2783... format
 * @param {string} phone - The raw phone number input (e.g. 083 555 1234)
 * @returns {string|null} - The clean number (e.g. 27835551234) or null if invalid
 */
const formatPhoneNumber = (phone) => {
    if (!phone) return null;

    // 1. Convert to string and strip ALL non-numeric characters (spaces, +, -, (), etc.)
    // "+27 83-123" becomes "2783123"
    let clean = phone.toString().replace(/\D/g, '');

    // 2. Case: Local format (Starts with 0, length 10)
    // "0831234567" -> "27831234567"
    if (clean.length === 10 && clean.startsWith('0')) {
        return '27' + clean.substring(1);
    }

    // 3. Case: International format (Starts with 27, length 11)
    // "27831234567" -> Keep as is
    if (clean.length === 11 && clean.startsWith('27')) {
        return clean;
    }

    // 4. Case: Already correct but maybe had a + sign removed
    // If it is 27... and length 11, it falls into step 3.

    // 5. Invalid/Unknown format
    // If it doesn't match the above, we return null (or the original if you prefer loose validation)
    return null;
};

module.exports = { formatPhoneNumber };