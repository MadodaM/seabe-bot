// routes/web.js
// PURPOSE: Public Website (Home, Register, Demo, Terms)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // --- BRANDED EMAIL HELPERS ---
    const emailStyle = "font-family: 'Inter', -apple-system, sans-serif; color: #333; line-height: 1.6;";
    const headerStyle = "background-color: #1e272e; color: #ffffff; padding: 30px; text-align: center; border-bottom: 4px solid #00d2d3;";
    const btnStyle = "display: inline-block; background-color: #00d2d3; color: #ffffff; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 6px; margin-top: 20px;";

    // --- SHARED TAILWIND HEADER ---
    const tailwindHeader = `
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            tailwind.config = {
                theme: { extend: { colors: { brand: { navy: '#1e272e', teal: '#00d2d3', light: '#f4f7f6', accent: '#0984e3' } } } }
            }
        </script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>body { font-family: 'Inter', sans-serif; }</style>
    `;

    // ==========================================
    // 1. PUBLIC HOMEPAGE (Serves the new UI)
    // ==========================================
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // ==========================================
    // 2. REGISTRATION PAGE
    // ==========================================
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Register | Seabe.tech</title>
                ${tailwindHeader}
            </head>
            <body class="bg-brand-light min-h-screen flex flex-col items-center justify-center p-4">
                
                <div class="mb-6 flex items-center gap-2">
                    <div class="w-8 h-8 bg-brand-teal rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg">S</div>
                    <span class="font-extrabold text-2xl tracking-tight text-brand-navy">Seabe<span class="text-brand-teal">.tech</span></span>
                </div>

                <div class="bg-white p-8 md:p-10 rounded-2xl shadow-xl w-full max-w-lg border border-gray-100">
                    <h2 class="text-2xl font-extrabold text-brand-navy text-center mb-2">Register Your Organization</h2>
                    <p class="text-center text-gray-500 text-sm mb-8">Complete KYC to activate automated operations.</p>
                    
                    <form id="kybRegistrationForm" enctype="multipart/form-data" class="space-y-5">
                        
                        <div>
                            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Organization Name</label>
                            <input type="text" id="churchName" name="churchName" required placeholder="e.g., Thuso Burial Society" class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-teal outline-none transition bg-gray-50 focus:bg-white">
                        </div>
                        
                        <div>
                            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Official Email</label>
                            <input type="email" id="officialEmail" name="officialEmail" required placeholder="admin@society.co.za" class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-teal outline-none transition bg-gray-50 focus:bg-white">
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Organization Type</label>
                            <select id="orgType" name="type" required class="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-teal outline-none transition bg-gray-50 focus:bg-white">
                                <option value="BURIAL_SOCIETY">Burial Society / Funeral Parlour</option>
                                <option value="CHURCH">Church</option>
                                <option value="NON_PROFIT">Non-Profit (NGO)</option>
                            </select>
                        </div>

                        <div class="pt-4 border-t border-gray-100">
                            <h4 class="font-bold text-brand-navy flex items-center gap-2"><span class="text-brand-teal">🛡️</span> Level 1 Verification</h4>
                            <p class="text-xs text-gray-500 mb-4 mt-1">To comply with SA financial regulations, upload the primary leader's ID and a recent proof of bank account.</p>

                            <div class="mb-4">
                                <label class="block text-xs font-bold text-gray-700 mb-1">Upload Leader ID (Green Book or Smart Card)</label>
                                <input type="file" id="pastorId" name="pastorId" accept="image/*,.pdf" required class="w-full p-2 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-sm">
                            </div>

                            <div class="mb-4">
                                <label class="block text-xs font-bold text-gray-700 mb-1">Proof of Bank Account (Letter or Statement)</label>
                                <input type="file" id="proofOfBank" name="proofOfBank" accept="image/*,.pdf" required class="w-full p-2 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-sm">
                            </div>
                        </div>

                        <div class="flex items-start gap-3 mt-4">
                            <input type="checkbox" id="tos" required class="mt-1 w-4 h-4 text-brand-teal rounded border-gray-300 focus:ring-brand-teal"> 
                            <span class="text-sm text-gray-600">I accept the <a href="/terms" target="_blank" class="text-brand-teal font-semibold hover:underline">Master Service Agreement</a>.</span>
                        </div>

                        <div id="regError" class="hidden bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold text-center"></div>
                        <div id="regSuccess" class="hidden bg-green-50 text-green-700 p-3 rounded-lg text-sm font-bold text-center"></div>

                        <button type="submit" id="submitBtn" class="w-full bg-brand-navy text-white font-bold py-4 rounded-lg hover:bg-gray-800 transition shadow-lg mt-4">
                            Submit FICA & Register
                        </button>
                    </form>
                    <p class="text-center mt-6"><a href="/" class="text-gray-400 hover:text-gray-600 text-sm font-semibold transition">← Cancel and return home</a></p>
                </div>

                <script>
                document.getElementById('kybRegistrationForm').addEventListener('submit', async (e) => {
                    e.preventDefault(); 
                    
                    const btn = document.getElementById('submitBtn');
                    const errorBox = document.getElementById('regError');
                    const successBox = document.getElementById('regSuccess');
                    
                    btn.innerText = "⏳ Uploading & Verifying...";
                    btn.disabled = true;
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                    errorBox.classList.add('hidden');
                    successBox.classList.add('hidden');

                    const formData = new FormData();
                    formData.append('churchName', document.getElementById('churchName').value);
                    formData.append('officialEmail', document.getElementById('officialEmail').value);
                    formData.append('type', document.getElementById('orgType').value);
                    formData.append('pastorId', document.getElementById('pastorId').files[0]);
                    formData.append('proofOfBank', document.getElementById('proofOfBank').files[0]);

                    try {
                        const response = await fetch('/api/prospect/register-church', {
                            method: 'POST',
                            body: formData 
                        });

                        const data = await response.json();

                        if (!response.ok) throw new Error(data.error || "Failed to process registration.");

                        successBox.innerText = "✅ " + data.message + " (AI Confidence: " + (data.aiExtractedData?.confidenceScore || 'High') + "%)";
                        successBox.classList.remove('hidden');
                        document.getElementById('kybRegistrationForm').reset();
                        btn.innerText = "Registration Complete";
                        
                    } catch (error) {
                        errorBox.innerText = "❌ " + error.message;
                        errorBox.classList.remove('hidden');
                        btn.innerText = "Submit FICA & Register";
                        btn.disabled = false;
                        btn.classList.remove('opacity-50', 'cursor-not-allowed');
                    }
                });
                </script>
            </body>
            </html>
        `);
    });

    // FALLBACK REGISTRATION ROUTE 
    app.post('/register-church', upload.fields([{ name: 'idDoc', maxCount: 1 }, { name: 'bankDoc', maxCount: 1 }]), async (req, res) => {
        const { churchName, email, tos, type } = req.body;
        if (!tos) return res.send("⚠️ You must accept the Master Service Agreement.");

        try {
            const attachments = []; const filePathsToDelete = [];
            const processFile = (fieldName, prefix) => {
                if (req.files[fieldName]) {
                    const f = req.files[fieldName][0];
                    attachments.push({ content: fs.readFileSync(f.path).toString('base64'), filename: `${prefix}_${churchName.replace(/[^a-zA-Z0-9]/g,'_')}_${f.originalname}`, type: f.mimetype, disposition: 'attachment' });
                    filePathsToDelete.push(f.path);
                }
            };
            processFile('idDoc', 'ID'); processFile('bankDoc', 'BANK');

            const prefix = churchName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
            const newCode = `${prefix}${Math.floor(100 + Math.random() * 900)}`;
            
            await prisma.church.create({ 
                data: { 
                    name: churchName, code: newCode, email: email, subaccountCode: 'PENDING_KYC', 
                    tosAcceptedAt: new Date(), type: type || 'CHURCH' 
                } 
            });

            if (process.env.SENDGRID_KEY) {
                await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `📝 NEW APPLICATION: ${churchName}`, html: `<h2>New Application</h2><p>Name: ${churchName}</p><p>Email: ${email}</p>`, attachments: attachments });
                await sgMail.send({
                    to: email, from: EMAIL_FROM, subject: 'Application Received | Seabe Digital',
                    html: `
                        <div style="${emailStyle}">
                            <div style="${headerStyle}"><h1 style="margin:0;">SEABE.</h1><p>Operating System for Africa</p></div>
                            <div style="padding: 30px; background: #fff;">
                                <h2>Registration Received</h2>
                                <p>Thank you for registering <strong>${churchName}</strong>. Our compliance team is reviewing your documents (24-48 hours).</p>
                                <p>Once approved, you will receive your unique Admin Code.</p>
                                <a href="https://seabe.tech/terms" style="${btnStyle}">View Terms</a>
                            </div>
                        </div>`
                });
            }
            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });
            
            res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px; color:#1e272e;"><h1>🎉 Application Received</h1><p>Confirmation sent to <strong>${email}</strong>.</p><a href="/" style="color:#00d2d3;">Return Home</a></div>`);
        } catch (e) { res.send("<h1>Error</h1><p>Please try again.</p>"); }
    });

    // ==========================================
    // 3. LEVEL 2 FICA UPLOAD PORTAL
    // ==========================================
    app.get('/kyb-upload/:code', async (req, res) => {
        const { code } = req.params;

        try {
            const church = await prisma.church.findUnique({ where: { code } });

            if (!church) return res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px;"><h2>❌ Invalid Link</h2><p>This organization could not be found.</p></div>`);
            if (church.ficaStatus === 'LEVEL_2_PENDING' || church.ficaStatus === 'ACTIVE') return res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px; color:#27ae60;"><h2>✅ Documents Under Verification</h2><p>Your corporate documents have been successfully received and are currently being reviewed by our compliance team. <strong>Please wait for feedback via email.</strong></p></div>`);
            if (church.ficaStatus === 'LEVEL_1_PENDING') return res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px; color:#e67e22;"><h2>⏳ Pending Level 1</h2><p>Your initial registration is still being reviewed. You will receive an email when it's time to upload corporate documents.</p></div>`);

            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Corporate Docs | Seabe.tech</title>
                    ${tailwindHeader}
                </head>
                <body class="bg-brand-light min-h-screen flex flex-col items-center justify-center p-4">
                    
                    <div class="bg-white p-8 md:p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
                        <h2 class="text-2xl font-extrabold text-brand-navy text-center mb-2">Corporate Verification</h2>
                        <div class="bg-teal-50 text-teal-800 text-center py-1.5 px-3 rounded-full text-xs font-bold tracking-wide w-max mx-auto mb-6">
                            ${church.name} (${church.code})
                        </div>
                        <p class="text-center text-gray-500 text-sm mb-8">Please upload your official registration documents to activate your payment collections account.</p>
                        
                        <form id="level2UploadForm" enctype="multipart/form-data" class="space-y-5">
                            
                            <div>
                                <label class="block text-sm font-bold text-gray-800 mb-1">1. NPC / NPO Registration Certificate</label>
                                <p class="text-xs text-gray-500 mb-2">Official certificate showing your non-profit status.</p>
                                <input type="file" id="npcReg" name="npcReg" accept="image/*,.pdf" required class="w-full p-2 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-sm">
                            </div>

                            <div>
                                <label class="block text-sm font-bold text-gray-800 mb-1">2. CIPC Registration Document</label>
                                <p class="text-xs text-gray-500 mb-2">COR14.3 or equivalent showing enterprise details.</p>
                                <input type="file" id="cipcDoc" name="cipcDoc" accept="image/*,.pdf" required class="w-full p-2 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-sm">
                            </div>

                            <div>
                                <label class="block text-sm font-bold text-gray-800 mb-1">3. Director / Board Member IDs</label>
                                <p class="text-xs text-gray-500 mb-2">Merge IDs into a single PDF, or upload the primary director's ID.</p>
                                <input type="file" id="directorIds" name="directorIds" accept="image/*,.pdf" required class="w-full p-2 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-sm">
                            </div>

                            <div id="uploadError" class="hidden bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold text-center"></div>
                            <div id="uploadSuccess" class="hidden bg-green-50 text-green-700 p-4 rounded-lg text-sm text-center"></div>

                            <button type="submit" id="submitDocsBtn" class="w-full bg-brand-navy text-white font-bold py-4 rounded-lg hover:bg-gray-800 transition shadow-lg mt-4">
                                Securely Upload Documents
                            </button>
                        </form>
                    </div>

                    <script>
                    document.getElementById('level2UploadForm').addEventListener('submit', async (e) => {
                        e.preventDefault(); 
                        
                        const btn = document.getElementById('submitDocsBtn');
                        const errorBox = document.getElementById('uploadError');
                        const successBox = document.getElementById('uploadSuccess');
                        
                        btn.innerText = "⏳ Vaulting Documents securely...";
                        btn.disabled = true;
                        btn.classList.add('opacity-50');
                        errorBox.classList.add('hidden');

                        const formData = new FormData();
                        formData.append('npcReg', document.getElementById('npcReg').files[0]);
                        formData.append('cipcDoc', document.getElementById('cipcDoc').files[0]);
                        formData.append('directorIds', document.getElementById('directorIds').files[0]);

                        try {
                            const response = await fetch(\`/api/prospect/upload-level-2/${church.code}\`, {
                                method: 'POST',
                                body: formData 
                            });

                            const data = await response.json();

                            if (!response.ok) throw new Error(data.error || "Failed to upload documents.");

                            successBox.innerHTML = "✅ <strong>Upload Complete!</strong><br>Your documents have been encrypted and saved. Our team will finalize your account shortly.";
                            successBox.classList.remove('hidden');
                            document.getElementById('level2UploadForm').style.display = 'none'; 
                            
                        } catch (error) {
                            errorBox.innerText = "❌ " + error.message;
                            errorBox.classList.remove('hidden');
                            btn.innerText = "Securely Upload Documents";
                            btn.disabled = false;
                            btn.classList.remove('opacity-50');
                        }
                    });
                    </script>
                </body>
                </html>
            `);

        } catch (error) {
            res.send("<h2>System Error</h2><p>Could not load the verification portal.</p>");
        }
    }); 

    // ==========================================
    // 4. DEMO PAGE
    // ==========================================
    app.get('/demo', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Book Demo | Seabe.tech</title>
                ${tailwindHeader}
            </head>
            <body class="bg-brand-light min-h-screen flex flex-col items-center justify-center p-4">
                
                <div class="bg-white p-8 md:p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
                    <h2 class="text-3xl font-extrabold text-brand-navy text-center mb-2">Book a Demo</h2>
                    <p class="text-center text-gray-500 mb-8">See how Seabe can transform your administration.</p>
                    
                    <form action="/request-demo" method="POST" class="space-y-4">
                        <div>
                            <input name="firstname" placeholder="Your Name" required class="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-teal outline-none transition bg-gray-50 focus:bg-white">
                        </div>
                        <div>
                            <input name="email" placeholder="Email Address" required type="email" class="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-teal outline-none transition bg-gray-50 focus:bg-white">
                        </div>
                        <div>
                            <input name="phone" placeholder="WhatsApp Number" required class="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-teal outline-none transition bg-gray-50 focus:bg-white">
                        </div>
                        <button type="submit" class="w-full bg-brand-teal text-white font-bold text-lg py-4 rounded-lg hover:bg-teal-400 transition shadow-lg shadow-teal-100 mt-2">
                            Request Demo
                        </button>
                    </form>
                    <p class="text-center mt-6"><a href="/" class="text-gray-400 hover:text-gray-600 text-sm font-semibold transition">← Back to website</a></p>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/request-demo', upload.none(), async (req, res) => {
        const { firstname, email, phone } = req.body;
        await syncToHubSpot({ name: firstname, email: email, phone: phone });
        
        if (process.env.SENDGRID_KEY) {
            await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `🔥 LEAD: ${firstname}`, html: `<p>New Lead: ${firstname} (${email})</p>` });
            await sgMail.send({
                to: email, from: EMAIL_FROM, subject: 'Seabe Demo Request',
                html: `
                    <div style="${emailStyle}">
                        <div style="${headerStyle}"><h1 style="margin:0;">SEABE.</h1><p>Premium Stewardship</p></div>
                        <div style="padding: 30px; background: #fff;">
                            <h2>Hi ${firstname},</h2>
                            <p>We received your request. A setup manager will contact you via WhatsApp shortly to coordinate your demo.</p>
                        </div>
                    </div>`
            });
        }
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><title>Success</title>${tailwindHeader}</head>
            <body class="bg-brand-light min-h-screen flex items-center justify-center p-4">
                <div class="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md text-center">
                    <div class="text-5xl mb-4">✅</div>
                    <h1 class="text-2xl font-bold text-brand-navy mb-2">Request Received</h1>
                    <p class="text-gray-500 mb-6">Check your email for confirmation.</p>
                    <a href="/" class="bg-brand-navy text-white px-6 py-2 rounded-lg font-bold hover:bg-gray-800 transition">Return Home</a>
                </div>
            </body>
            </html>
        `);
    });

    // ==========================================
    // 5. TERMS OF SERVICE
    // ==========================================
    app.get('/terms', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Master Service Agreement | Seabe</title>
                ${tailwindHeader}
            </head>
            <body class="bg-white text-gray-800 antialiased p-6 md:p-12">
                <div class="max-w-3xl mx-auto">
                    <h1 class="text-4xl font-extrabold text-brand-navy border-b-4 border-brand-teal pb-4 mb-2">Master Service Agreement</h1>
                    <p class="text-gray-500 text-sm font-bold mb-10">Last Updated: March 2026</p>

                    <div class="space-y-8 text-gray-600 leading-relaxed">
                        <p>Welcome to Seabe Digital ("Seabe," "we," "us," or "our"). By accessing or using our WhatsApp-based payment and management platform (the "Service"), you agree to be bound by these Terms of Service ("Terms").</p>

                        <div>
                            <h2 class="text-2xl font-bold text-brand-navy mb-2">1. Description of Service</h2>
                            <p>Seabe provides a technology platform that facilitates policy collections, quoting, and CRM management for Burial Societies, Funeral Parlours, and non-profit organizations via WhatsApp and web portals. Seabe is not a bank, and we do not hold funds. We act as a technical intermediary.</p>
                        </div>

                        <div>
                            <h2 class="text-2xl font-bold text-brand-navy mb-2">2. Payments & Processing</h2>
                            <p>All financial transactions are processed by <strong>NetCash / Ozow / Paystack</strong>, registered Payment Service Providers. By making a payment, you agree to their terms and conditions. Seabe does not store your full card or banking details.</p>
                        </div>

                        <div class="bg-gray-50 p-6 rounded-xl border border-gray-200">
                            <h2 class="text-xl font-bold text-brand-navy mb-3">3. Refund Policy</h2>
                            <p class="mb-2"><strong>Premiums & Tithes:</strong> These are generally non-refundable. If you made an error in the amount, please contact your Organization Administrator immediately.</p>
                            <p><strong>Disputes:</strong> If you believe a transaction was fraudulent, please contact us at <a href="mailto:madoda@seabe.co.za" class="text-brand-teal font-bold hover:underline">madoda@seabe.co.za</a>.</p>
                        </div>

                        <div>
                            <h2 class="text-2xl font-bold text-brand-navy mb-2">4. User Account Security</h2>
                            <p>You are responsible for maintaining the security of your WhatsApp account. Seabe is not liable for any loss or damage arising from unauthorized access to your WhatsApp account or phone.</p>
                        </div>
                    </div>

                    <div class="mt-12 pt-8 border-t border-gray-200 text-center">
                        <p class="text-sm text-gray-400 mb-4">&copy; 2026 Seabe Technologies. All rights reserved.</p>
                        <a href="/" class="text-brand-teal font-bold hover:underline">&larr; Return to Home</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    });

    app.post('/payment-success', (req, res) => res.send("<h1>Payment Successful! 🎉</h1>"));

    // GET: Ozow Sandbox Preview Page
    app.get('/ozow-sandbox-preview', (req, res) => {
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Seabe Digital | Ozow Integration Preview</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; color: #2d3748; line-height: 1.6; margin: 0; padding: 20px; }
                .container { max-width: 700px; margin: 40px auto; padding: 40px; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
                .header { text-align: center; margin-bottom: 30px; }
                .badge { display: inline-block; background-color: #e6fffa; color: #319795; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 700; margin-bottom: 15px; }
                .message-box { background-color: #ebf8ff; border-left: 4px solid #3182ce; padding: 20px 25px; border-radius: 0 8px 8px 0; margin-bottom: 35px; }
                .message-box p { margin: 0; font-size: 1.1em; color: #2b6cb0; font-weight: 500; }
                .specs-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 30px; background: #f8fafc; }
                .specs-title { font-size: 1.25em; font-weight: 700; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 20px; color: #1a202c; }
                ul { list-style-type: none; padding: 0; margin: 0; }
                li { margin-bottom: 16px; font-size: 0.95em; }
                .bullet-list { padding-left: 20px; margin-top: 10px; list-style-type: disc; color: #718096; }
                .bullet-list li { margin-bottom: 8px; }
                strong { color: #2d3748; font-weight: 600; }
                code { background: #edf2f7; padding: 3px 6px; border-radius: 4px; font-family: monospace; color: #e53e3e; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <span class="badge">SANDBOX ENVIRONMENT</span>
                    <h1 style="margin: 0; font-size: 1.8em; color: #1a202c;">Ozow Payment Gateway</h1>
                    <p style="color: #718096; margin-top: 5px;">Seabe Digital Interceptor</p>
                </div>
                <div class="message-box">
                    <p>Seabe Digital is currently moving into the Ozow Production Environment. This link represents the point where our API will trigger your secure Ozow PIN/Capitec Pay interface.</p>
                </div>
                <div class="specs-box">
                    <h2 class="specs-title">Technical Integration Specs (Draft v1.1)</h2>
                    <p style="margin-bottom: 20px; color: #4a5568;">Seabe Digital is prepared to consume the Ozow REST API with the following implementation logic:</p>
                    <ul>
                        <li><strong>Endpoint Target:</strong> <code>POST /post-payment/</code></li>
                        <li><strong>Authentication:</strong> Hmac256 Signature using <code>ApiKey</code>, <code>PrivateKey</code>, and <code>MerchantGuid</code>.</li>
                        <li><strong>Payload Logic:</strong>
                            <ul class="bullet-list">
                                <li><strong>CountryCode:</strong> ZA</li>
                                <li><strong>CurrencyCode:</strong> ZAR</li>
                                <li><strong>TransactionReference:</strong> Unique <code>SB-</code> ID generated by the Seabe Ledger.</li>
                            </ul>
                        </li>
                        <li><strong>UX Handler:</strong> Seabe utilizes the <code>SuccessUrl</code> to trigger automated WhatsApp Webhook responses.</li>
                    </ul>
                </div>
            </div>
        </body>
        </html>
        `;
        res.send(html);
    });

    // GET: NetCash Sandbox Preview Page
    app.get('/netcash-sandbox-preview', (req, res) => {
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Seabe Digital | NetCash Integration Preview</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; color: #2d3748; line-height: 1.6; margin: 0; padding: 20px; }
                .container { max-width: 700px; margin: 40px auto; padding: 40px; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
                .header { text-align: center; margin-bottom: 30px; }
                .badge { display: inline-block; background-color: #ebf8ff; color: #2b6cb0; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 700; margin-bottom: 15px; }
                .message-box { background-color: #e6fffa; border-left: 4px solid #319795; padding: 20px 25px; border-radius: 0 8px 8px 0; margin-bottom: 35px; }
                .message-box p { margin: 0; font-size: 1.1em; color: #285e61; font-weight: 500; }
                .specs-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 30px; background: #f8fafc; }
                .specs-title { font-size: 1.25em; font-weight: 700; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 20px; color: #1a202c; }
                ul { list-style-type: none; padding: 0; margin: 0; }
                li { margin-bottom: 16px; font-size: 0.95em; }
                .bullet-list { padding-left: 20px; margin-top: 10px; list-style-type: disc; color: #718096; }
                .bullet-list li { margin-bottom: 8px; }
                strong { color: #2d3748; font-weight: 600; }
                code { background: #edf2f7; padding: 3px 6px; border-radius: 4px; font-family: monospace; color: #d69e2e; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <span class="badge">SANDBOX ENVIRONMENT</span>
                    <h1 style="margin: 0; font-size: 1.8em; color: #1a202c;">NetCash Payment Gateway</h1>
                    <p style="color: #718096; margin-top: 5px;">Seabe Digital Interceptor</p>
                </div>
                <div class="message-box">
                    <p>Seabe Digital is currently moving into the NetCash Production Environment. This link represents the point where our API will trigger your secure NetCash Pay Now interface or authorize a recurring Debit Order mandate.</p>
                </div>
                <div class="specs-box">
                    <h2 class="specs-title">Technical Integration Specs (Draft v1.1)</h2>
                    <p style="margin-bottom: 20px; color: #4a5568;">Seabe Digital is prepared to consume the NetCash API with the following implementation logic:</p>
                    <ul>
                        <li><strong>Endpoint Target:</strong> <code>POST https://paynow.netcash.co.za/site/paynow.aspx</code></li>
                        <li><strong>Authentication:</strong> Dedicated <code>Pay Now Service Key</code> mapped to individual Church/Society Sub-accounts.</li>
                        <li><strong>Payload Logic:</strong>
                            <ul class="bullet-list">
                                <li><strong>p2 (Transaction Reference):</strong> Unique <code>SB-</code> ID.</li>
                                <li><strong>p4 (Amount):</strong> Sanitized ZAR decimal amount.</li>
                            </ul>
                        </li>
                        <li><strong>UX Handler:</strong> Seabe consumes NetCash Postback Webhooks to automatically verify transaction finality.</li>
                    </ul>
                </div>
            </div>
        </body>
        </html>
        `;
        res.send(html);
    });
	
	// ==========================================
    // 📄 API: SEND QUOTE PDF TO WHATSAPP
    // ==========================================
    app.post('/api/public/send-quote', express.json({ limit: '10mb' }), async (req, res) => {
        const { phone, pdfBase64, orgName } = req.body;
        
        try {
            // 1. Convert Base64 back into a physical PDF file
            const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
            const fileName = `Quote_${Date.now()}.pdf`;
            const filePath = path.join(__dirname, '../public/crm', fileName);
            
            // Save it to the public folder so Twilio can read it
            fs.writeFileSync(filePath, base64Data, 'base64');

            const host = process.env.HOST_URL || 'https://seabe-bot-test.onrender.com';
            const fileUrl = `${host}/crm/${fileName}`;

            // 2. Send via Twilio
            if (process.env.TWILIO_SID && process.env.TWILIO_AUTH) {
                const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
                const cleanTwilioNumber = process.env.TWILIO_PHONE_NUMBER.replace('whatsapp:', '');
                
                await twilioClient.messages.create({
                    from: `whatsapp:${cleanTwilioNumber}`,
                    to: `whatsapp:${phone}`,
                    body: `📄 Here is your official quote from *${orgName}*.`,
                    mediaUrl: [fileUrl]
                });
            }

            res.json({ success: true });
        } catch (error) {
            console.error("PDF Send Error:", error);
            res.status(500).json({ success: false });
        }
    });
	
};