// utils/i18n.js

const dictionary = {
    // --- System Messages ---
    'lang_changed': {
        'en': '✅ Language successfully set to English.',
        'zu': '✅ Ulimi luhlelelwe kusiZulu ngempumelelo.',
        'st': '✅ Puo e hlophiselitsoe Sesotho ka katleho.'
    },
    'invalid_choice': {
        'en': '⚠️ Invalid choice. Please reply with a valid number.',
        'zu': '⚠️ Ukukhetha okungavumelekile. Sicela uphendule ngenombolo evumelekile.',
        'st': '⚠️ Kgetho e fosahetseng. Ka kopo araba ka nomoro e nepahetseng.'
    },
    
    // --- Burial Society Main Menu ---
    'society_welcome': {
        'en': 'Welcome to your Burial Society Dashboard',
        'zu': 'Siyakwamukela kudeshibhodi yakho yeNhlangano Yomngcwabo',
        'st': 'Rea u amohela ho Dashboard ea hau ea Mokhatlo oa Lepato'
    },
    'society_menu': {
        'en': '1️⃣ View Policy & Dependents\n2️⃣ Make a Premium Payment\n3️⃣ Log a Death Claim\n4️⃣ Download Statement\n5️⃣ Change Language',
        'zu': '1️⃣ Buka Ipholisi Nabancike Kuwe\n2️⃣ Khokha Imali Yeprimiyamu\n3️⃣ Faka Isicelo Sokushona\n4️⃣ Landa Isitatimende\n5️⃣ Shintsha Ulimi',
        'st': '1️⃣ Sheba Leano le Ba itšetlehileng ka uena\n2️⃣ Etsa Tefo ea Premium\n3️⃣ Kenya Kopo ea Lefu\n4️⃣ Khoasolla Setatemente\n5️⃣ Fetola Puo'
    },
	
	// --- Church Main Menu ---
    'church_menu': {
        'en': '1️⃣ Offering 🎁\n2️⃣ Tithe 🏛️\n3️⃣ Events 🎟️\n4️⃣ Partner 🔁\n5️⃣ News 📰\n6️⃣ Profile 👤\n7️⃣ History 📜\n8️⃣ Discipleship Courses 🎓\n9️⃣ Change Language 🌐\n0️⃣ Go to Lobby 🛡️',
        
        'zu': '1️⃣ Umnikelo 🎁\n2️⃣ Okweshumi 🏛️\n3️⃣ Imicimbi 🎟️\n4️⃣ Ukubambisana 🔁\n5️⃣ Izindaba 📰\n6️⃣ Iphrofayela 👤\n7️⃣ Umlando 📜\n8️⃣ Izifundo 🎓\n9️⃣ Shintsha Ulimi 🌐\n0️⃣ Phuma 🛡️',
        
        'st': '1️⃣ Nyehelo 🎁\n2️⃣ Karolo ea Leshome 🏛️\n3️⃣ Liketsahalo 🎟️\n4️⃣ Tšebelisano 🔁\n5️⃣ Litaba 📰\n6️⃣ Boemo 👤\n7️⃣ Nalane 📜\n8️⃣ Lithuto 🎓\n9️⃣ Fetola Puo 🌐\n0️⃣ Tsoa 🛡️'
    },
};

/**
 * Translates a key into the target language. Falls back to English if missing.
 * @param {string} key - The dictionary key
 * @param {string} lang - The language code ('en', 'zu', 'st')
 * @returns {string}
 */
function t(key, lang = 'en') {
    if (!dictionary[key]) return key; // Fallback to returning the raw key if totally missing
    return dictionary[key][lang] || dictionary[key]['en'];
}

module.exports = { t };