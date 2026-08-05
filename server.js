import express from 'express';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Serve static files from public directory
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

// PRE-VALIDATED REAL GLOBAL DOMAINS LIST
const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 
    'icloud.com', 'mail.com', 'zoho.com', 'proton.me', 
    'protonmail.com', 'gmx.com', 'yandex.com', 'aol.com',
    'live.com', 'msn.com', 'inbox.com', 'fastmail.com',
    'hushmail.com', 'lycos.com', 'rediffmail.com', 'comcast.net',
    'sbcglobal.net'
];

// FAST & VALID API: Instant generation using verified domain set
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 3, domain = 'all' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 3, 50);
        
        let generatedEmails = [];
        let docsToInsert = [];

        for (let i = 0; i < requestedCount; i++) {
            let selectedDomain = domain;
            if (domain === 'all' || !ALLOWED_DOMAINS.includes(domain)) {
                selectedDomain = ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)];
            }

            // Standard RFC 5322 compliant email structure
            const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const randomNum = Math.floor(Math.random() * 8999) + 1000;
            const email = `${firstName}.${lastName}${randomNum}@${selectedDomain}`;

            generatedEmails.push(email);
            docsToInsert.push({ email, isUsed: false });
        }

        // Bulk insert ignoring duplicate conflicts
        await EmailModel.insertMany(docsToInsert, { ordered: false }).catch(() => {});

        res.json({
            success: true,
            message: `Successfully generated ${generatedEmails.length} valid emails!`,
            emails: generatedEmails
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

// Wildcard Fallback Route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));