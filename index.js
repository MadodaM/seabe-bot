require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { createPaymentLink } = require('./services/stitch');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- 1. THE DICTIONARY (TRANSLATIONS) ---
const TRANSLATIONS = {
    'ENGLISH': {
        welcome: "Welcome to Seabe! 🇿🇦\n\nChoose your language:\n*1.* English\n*2.* isiZulu\n*3.* Sesotho",
        menu: "Welcome! 👋\nReply with a number:\n*1.* General Offering 🎁\n*2.* Pay Tithe (10%) 🏛️",
        ask_offering: "Amen! 🎁\nHow much is your *Offering*? (e.g. R100)",
        ask_tithe: "Bringing the full tithe. 🏛️\nEnter amount: (e.g. R500)",
        receipt_text: "Payment Received! Thank you for your generosity.",
        click_to_pay: "Tap to pay"
    },
    'ZULU': {
        // We reuse the English welcome just for the language selection step
        menu: "Siyakwamukela! 👋\nPhendula ngenombolo:\n*1.* Umnikelo Jikelele 🎁\n*2.* Okweshumi (10%) 🏛️",
        ask_offering: "Amen! 🎁\nUngakanani *Umnikelo* wakho? (isib. R100)",
        ask_tithe: "Ukuletha okweshumi okuphelele. 🏛️\nFaka inani: (isib. R500)",
        receipt_text: "Inkokhelo Yamukelwe! Siyabonga ngokupha kwakho.",
        click_to_pay: "Cindezela ukukhokha"
    },
    'SOTHO': {
        menu: "Re a o amohela! 👋\nAraba ka nomoro:\n*1.* Nyehelo 🎁\n*2.* Boshome (10%) 🏛️",
        ask_offering: "Amen! 🎁\nKe bokae *Nyehelo* ea hau? (mohl. R100)",
        ask_tithe: "O tlisa boshome bo feletseng. 🏛️\nKenya chelete: (mohl. R500)",
        receipt_text: "Tefo e amoheletsoe! Re leboha seatla sa hau se bulehileng.",
        click_to_pay: "Tobetsa ho lefa"
    }
};

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_KEY = process.env.GOOGLE_KEY ? process.env.GOOGLE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = process.env.SHEET_ID;

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Error"); }

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// We store { step: 'MENU', language: 'ENGLISH' } for each phone number
let userSession = {}; 

async function logToSheet(phone, type, amount, ref) {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY || !SHEET_ID) return;
    try {
        const serviceAccountAuth = new JWT({
            email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
        await doc.loadInfo(); 
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({ Date: new Date().toLocaleString(), "Name/Phone": phone, "Type": type, "Amount": amount, "Reference": ref });
        console.log("📝 Row added to Sheet!");
    } catch (error) { console.error("❌ Sheet Error:", error.message); }
}

// --- WHATSAPP BOT ---
app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body.trim().toLowerCase(); 
    const sender = req.body.From; 
    const cleanPhone = sender.replace('whatsapp:', '');
    const twiml = new MessagingResponse();
    
    // Default to English if we don't know the user yet
    let userLang = userSession[cleanPhone]?.language || 'ENGLISH';
    let reply = "";

    // 1. START / RESET
    if (['hi', 'hello', 'dumela', 'sawubona', 'menu'].includes(incomingMsg)) {
        // Show Language Menu (Always in English mixed with others so they can read it)
        reply = TRANSLATIONS['ENGLISH'].welcome;
        userSession[cleanPhone] = { step: 'LANG_SELECT', language: 'ENGLISH' };
    } 
    
    // 2. LANGUAGE SELECTION
    else if (userSession[cleanPhone]?.step === 'LANG_SELECT') {
        if (incomingMsg === '1') userLang = 'ENGLISH';
        else if (incomingMsg === '2') userLang = 'ZULU';
        else if (incomingMsg === '3') userLang = 'SOTHO';
        
        // Save the language preference
        userSession[cleanPhone] = { step: 'PAYMENT_SELECT', language: userLang };
        reply = TRANSLATIONS[userLang].menu;
    }

    // 3. PAYMENT TYPE SELECTION
    else if (userSession[cleanPhone]?.step === 'PAYMENT_SELECT' && ['1', '2'].includes(incomingMsg)) {
        const paymentType = incomingMsg === '1' ? 'OFFERING' : 'TITHE';
        
        // Save payment type, keep language
        userSession[cleanPhone].paymentType = paymentType;
        userSession[cleanPhone].step = 'AMOUNT_INPUT';
        
        // Ask for amount in the correct language
        if (paymentType === 'OFFERING') reply = TRANSLATIONS[userLang].ask_offering;
        else reply = TRANSLATIONS[userLang].ask_tithe;
    }

    // 4. AMOUNT & LINK
    else if (incomingMsg.match(/R?\d+/)) {
        const amount = incomingMsg.replace(/\D/g,''); 
        const paymentType = userSession[cleanPhone]?.paymentType || 'OFFERING';
        const churchRef = `${paymentType}-${cleanPhone.slice(-4)}`;
        const compoundRef = `${cleanPhone}__${churchRef}`;

        const paymentUrl = await createPaymentLink(amount + ".00", compoundRef); 
        
        // Use translated text for the link message
        const clickText = TRANSLATIONS[userLang].click_to_pay;
        reply = `${clickText} R${amount}:\n👉 ${paymentUrl}`;
        
        // Clear session but maybe keep language preference for next time? 
        // For now we clear to keep it simple.
        delete userSession[cleanPhone];

        if (client) {
            setTimeout(async () => {
                try {
                    // Send Receipt in the user's language
                    const receiptMsg = TRANSLATIONS[userLang].receipt_text;
                    await client.messages.create({
                        from: 'whatsapp:+14155238886', to: sender,
                        body: `🎉 *Seabe* \n\n${receiptMsg} \n(R${amount} - ${churchRef}) 🙏`
                    });
                } catch (err) { console.error("❌ Receipt Failed"); }
                await logToSheet(cleanPhone, paymentType, amount, churchRef);
            }, 15000); 
        }
    }
    else { 
        reply = `Sorry, reply with *Hi* to start over. \nUxolo, phendula ngo *Hi* ukuze uqale phansi.`; 
    }

    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
});

app.post('/stitch-webhook', (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Seabe Bot running on ${PORT}`));