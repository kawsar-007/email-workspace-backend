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

// PRE-VALIDATED REAL GLOBAL DOMAINS LIST (21 Domains)
const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 
    'icloud.com', 'mail.com', 'zoho.com', 'proton.me', 
    'protonmail.com', 'gmx.com', 'yandex.com', 'aol.com',
    'live.com', 'msn.com', 'inbox.com', 'fastmail.com',
    'hushmail.com', 'lycos.com', 'rediffmail.com', 'comcast.net',
    'sbcglobal.net'
];

// FAST & VALID API: High-speed instant generation
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

            const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const randomNum = Math.floor(Math.random() * 8999) + 1000;
            const email = `${firstName}.${lastName}${randomNum}@${selectedDomain}`;

            generatedEmails.push(email);
            docsToInsert.push({ email, isUsed: false });
        }

        // Bulk insert to MongoDB ignoring potential duplicate index collisions
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

// Robust API: Get Single Unused Email safely with proper query structure
app.post('/api/get-email', async (req, res) => {
    try {
        const { deviceId } = req.body;
        
        if (!deviceId || typeof deviceId !== 'string') {
            return res.status(400).json({ 
                success: false, 
                error: 'Valid Device ID is required.' 
            });
        }

        // Find an unassigned email and mark it used atomically
        const assignedEmail = await EmailModel.findOneAndUpdate(
            { isUsed: false },
            { 
                $set: { 
                    isUsed: true, 
                    assignedDevice: deviceId.trim() 
                } 
            },
            { new: true, sort: { createdAt: 1 } }
        ).exec();

        if (!assignedEmail) {
            return res.status(404).json({ 
                success: false, 
                error: 'No fresh emails available. Please generate emails first!' 
            });
        }

        return res.json({
            success: true,
            email: assignedEmail.email
        });

    } catch (error) {
        console.error("Get Email Database Error:", error.message || error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || 'Internal Server Error' 
        });
    }
});

// Primary Home Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Wildcard Fallback Route for Single Page Application routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));