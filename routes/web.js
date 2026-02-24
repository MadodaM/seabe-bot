// routes/web.js
// PURPOSE: Public Website (Home, Register, Demo, Terms)
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

const EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.SENDGRID_KEY) sgMail.setApiKey(process.env.SENDGRID_KEY);

module.exports = function(app, upload, { prisma, syncToHubSpot }) {

    // --- EMAIL HELPERS ---
    const emailStyle = "font-family: 'Segoe UI', sans-serif; color: #333; line-height: 1.6;";
    const headerStyle = "background-color: #0a4d3c; color: #ffffff; padding: 30px; text-align: center; border-bottom: 4px solid #D4AF37;";
    const btnStyle = "display: inline-block; background-color: #D4AF37; color: #0a4d3c; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 4px; margin-top: 20px;";

    // 1. PUBLIC HOMEPAGE
    app.get('/', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Seabe | The Operating System for African Ministries</title>
                <style>
                    :root { --primary: #0a4d3c; --accent: #D4AF37; --text: #1a1a1a; --white: #ffffff; }
                    body { font-family: 'Inter', system-ui, sans-serif; margin: 0; color: var(--text); background: var(--white); line-height: 1.6; }
                    .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
                    .btn { display: inline-block; padding: 16px 32px; border-radius: 8px; font-weight: 600; text-decoration: none; transition: 0.3s; cursor: pointer; border: none; }
                    .btn-gold { background: var(--accent); color: var(--primary); }
                    .btn-gold:hover { background: #b5952f; transform: translateY(-2px); }
                    .btn-outline { border: 2px solid var(--white); color: var(--white); margin-left: 10px; background: transparent; }
                    .btn-outline:hover { background: rgba(255,255,255,0.1); }
                    
                    nav { padding: 25px 0; position: absolute; width: 100%; top: 0; z-index: 10; }
                    nav .container { display: flex; justify-content: space-between; align-items: center; }
                    .logo { font-size: 1.8rem; font-weight: 900; color: var(--white); text-decoration: none; }
                    .nav-links a { color: white; text-decoration: none; font-weight: 600; margin-left: 20px; font-size: 0.9rem; }
                    .nav-links a:hover { color: var(--accent); }
                    .sign-in-btn { border: 1px solid var(--accent); padding: 8px 18px; border-radius: 5px; color: var(--accent) !important; transition:0.3s; }
                    .sign-in-btn:hover { background: var(--accent); color: var(--primary) !important; }

                    .hero { background: linear-gradient(170deg, #05281e 0%, #0a4d3c 60%, #0d5e49 100%); color: var(--white); padding: 180px 0 120px; text-align: center; clip-path: polygon(0 0, 100% 0, 100% 90%, 0 100%); }
                    .hero h1 { font-size: 3.8rem; line-height: 1.1; font-weight: 800; margin-bottom: 20px; }
                    .hero p { font-size: 1.4rem; opacity: 0.9; max-width: 700px; margin: 0 auto 40px; }
                    
                    .stats-bar { padding: 60px 0; margin-top: -50px; position: relative; z-index: 5; }
                    .stats-grid { display: flex; justify-content: space-around; flex-wrap: wrap; text-align: center; background: white; max-width: 900px; margin: auto; padding: 40px; border-radius: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.05); }
                    .stat h4 { font-size: 2.5rem; color: var(--primary); margin: 0; font-weight: 800; }
                    .stat p { color: #666; font-size: 0.9rem; text-transform: uppercase; font-weight: 600; }
                    
                    .section { padding: 100px 0; }
                    .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; }
                    .feature-card { padding: 40px; border-radius: 20px; background: var(--white); border: 1px solid #f0f0f0; transition: 0.3s; }
                    .feature-card:hover { transform: translateY(-5px); box-shadow: 0 20px 40px rgba(0,0,0,0.08); border-color: var(--accent); }
                    .icon-box { width: 60px; height: 60px; background: #eefdf5; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 25px; color: var(--primary); }
                    
                    footer { background: #05281e; color: #888; padding: 80px 0 40px; }
                    footer h4 { color: white; margin-bottom: 20px; }
                    footer a { display: block; color: #888; text-decoration: none; margin-bottom: 10px; }
                    footer a:hover { color: var(--accent); }
                    
                    @media(max-width: 768px) { .hero h1 { font-size: 2.5rem; } .hero { padding: 140px 0 80px; clip-path: none; } .stats-grid { flex-direction: column; gap: 30px; } .nav-links { display:none; } }
                </style>
            </head>
            <body>
                <nav>
                    <div class="container">
                        <a href="/" class="logo">SEABE<span style="color:var(--accent)">.</span></a>
                        <div class="nav-links">
                            <a href="/demo">Book Demo</a>
                            <a href="/register">Register Church</a>
                            <a href="/login" class="sign-in-btn">Sign In</a>
                        </div>
                    </div>
                </nav>
                <header class="hero">
                    <div class="container">
                        <h1>Digital Stewardship for<br>the <span style="color:var(--accent)">African Church</span></h1>
                        <p>No apps to download. No data friction. Just automated giving, compliance, and communication via WhatsApp.</p>
                        <br>
                        <a href="/register" class="btn btn-gold">Register Your Church</a>
                        <a href="/demo" class="btn btn-outline">Request a Demo</a>
                    </div>
                </header>
                <div class="stats-bar">
                    <div class="container stats-grid">
                        <div class="stat"><h4>100%</h4><p>WhatsApp Native</p></div>
                        <div class="stat"><h4>Auto</h4><p>PDF Receipts</p></div>
                        <div class="stat"><h4>Zero</h4><p>Admin Headache</p></div>
                    </div>
                </div>
                <section class="section">
                    <div class="container">
                        <div class="grid-3">
                            <div class="feature-card">
                                <div class="icon-box">📱</div>
                                <h3>Mobile-First Design</h3>
                                <p>Africa lives on WhatsApp. We bring your ministry tools to the platform your members already use 50 times a day.</p>
                            </div>
                            <div class="feature-card">
                                <div class="icon-box">💳</div>
                                <h3>Seamless Payments</h3>
                                <p>Accept Tithes, Offerings, and Building Funds instantly via Paystack. Secure, local, and incredibly fast.</p>
                            </div>
                            <div class="feature-card">
                                <div class="icon-box">⚖️</div>
                                <h3>Automated Compliance</h3>
                                <p>We auto-generate financial reports and tax certificates, keeping your ministry compliant without the paperwork.</p>
                            </div>
                        </div>
                    </div>
                </section>
                <footer>
                    <div class="container" style="display:grid; gap:40px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                        <div><h4 style="color:var(--accent)">SEABE.</h4><p>Empowering the African Church.</p></div>
                        <div><h4>Platform</h4><a href="/register">Register</a><a href="/demo">Book Demo</a></div>
                        <div><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/Legal">Compliance</a></div>
                        <div><h4>Contact</h4><a href="mailto:madoda@seabe.co.za">madoda@seabe.co.za</a></div>
                    </div>
                </footer>
            </body>
            </html>
        `);
    });

    // 2. REGISTRATION PAGES
    app.get('/register', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Register | Seabe Digital</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 450px; box-shadow:0 10px 30px rgba(0,0,0,0.05); }
                    h2 { color: #0a4d3c; text-align: center; margin-bottom:5px; }
                    .form-group { margin-bottom: 15px; }
                    .form-group label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: #333; }
                    input[type="text"], input[type="email"], input[type="file"], select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #0a4d3c; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition:0.3s; font-size: 16px; }
                    button:hover:not(:disabled) { background: #07382c; }
                    button:disabled { background: #95a5a6; cursor: not-allowed; }
                    a { color: #D4AF37; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Register Your Ministry</h2>
                    <p style="text-align:center; color:#888; margin-bottom:30px;">Complete KYC to activate automated giving.</p>
                    
                    <form id="kybRegistrationForm" enctype="multipart/form-data">
                        <div class="form-group">
                            <label>Organization Name</label>
                            <input type="text" id="churchName" name="churchName" required placeholder="e.g., Grace Community Church">
                        </div>
                        
                        <div class="form-group">
                            <label>Official Email</label>
                            <input type="email" id="officialEmail" name="officialEmail" required placeholder="admin@church.co.za">
                        </div>

                        <div class="form-group">
                            <label>Organization Type</label>
                            <select id="orgType" name="type" required>
                                <option value="CHURCH">Church</option>
                                <option value="BURIAL_SOCIETY">Burial Society</option>
                                <option value="NON_PROFIT">Non-Profit (NGO)</option>
                            </select>
                        </div>

                        <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
                        <h4 style="color:#2c3e50; margin-top:0;">🛡️ Level 1 FICA Verification</h4>
                        <p style="font-size:12px; color:#7f8c8d; margin-bottom:15px;">To comply with South African financial regulations, please upload the primary leader's ID and a recent proof of bank account.</p>

                        <div class="form-group">
                            <label>Upload Pastor / Leader ID (Green Book or Smart Card)</label>
                            <input type="file" id="pastorId" name="pastorId" accept="image/*,.pdf" required style="border:1px dashed #bdc3c7; background:#f9f9f9;">
                        </div>

                        <div class="form-group">
                            <label>Proof of Bank Account (Letter or Statement)</label>
                            <input type="file" id="proofOfBank" name="proofOfBank" accept="image/*,.pdf" required style="border:1px dashed #bdc3c7; background:#f9f9f9;">
                        </div>

                        <div style="margin-bottom:20px; font-size:13px; color:#555; display:flex; align-items:start; gap:8px;">
                            <input type="checkbox" id="tos" required style="width:auto; margin-top:3px;"> 
                            <span>I accept the <a href="/terms" target="_blank">Master Service Agreement</a>.</span>
                        </div>

                        <div id="regError" style="color:#c0392b; font-size:13px; font-weight:bold; margin-bottom:15px; display:none;"></div>
                        <div id="regSuccess" style="color:#27ae60; font-size:13px; font-weight:bold; margin-bottom:15px; display:none;"></div>

                        <button type="submit" id="submitBtn">Submit FICA & Register</button>
                    </form>
                    <p style="text-align:center; margin-top:20px;"><a href="/" style="color:#999; font-size:13px;">Cancel</a></p>
                </div>

                <script>
                document.getElementById('kybRegistrationForm').addEventListener('submit', async (e) => {
                    e.preventDefault(); 
                    
                    const btn = document.getElementById('submitBtn');
                    const errorBox = document.getElementById('regError');
                    const successBox = document.getElementById('regSuccess');
                    
                    // UI Loading State
                    btn.innerText = "⏳ Uploading & AI Verifying...";
                    btn.disabled = true;
                    errorBox.style.display = 'none';
                    successBox.style.display = 'none';

                    // Package the text and files together
                    const formData = new FormData();
                    formData.append('churchName', document.getElementById('churchName').value);
                    formData.append('officialEmail', document.getElementById('officialEmail').value);
                    formData.append('type', document.getElementById('orgType').value);
                    formData.append('pastorId', document.getElementById('pastorId').files[0]);
                    formData.append('proofOfBank', document.getElementById('proofOfBank').files[0]);

                    try {
                        // Pointing to the new FICA Engine Route
                        const response = await fetch('/api/prospect/register-church', {
                            method: 'POST',
                            body: formData 
                        });

                        const data = await response.json();

                        if (!response.ok) {
                            throw new Error(data.error || "Failed to process registration.");
                        }

                        // Success!
                        successBox.innerText = "✅ " + data.message + " (AI Confidence: " + (data.aiExtractedData?.confidenceScore || 'High') + "%)";
                        successBox.style.display = 'block';
                        document.getElementById('kybRegistrationForm').reset();
                        btn.innerText = "Registration Complete";
                        
                    } catch (error) {
                        errorBox.innerText = "❌ " + error.message;
                        errorBox.style.display = 'block';
                        btn.innerText = "Submit FICA & Register";
                        btn.disabled = false;
                    }
                });
                </script>
            </body>
            </html>
        `);
    });

    // FALLBACK/LEGACY REGISTRATION ROUTE (Patched with the 'type' fix)
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
            
            // 🚨 FIX APPLIED: 'type' is now explicitly set, defaulting to CHURCH
            await prisma.church.create({ 
                data: { 
                    name: churchName, 
                    code: newCode, 
                    email: email, 
                    subaccountCode: 'PENDING_KYC', 
                    tosAcceptedAt: new Date(),
                    type: type || 'CHURCH' 
                } 
            });

            if (process.env.SENDGRID_KEY) {
                // Email Admin
                await sgMail.send({ to: EMAIL_FROM, from: EMAIL_FROM, subject: `📝 NEW APPLICATION: ${churchName}`, html: `<h2>New Application</h2><p>Name: ${churchName}</p><p>Email: ${email}</p>`, attachments: attachments });
                
                // Email User
                await sgMail.send({
                    to: email, from: EMAIL_FROM, subject: 'Application Received | Seabe Digital',
                    html: `
                        <div style="${emailStyle}">
                            <div style="${headerStyle}"><h1 style="margin:0;">SEABE.</h1><p>Kingdom Connectivity</p></div>
                            <div style="padding: 30px; background: #fff;">
                                <h2>Registration Received</h2>
                                <p>Thank you for registering <strong>${churchName}</strong>. Our compliance team is reviewing your documents (24-48 hours).</p>
                                <p>Once approved, you will receive your unique Church Code.</p>
                                <a href="https://seabe.co.za/terms" style="${btnStyle}">View Terms</a>
                            </div>
                        </div>`
                });
            }
            filePathsToDelete.forEach(p => { try { fs.unlinkSync(p); } catch(e){} });
            
            res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px; color:#0a4d3c;"><h1>🎉 Application Received</h1><p>Confirmation sent to <strong>${email}</strong>.</p><a href="/">Return Home</a></div>`);
        } catch (e) { console.error(e); res.send("<h1>Error</h1><p>Please try again.</p>"); }
    });

// ---------------------------------------------------------
    // 🛡️ LEVEL 2 FICA UPLOAD PORTAL (Triggered by Email Link)
    // ---------------------------------------------------------
    app.get('/kyb-upload/:code', async (req, res) => {
        const { code } = req.params;

        try {
            // 1. Verify the Church exists and needs Level 2 docs
            const church = await prisma.church.findUnique({ where: { code } });

            if (!church) {
                return res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px;"><h2>❌ Invalid Link</h2><p>This organization could not be found.</p></div>`);
            }

            if (church.ficaStatus === 'LEVEL_2_PENDING' || church.ficaStatus === 'ACTIVE') {
				return res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px; color:#27ae60;"><h2>✅ Documents Under Verification</h2><p>Your corporate documents have been successfully received and are currently being reviewed by our compliance team. <strong>Please wait for feedback via email.</strong></p></div>`);
			}

            if (church.ficaStatus === 'LEVEL_1_PENDING') {
                return res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px; color:#e67e22;"><h2>⏳ Pending Level 1</h2><p>Your initial registration is still being reviewed. You will receive an email when it's time to upload corporate documents.</p></div>`);
            }

            // 2. Render the Secure Upload Form
            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Upload Corporate Docs | Seabe KYB</title>
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                        .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 500px; box-shadow:0 10px 30px rgba(0,0,0,0.05); }
                        h2 { color: #0a4d3c; text-align: center; margin-bottom:5px; }
                        .form-group { margin-bottom: 20px; }
                        .form-group label { display: block; font-size: 13px; font-weight: bold; margin-bottom: 8px; color: #333; }
                        .form-group p { font-size: 11px; color: #7f8c8d; margin-top: -5px; margin-bottom: 8px; }
                        input[type="file"] { width: 100%; padding: 12px; border: 1px dashed #bdc3c7; border-radius: 6px; box-sizing: border-box; background: #f9f9f9; }
                        button { width: 100%; padding: 15px; background: #D4AF37; color: #0a4d3c; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition:0.3s; font-size: 16px; margin-top: 10px; }
                        button:hover:not(:disabled) { background: #b5952f; }
                        button:disabled { background: #e0e0e0; color: #999; cursor: not-allowed; }
                        .badge { display: inline-block; background: #eefdf5; color: #27ae60; padding: 5px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-bottom: 20px; text-align: center; width: 100%; box-sizing: border-box; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Corporate Verification</h2>
                        <div class="badge">${church.name} (${church.code})</div>
                        <p style="text-align:center; color:#555; font-size: 14px; margin-bottom:30px;">Please upload your official registration documents to activate your payment collections account.</p>
                        
                        <form id="level2UploadForm" enctype="multipart/form-data">
                            
                            <div class="form-group">
                                <label>1. NPC / NPO Registration Certificate</label>
                                <p>Official certificate showing your non-profit status.</p>
                                <input type="file" id="npcReg" name="npcReg" accept="image/*,.pdf" required>
                            </div>

                            <div class="form-group">
                                <label>2. CIPC Registration Document</label>
                                <p>COR14.3 or equivalent showing enterprise details.</p>
                                <input type="file" id="cipcDoc" name="cipcDoc" accept="image/*,.pdf" required>
                            </div>

                            <div class="form-group">
                                <label>3. Director / Board Member IDs</label>
                                <p>Merge IDs into a single PDF, or upload the primary director's ID.</p>
                                <input type="file" id="directorIds" name="directorIds" accept="image/*,.pdf" required>
                            </div>

                            <div id="uploadError" style="color:#c0392b; font-size:13px; font-weight:bold; margin-bottom:15px; display:none; text-align:center;"></div>
                            <div id="uploadSuccess" style="color:#27ae60; font-size:14px; font-weight:bold; margin-bottom:15px; display:none; text-align:center; background: #eefdf5; padding: 15px; border-radius: 6px;"></div>

                            <button type="submit" id="submitDocsBtn">Securely Upload Documents</button>
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
                        errorBox.style.display = 'none';

                        const formData = new FormData();
                        formData.append('npcReg', document.getElementById('npcReg').files[0]);
                        formData.append('cipcDoc', document.getElementById('cipcDoc').files[0]);
                        formData.append('directorIds', document.getElementById('directorIds').files[0]);

                        try {
                            const response = await fetch('/api/prospect/upload-level-2/${church.code}', {
                                method: 'POST',
                                body: formData 
                            });

                            const data = await response.json();

                            if (!response.ok) {
                                throw new Error(data.error || "Failed to upload documents.");
                            }

                            // Success
                            successBox.innerHTML = "✅ <strong>Upload Complete!</strong><br>Your documents have been encrypted and saved. Our team will finalize your account shortly.";
                            successBox.style.display = 'block';
                            document.getElementById('level2UploadForm').style.display = 'none'; // Hide form
                            
                        } catch (error) {
                            errorBox.innerText = "❌ " + error.message;
                            errorBox.style.display = 'block';
                            btn.innerText = "Securely Upload Documents";
                            btn.disabled = false;
                        }
                    });
                    </script>
                </body>
                </html>
            `);

        } catch (error) {
            console.error("KYB Upload Page Error:", error);
            res.send("<h2>System Error</h2><p>Could not load the verification portal.</p>");
        }
    }); 

    // 3. DEMO PAGE
    app.get('/demo', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="viewport" content="width=device-width, initial-scale=1.0">
                <title>Book Demo</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .card { background: white; padding: 40px; border-radius: 15px; width: 100%; max-width: 400px; box-shadow:0 10px 30px rgba(0,0,0,0.05); }
                    h2 { color: #0a4d3c; text-align: center; }
                    input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: #D4AF37; color: #0a4d3c; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition:0.3s; }
                    button:hover { background: #b5952f; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Schedule a Demo</h2>
                    <p style="text-align:center; color:#666;">See how Seabe can transform your ministry.</p>
                    <form action="/request-demo" method="POST">
                        <input name="firstname" placeholder="Your Name" required>
                        <input name="email" placeholder="Email Address" required type="email">
                        <input name="phone" placeholder="WhatsApp Number" required>
                        <button type="submit">Request Demo</button>
                    </form>
                    <p style="text-align:center;"><a href="/" style="color:#999; text-decoration:none;">Back</a></p>
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
                            <p>We received your request. A manager will contact you via WhatsApp shortly.</p>
                        </div>
                    </div>`
            });
        }
        res.send(`<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1 style="color:#0a4d3c;">Request Received ✅</h1><p>Check your email.</p><a href="/">Return Home</a></div>`);
    });

    // 4. TERMS
    app.get('/terms', (req, res) => {
        res.send(`<div style="font-family:sans-serif; max-width:800px; margin:auto; padding:50px; line-height:1.6;"><h1 style="color:#0a4d3c; border-bottom:2px solid #D4AF37;">Master Service Agreement</h1><p><strong>Last Updated:</strong> January 30, 2026</p>

        <p>Welcome to Seabe Digital ("Seabe," "we," "us," or "our"). By accessing or using our WhatsApp-based payment and management platform (the "Service"), you agree to be bound by these Terms of Service ("Terms").</p>

        <h2>1. Description of Service</h2>
        <p>Seabe provides a technology platform that facilitates donations, tithes, and event ticketing for churches and non-profit organizations via WhatsApp. Seabe is not a bank, and we do not hold funds. We act as a technical intermediary between the User (the "Member") and the Organization (the "Church").</p>

        <h2>2. Payments & Processing</h2>
        <p>All financial transactions are processed by <strong>Paystack Payments South Africa (Pty) Ltd</strong>, a registered Payment Service Provider. By making a payment, you agree to Paystack's terms and conditions. Seabe does not store your full card details.</p>

        <h2>3. Transaction Fees</h2>
        <p>A platform fee is applicable to transactions processed through the Service. This fee is deducted automatically before settlement is made to the Church's account. The fee structure is agreed upon between Seabe and the registered Church.</p>

        <div class="refund-box">
            <h2>4. Refund Policy</h2>
            <p><strong>Donations & Tithes:</strong> As these are voluntary charitable contributions, they are generally non-refundable. However, if you made an error in the amount, please contact your Church Administrator immediately.</p>
            <p><strong>Event Tickets:</strong> Refunds for event tickets are subject to the specific policy of the Church hosting the event. Seabe facilitates the transaction but does not control the refund decision.</p>
            <p><strong>Disputes:</strong> If you believe a transaction was fraudulent, please contact us at <a href="mailto:madoda@seabe.co.za">madoda@seabe.co.za</a>.</p>
        </div>

        <h2>5. User Account Security</h2>
        <p>You are responsible for maintaining the security of your WhatsApp account. Seabe is not liable for any loss or damage arising from unauthorized access to your WhatsApp account or phone.</p>

        <h2>6. Acceptable Use</h2>
        <p>You agree not to use the Service for any unlawful purpose, including money laundering or financing of terrorism. We reserve the right to terminate access for any user violating these terms.</p>

        <h2>7. Limitation of Liability</h2>
        <p>To the maximum extent permitted by law, Seabe Digital shall not be liable for any indirect, incidental, or consequential damages arising out of your use of the Service.</p>

        <h2>8. Contact Us</h2>
        <p>For any questions regarding these Terms, please contact us:</p>
        <p>
            <strong>Email:</strong> madoda@seabe.co.za<br>
            <strong>Website:</strong> www.seabe.tech
        </p>

        <footer>
            &copy; 2026 Seabe Digital. All rights reserved.
        </footer>
    </div><br><a href="/register" style="color:#0a4d3c;">&larr; Back</a></div>`);
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
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
                background-color: #f4f7f6; 
                color: #2d3748; 
                line-height: 1.6; 
                margin: 0; 
                padding: 20px; 
            }
            .container { 
                max-width: 700px; 
                margin: 40px auto; 
                padding: 40px; 
                background: #ffffff; 
                border-radius: 12px; 
                box-shadow: 0 10px 25px rgba(0,0,0,0.05); 
            }
            .header { text-align: center; margin-bottom: 30px; }
            .badge {
                display: inline-block;
                background-color: #e6fffa;
                color: #319795;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 0.85em;
                font-weight: 700;
                letter-spacing: 0.5px;
                margin-bottom: 15px;
            }
            .message-box { 
                background-color: #ebf8ff; 
                border-left: 4px solid #3182ce; 
                padding: 20px 25px; 
                border-radius: 0 8px 8px 0; 
                margin-bottom: 35px; 
            }
            .message-box p { margin: 0; font-size: 1.1em; color: #2b6cb0; font-weight: 500; }
            .specs-box { 
                border: 1px solid #e2e8f0; 
                border-radius: 8px; 
                padding: 30px; 
                background: #f8fafc; 
            }
            .specs-title { 
                font-size: 1.25em; 
                font-weight: 700; 
                margin-top: 0; 
                border-bottom: 2px solid #e2e8f0; 
                padding-bottom: 12px; 
                margin-bottom: 20px; 
                color: #1a202c; 
            }
            ul { list-style-type: none; padding: 0; margin: 0; }
            li { margin-bottom: 16px; font-size: 0.95em; }
            .bullet-list { padding-left: 20px; margin-top: 10px; list-style-type: disc; color: #718096; }
            .bullet-list li { margin-bottom: 8px; }
            strong { color: #2d3748; font-weight: 600; }
            code { 
                background: #edf2f7; 
                padding: 3px 6px; 
                border-radius: 4px; 
                font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; 
                color: #e53e3e; 
                font-size: 0.9em;
            }
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
                            <li><strong>IsTest:</strong> [Toggle based on Environment]</li>
                            <li><strong>TransactionReference:</strong> Unique <code>SB-</code> ID generated by the Seabe Ledger.</li>
                        </ul>
                    </li>
                    <li><strong>UX Handler:</strong> Seabe utilizes the <code>SuccessUrl</code> and <code>CancelUrl</code> to trigger automated WhatsApp Webhook responses, ensuring the member receives an instant confirmation message upon transaction completion.</li>
                    <li><strong>Direct Bank Integration:</strong> Our primary focus is the Capitec Pay and Ozow PIN rails to maximize conversion rates for our mobile-first demographic.</li>
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
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
                background-color: #f4f7f6; 
                color: #2d3748; 
                line-height: 1.6; 
                margin: 0; 
                padding: 20px; 
            }
            .container { 
                max-width: 700px; 
                margin: 40px auto; 
                padding: 40px; 
                background: #ffffff; 
                border-radius: 12px; 
                box-shadow: 0 10px 25px rgba(0,0,0,0.05); 
            }
            .header { text-align: center; margin-bottom: 30px; }
            .badge {
                display: inline-block;
                background-color: #ebf8ff;
                color: #2b6cb0;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 0.85em;
                font-weight: 700;
                letter-spacing: 0.5px;
                margin-bottom: 15px;
            }
            .message-box { 
                background-color: #e6fffa; 
                border-left: 4px solid #319795; 
                padding: 20px 25px; 
                border-radius: 0 8px 8px 0; 
                margin-bottom: 35px; 
            }
            .message-box p { margin: 0; font-size: 1.1em; color: #285e61; font-weight: 500; }
            .specs-box { 
                border: 1px solid #e2e8f0; 
                border-radius: 8px; 
                padding: 30px; 
                background: #f8fafc; 
            }
            .specs-title { 
                font-size: 1.25em; 
                font-weight: 700; 
                margin-top: 0; 
                border-bottom: 2px solid #e2e8f0; 
                padding-bottom: 12px; 
                margin-bottom: 20px; 
                color: #1a202c; 
            }
            ul { list-style-type: none; padding: 0; margin: 0; }
            li { margin-bottom: 16px; font-size: 0.95em; }
            .bullet-list { padding-left: 20px; margin-top: 10px; list-style-type: disc; color: #718096; }
            .bullet-list li { margin-bottom: 8px; }
            strong { color: #2d3748; font-weight: 600; }
            code { 
                background: #edf2f7; 
                padding: 3px 6px; 
                border-radius: 4px; 
                font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; 
                color: #d69e2e; 
                font-size: 0.9em;
            }
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
                    <li><strong>Authentication:</strong> Dedicated <code>Pay Now Service Key</code> and <code>Debit Order Service Key</code> mapped to individual Church/Society Sub-accounts.</li>
                    <li><strong>Payload Logic:</strong>
                        <ul class="bullet-list">
                            <li><strong>Method:</strong> 8</li>
                            <li><strong>p2 (Transaction Reference):</strong> Unique <code>SB-</code> ID generated by the Seabe Ledger.</li>
                            <li><strong>p3 (Description):</strong> Dynamic mapping (e.g., "Tithe" or "Burial Premium").</li>
                            <li><strong>p4 (Amount):</strong> Sanitized ZAR decimal amount.</li>
                            <li><strong>p11 (Mobile Number):</strong> Bound to user's WhatsApp number.</li>
                        </ul>
                    </li>
                    <li><strong>UX Handler:</strong> Seabe consumes NetCash Postback Webhooks to automatically verify transaction finality and trigger WhatsApp confirmation receipts.</li>
                    <li><strong>Primary Focus:</strong> Automating recurring Debit Order mandates for Burial Society premiums to radically reduce policy lapse rates.</li>
                </ul>
            </div>
        </div>
    </body>
    </html>
    `;
    
    res.send(html);
});

};