// ==========================================
// VERSION 1.0 - SEABE PLATFORM (STABLE)
// RESTORED ON: 30 JAN 2026
// FEATURES: Payments, Caching, PDF Receipts, Ads
// ==========================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail'); 
const cron = require('node-cron');
const { MessagingResponse } = require('twilio').twiml;
// ⚠️ ENSURE ./services/paystack.js EXISTS
const { createPaymentLink, createSubscriptionLink } = require('./services/paystack');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- CONFIG ---
const ACCOUNT_SID = process.env.TWILIO_SID; 
const AUTH_TOKEN = process.env.TWILIO_AUTH;
const GOOGLE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; 
const GOOGLE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : null;
const SHEET_ID = '1OKVh9Q-Gcs8EjKWIedXa6KM0N-j77JfK_QHaTd0GKQE'; 
const SENDGRID_KEY = process.env.SENDGRID_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;

if (SENDGRID_KEY) sgMail.setApiKey(SENDGRID_KEY);

let client;
try {
    if (ACCOUNT_SID && AUTH_TOKEN) client = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) { console.log("⚠️ Twilio Error"); }

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- 🧠 MEMORY ---
let userSession = {}; 
let cachedChurches = []; 
let cachedAds = [];  
let cachedEvents = []; 

// --- 🔄 DATABASE ENGINE ---
async function getDoc() {
    if (!GOOGLE_EMAIL || !GOOGLE_KEY) throw new Error("Missing Google Credentials");
    const serviceAccountAuth = new JWT({ email: GOOGLE_EMAIL, key: GOOGLE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// Global Refresh Function
async function refreshCache() {
    console.log("🔄 Starting Cache Refresh...");
    try {
        const doc = await getDoc();
        
        // 1. Load Churches
        const churchSheet = doc.sheetsByTitle['Churches'] || doc.sheetsByIndex[2];
        const churchRows = await churchSheet.getRows();
        
        cachedChurches = churchRows.map(row => {
            const name = row.get('Name');
            const code = row.get('Church Code');
            const subaccount = row.get('Subaccount Code'); 
            const email = row.get('Email');

            if (!name || !code) return null;

            return { 
                code: code.trim(), 
                name: name.trim(), 
                email: email ? email.trim() : "", 
                subaccount: subaccount ? subaccount.trim() : null 
            };
        }).filter(c => c !== null);

        // 2. Load Ads
        const adSheet = doc.sheetsByTitle['Ads'] || doc.sheetsByIndex[1];
        if (adSheet) {
            const adRows = await adSheet.getRows();
            cachedAds = adRows.filter(r => r.get('Status') && r.get('Status').trim() === 'Active')
                .map(r => ({
                     target: r.get('Target') ? r.get('Target').trim() : 'Global', 
                     ENGLISH: r.get('English'), ZULU: r.get('Zulu'), SOTHO: r.get('Sotho')
                }));
        }

        // 3. Load Events
        const eventSheet = doc.sheetsByTitle['Events'] || doc.sheetsByIndex[4];
        if (eventSheet) {
            const eventRows = await eventSheet.getRows();
            cachedEvents = eventRows
                .filter(r => r.get('Status') && r.get('Status').trim() === 'Active')
                .map(r => ({
                    churchCode: r.get('Church Code') ? r.get('Church Code').trim() : null,
                    name: r.get('Event Name'),
                    price: r.get('Price'),
                    date: r.get('Date')
                }));
        }
        
        console.log(`♻️ REFRESH COMPLETE: ${cachedChurches.length} Churches, ${cachedEvents.length} Events.`);
        return `Success: Loaded ${cachedChurches.length} Churches`;

    } catch (e) { 
        console.error("❌ CRITICAL CACHE ERROR:", e.message); 
        return `Error: ${e.message}`;
    }
}
refreshCache();
setInterval(refreshCache, 600000); 

// --- 👥 USER MANAGEMENT ---
async function getHeaders(sheet) {
    await sheet.loadHeaderRow();
    const headers = sheet.headerValues;
    const phoneHeader = headers.find(h => h.toLowerCase().includes('phone')) || 'Phone';
    const codeHeader = headers.find(h => h.toLowerCase().includes('code') || h.toLowerCase().includes('church')) || 'Church_Code';
    return { phoneHeader, codeHeader };
}

async function getUserChurch(phone) {
    try {
        const doc = await getDoc();
        const userSheet = doc.sheetsByIndex[3]; 
        const rows = await userSheet.getRows();
        const { phoneHeader, codeHeader } = await getHeaders(userSheet);
        const userRow = rows.find(r => r.get(phoneHeader) === phone);
        return userRow ? userRow.get(codeHeader) : null;
    } catch (e) { return null; }
}

async function registerUser(phone, churchCode) {
    try {
        const doc = await getDoc();
        const userSheet = doc.sheetsByIndex[3]; 
        const { phoneHeader, codeHeader } = await getHeaders(userSheet);
        const rowData = {};
        rowData[phoneHeader] = phone;
        rowData[codeHeader] = churchCode;
        await userSheet.addRow(rowData);
    } catch (e) { console.error("Register Error:", e.message); }
}

async function removeUser(phone) {
    try {
        const doc = await getDoc();
        const userSheet = doc.sheetsByIndex[3]; 
        const rows = await userSheet.getRows();
        const { phoneHeader } = await getHeaders(userSheet);
        const rowToDelete = rows.find(r => r.get(phoneHeader) === phone);
        if (rowToDelete) { await rowToDelete.delete(); }
    } catch (e) { console.error("Remove Error:", e.message); }
}

// --- 📧 REPORTING ---
async function emailReport(churchCode) {
    const church = cachedChurches.find(c => c.code === churchCode);
    if (!church || !church.email) return `❌ Skipped ${churchCode}`;

    const doc = await getDoc();
    const transSheet = doc.sheetsByIndex[0];
    const rows = await transSheet.getRows();
    const churchRows = rows.filter(r => r.get('Church Code') === churchCode);
    
    if (churchRows.length === 0) return `⚠️ ${churchCode}: No transactions.`;

    let csvContent = "Date,Type,Amount,Reference,Phone\n"; 
    churchRows.forEach(row => {
        csvContent += `${row.get('Date')},${row.get('Type')},${row.get('Amount')},${row.get('Reference')},${row.get('Name/Phone')}\n`;
    });

    const attachment = Buffer.from(csvContent).toString('base64');
    const msg = {
        to: church.email,
        from: EMAIL_FROM, 
        subject: `📊 Weekly Report: ${church.name}`,
        text: `Attached is your automated financial report from Seabe Digital.`,
        attachments: [{ content: attachment, filename: `${churchCode}_Report.csv`, type: 'text/csv', disposition: 'attachment' }]
    };

    try { await sgMail.send(msg); return `✅ Sent to ${church.email}`; } 
    catch (error) { return `❌ Failed for ${churchCode}`; }
}

cron.schedule('0 8 * * 1', async () => {
    for (const church of cachedChurches) {
        if (church.code && church.email) await emailReport(church.code);
    }
}, { timezone: "Africa/Johannesburg" });

// --- 📄 PDF FACTORY ---
function generatePDF(type, amount, ref, date, phone, churchName, eventDetail = '') {
    const doc = new PDFDocument({ size: 'A5', margin: 50 });
    const filename = `receipt_${Date.now()}_${phone.slice(-4)}.pdf`;
    const filePath = path.join(__dirname, 'public', 'receipts', filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)){ fs.mkdirSync(dir, { recursive: true }); }
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    
    doc.fontSize(20).text(type === 'TICKET' ? 'ADMIT ONE' : 'RECEIPT', 50, 100, { align: