const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

// Configure temporary upload storage
const upload = multer({ dest: 'uploads/' });
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use the global Prisma instance we set up with the AuditLog extension!
const prisma = require('../services/prisma'); 

// GET: Search for a Member by ID and calculate their Waiting Period
router.get('/members/search', async (req, res) => {
    // We use a query parameter like: /api/surepol/members/search?idNumber=8501015009087
    const { idNumber } = req.query;

    if (!idNumber) {
        return res.status(400).json({ error: "Please provide an ID Number to search." });
    }

    try {
        // 1. Fetch the member and their linked dependents
        const member = await prisma.member.findFirst({
            where: { idNumber },
            include: {
                dependents: true
            }
        });

        if (!member) {
            return res.status(404).json({ error: "No policyholder found with that ID number." });
        }

        // 2. Waiting Period Engine (Standard 6-months for SA Funeral Cover)
        const policyStartDate = new Date(member.createdAt);
        
        // Add 6 months to the creation date
        const waitingPeriodEndDate = new Date(policyStartDate);
        waitingPeriodEndDate.setMonth(waitingPeriodEndDate.getMonth() + 6);
        
        const currentDate = new Date();
        const isWaitingPeriodActive = currentDate < waitingPeriodEndDate;

        // Calculate exact days remaining if still in the waiting period
        let daysRemaining = 0;
        if (isWaitingPeriodActive) {
            const diffTime = Math.abs(waitingPeriodEndDate - currentDate);
            daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        }

        // 3. Send a structured response back to the frontend dashboard
        res.status(200).json({
            memberData: member,
            policyStatus: {
                accountStatus: member.status, // e.g., 'ACTIVE', 'LAPSED'
                waitingPeriod: {
                    isActive: isWaitingPeriodActive,
                    clearsOn: waitingPeriodEndDate.toISOString().split('T')[0],
                    daysRemaining: isWaitingPeriodActive ? daysRemaining : 0,
                    adminMessage: isWaitingPeriodActive 
                        ? `⚠️ Waiting period ACTIVE. Clears in ${daysRemaining} days. (Accidental death only)` 
                        : "✅ Waiting period CLEARED. Fully covered for natural and accidental death."
                }
            }
        });

    } catch (error) {
        console.error("❌ Error fetching Surepol member:", error);
        res.status(500).json({ error: "Internal server error while searching for policyholder." });
    }
});

// POST: Create a new Member and their Dependents
router.post('/members', async (req, res) => {
    const { 
        firstName, 
        lastName, 
        idNumber, 
        phone, 
        churchCode, 
        societyCode, 
        dependents // Expecting an array of objects: [{ firstName, lastName, idNumber, relation }]
    } = req.body;

    try {
        // 1. Check if the member already exists via ID Number or Phone
        const existingMember = await prisma.member.findFirst({
            where: { OR: [{ idNumber }, { phone }] }
        });

        if (existingMember) {
            return res.status(400).json({ error: "A member with this ID or Phone already exists." });
        }

        // 2. Create the Member and Dependents in one atomic transaction
        const newMember = await prisma.member.create({
            data: {
                firstName,
                lastName,
                idNumber,
                phone,
                churchCode,
                societyCode,
                status: 'ACTIVE', // Default status for a new policy
                // 3. Prisma Nested Write: Automatically creates linked rows in the Dependent table
                dependents: {
                        create: dependents && dependents.length > 0 ? dependents.map(dep => ({
                            firstName: dep.firstName,
                            lastName: dep.lastName,
                            dateOfBirth: dep.dateOfBirth, // 👈 Updated mapping
                            relation: dep.relation 
                        })) : []
                    }            },
            // 4. Return the newly created dependents in the response to confirm
            include: {
                dependents: true 
            }
        });

        res.status(201).json({ 
            message: "Policyholder created successfully", 
            member: newMember 
        });

    } catch (error) {
        console.error("❌ Error creating Surepol member:", error);
        res.status(500).json({ error: "Internal server error while creating policyholder." });
    }
});

// POST: Log a Premium Payment
router.post('/payments', async (req, res) => {
    const { phone, amount, paymentMethod, reference } = req.body;

    try {
        // 1. Find the member by their phone number
        const member = await prisma.member.findUnique({
            where: { phone }
        });

        if (!member) {
            return res.status(404).json({ error: "Member not found." });
        }

        // 2. Log the payment in the Transaction table
        const payment = await prisma.transaction.create({
            data: {
                phone, // Links the payment to the member
                churchCode: member.churchCode,
                amount: parseFloat(amount),
                type: 'PREMIUM_PAYMENT',
                status: 'COMPLETED',
                method: paymentMethod, // e.g., 'CASH', 'EFT', 'DEBIT_ORDER'
                reference: reference || `PREM-${Date.now()}`
            }
        });

        // 3. Ensure the Member's policy status is ACTIVE
        // If they were previously LAPSED, paying a premium might reinstate them
        if (member.status !== 'ACTIVE') {
            await prisma.member.update({
                where: { phone },
                data: { status: 'ACTIVE' }
            });
        }

        res.status(201).json({ 
            message: "Premium payment logged successfully.", 
            transaction: payment 
        });

    } catch (error) {
        console.error("❌ Error logging payment:", error);
        res.status(500).json({ error: "Internal server error while logging payment." });
    }
});

// POST: Log a new Death Claim
router.post('/claims', async (req, res) => {
    const { 
        claimantPhone,      // Phone number of the person reporting the death
        deceasedIdNumber,   // ID number of the person who passed away
        dateOfDeath,        // YYYY-MM-DD format
        causeOfDeath,       // 'NATURAL' or 'UNNATURAL'
        funeralParlour      // (Optional) If they are using a specific parlour
    } = req.body;

    try {
        // 1. Locate the deceased in the database (could be a Main Member OR a Dependent)
        let deceasedPerson = await prisma.member.findFirst({
            where: { idNumber: deceasedIdNumber },
            include: { dependents: true }
        });

        let isMainMember = true;
        let policyMemberPhone = deceasedPerson?.phone;

        // If not found as a main member, search the dependents table
        if (!deceasedPerson) {
            const dependent = await prisma.dependent.findFirst({
                where: { idNumber: deceasedIdNumber },
                include: { member: true } // Fetch the main member who pays the premium
            });

            if (!dependent) {
                return res.status(404).json({ error: "No policyholder or dependent found with this ID Number." });
            }
            deceasedPerson = dependent;
            isMainMember = false;
            policyMemberPhone = dependent.member.phone;
        }

        // 2. Waiting Period Engine (6-month rule check)
        // Note: For dependents, the waiting period usually starts when the dependent was added
        const policyStartDate = new Date(deceasedPerson.createdAt);
        const waitingPeriodEndDate = new Date(policyStartDate);
        waitingPeriodEndDate.setMonth(waitingPeriodEndDate.getMonth() + 6);
        
        const deathDate = new Date(dateOfDeath);
        
        // If the death was natural AND it happened before the 6 months cleared, the claim is invalid.
        if (causeOfDeath === 'NATURAL' && deathDate < waitingPeriodEndDate) {
            return res.status(400).json({ 
                error: "Claim Denied: Death occurred within the 6-month waiting period for natural causes." 
            });
        }

        // 3. Create the Claim Record in an atomic transaction
        // We update the person's status to DECEASED and log the claim simultaneously
        const newClaim = await prisma.$transaction(async (tx) => {
            
            // A. Update the person's status
            if (isMainMember) {
                await tx.member.update({
                    where: { idNumber: deceasedIdNumber },
                    data: { status: 'DECEASED' }
                });
            } else {
                await tx.dependent.update({
                    where: { idNumber: deceasedIdNumber },
                    data: { status: 'DECEASED' }
                });
            }

            // B. Create the formal Claim record awaiting documents
            return await tx.claim.create({
                data: {
                    churchCode: isMainMember ? deceasedPerson.churchCode : deceasedPerson.member.churchCode,
                    memberPhone: policyMemberPhone,
                    claimantPhone: claimantPhone,
                    deceasedId: deceasedIdNumber,
                    dateOfDeath: deathDate,
                    causeOfDeath: causeOfDeath,
                    funeralParlour: funeralParlour || 'UNKNOWN',
                    status: 'PENDING_DOCUMENTATION', // Next step: Uploading BI-1663 / Death Certificate
                }
            });
        });

        res.status(201).json({ 
            message: "Claim successfully logged. Awaiting documentation.", 
            claim: newClaim 
        });

    } catch (error) {
        console.error("❌ Error processing claim:", error);
        res.status(500).json({ error: "Internal server error while processing the claim." });
    }
});

// POST: AI Document OCR Extraction
router.post('/claims/extract-ocr', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No document image provided." });
        }

        // 1. Upload the image to Cloudinary (Permanent Vault)
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: 'surepol_claims_vault',
            resource_type: 'image'
        });

        // 2. Delete the temporary file from your server to save space
        fs.unlinkSync(req.file.path);

        // 3. Ask Gemini 2.5 Flash to read the SA Government form
        const imageResponse = await fetch(uploadResult.secure_url);
        const imageArrayBuffer = await imageResponse.arrayBuffer();
        
        const imagePart = {
            inlineData: {
                data: Buffer.from(imageArrayBuffer).toString("base64"),
                mimeType: "image/jpeg" // You can also dynamically grab this from the fetch headers if needed
            }
        };

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" } // Strict JSON mode
        });

        const prompt = `You are an expert InsurTech AI data extractor for South Africa. 
        Analyze this document (like a DHA-1663 or Death Certificate). 
        Extract the details and return EXACTLY this JSON structure. If you cannot read a field, return null for that field.
        {
            "documentType": "string",
            "deceasedIdNumber": "13-digit string",
            "dateOfDeath": "YYYY-MM-DD",
            "causeOfDeath": "NATURAL" or "UNNATURAL",
            "confidenceScore": number between 0 and 100
        }
        Note: If the cause of death is an accident, murder, or suicide, classify as UNNATURAL. Otherwise, NATURAL.`;

        // Execute the AI call
        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        
        // 4. Parse the JSON exactly as Gemini returned it
        const extractedData = JSON.parse(responseText);

        // 5. Send the permanent Cloudinary link AND the AI data back to the frontend
        res.status(200).json({
            message: "Document successfully analyzed.",
            vaultUrl: uploadResult.secure_url,
            extractedData: extractedData
        });

    } catch (error) {
        console.error("❌ AI OCR Error:", error);
        // Clean up temp file just in case it failed before deletion
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        
        res.status(500).json({ error: "Failed to process the document with AI." });
    }
});

module.exports = router;