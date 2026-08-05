import express from 'express';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import validate from 'deep-email-validator';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Serve static files directly from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection Setup
const MONGO_URI = process.env.MONGO_URI || "YOUR_MONGODB_ATLAS_CONNECTION_STRING";
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Database Schema
const emailSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false },
    assignedDevice: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const EmailModel = mongoose.model('Email', emailSchema);

// ALL 21 DOMAINS LIST
const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 
    'icloud.com', 'mail.com', 'zoho.com', 'proton.me', 
    'protonmail.com', 'gmx.com', 'yandex.com', 'aol.com',
    'live.com', 'msn.com', 'inbox.com', 'fastmail.com',
    'hushmail.com', 'lycos.com', 'rediffmail.com', 'comcast.net',
    'sbcglobal.net'
];

// API: Generate Validated Emails
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 3, domain = 'all' } = req.body;
        let validEmails = [];
        let attempts = 0;
        const maxAttempts = count * 8;

        while (validEmails.length < count && attempts < maxAttempts) {
            attempts++;
            let selectedDomain = domain;
            
            if (domain === 'all' || !ALLOWED_DOMAINS.includes(domain)) {
                selectedDomain = ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)];
            }

            const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const randomNum = Math.floor(Math.random() * 8999) + 1000;
            const email = `${firstName}.${lastName}${randomNum}@${selectedDomain}`;

            try {
                const resValidation = await validate({
                    email: email,
                    validateRegex: true,
                    validateMx: true,
                    validateTypo: false,
                    validateDisposable: true,
                    validateSMTP: false
                });

                if (resValidation.valid) {
                    const newEmailDoc = new EmailModel({ email: email, isUsed: false });
                    await newEmailDoc.save();
                    validEmails.push(email);
                }
            } catch (vErr) {
                // Skip duplicates
            }
        }

        if (validEmails.length === 0) {
            return res.status(400).json({ success: false, error: 'Failed to generate emails. Please try again.' });
        }

        res.json({
            success: true,
            message: `Successfully generated ${validEmails.length} valid emails!`,
            emails: validEmails
        });

    } catch (error) {
        console.error("Generation Error:", error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// API: Get Single Unused Email
app.post('/api/get-email', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID is required.' });
        }

        const assignedEmail = await EmailModel.findOneAndUpdate(
            { isUsed: false },
            { $set: { isUsed: true, assignedDevice: deviceId } },
            { new: true, sort: { createdAt: 1 } }
        );

        if (!assignedEmail) {
            return res.status(404).json({ success: false, error: 'No fresh emails available. Please generate emails first!' });
        }

        res.json({
            success: true,
            email: assignedEmail.email
        });

    } catch (error) {
        console.error("Fetch Error:", error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// Primary Home Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Wildcard Fallback Route to serve public/index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));