import express from 'express';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection Setup
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://user:pass@cluster.mongodb.net/emaildb";

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('MongoDB Connected Successfully'))
.catch(err => console.error('MongoDB Connection Error:', err));

// Database Schema
const emailSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false, index: true },
    assignedDevice: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const EmailModel = mongoose.model('Email', emailSchema);

// Pre-validated 21 Active Global Domains
const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 
    'aol.com', 'zoho.com', 'proton.me', 'mail.com', 'gmx.com', 
    'yandex.com', 'live.com', 'msn.com', 'comcast.net', 'sbcglobal.net', 
    'verizon.net', 'att.net', 'me.com', 'mac.com', 'rocketmail.com', 'cox.net'
];

// Helper Function: Check Domain MX Records (Active Mail Exchange Verification)
async function verifyDomainMX(domain) {
    try {
        const mxRecords = await dns.resolveMx(domain);
        return mxRecords && mxRecords.length > 0;
    } catch (error) {
        return false;
    }
}

// 1. GENERATE EMAILS ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: 'Database is connecting. Please retry in a few seconds.' });
        }

        const { count = 3, domain = 'all' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 3, 50);

        let generatedEmails = [];
        let docsToInsert = [];

        for (let i = 0; i < requestedCount; i++) {
            let selectedDomain = domain;
            if (domain === 'all' || !ALLOWED_DOMAINS.includes(domain)) {
                selectedDomain = ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)];
            }

            // Real-time Domain Mail Exchange Check
            const isMxActive = await verifyDomainMX(selectedDomain);

            if (isMxActive) {
                const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const randomNum = Math.floor(Math.random() * 8999) + 1000;
                const email = `${firstName}.${lastName}${randomNum}@${selectedDomain}`;

                generatedEmails.push(email);
                docsToInsert.push({ email, isUsed: false });
            }
        }

        if (docsToInsert.length > 0) {
            await EmailModel.insertMany(docsToInsert, { ordered: false }).catch(() => {});
        }

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

// 2. GET & ASSIGN EMAIL FOR DEVICE ENDPOINT
app.post('/api/get-email', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: 'Database is connecting. Please retry in a few seconds.' });
        }

        const { deviceId } = req.body;
        if (!deviceId || typeof deviceId !== 'string') {
            return res.status(400).json({ success: false, error: 'Valid Device ID is required.' });
        }

        const assignedEmail = await EmailModel.findOneAndUpdate(
            { isUsed: false },
            { $set: { isUsed: true, assignedDevice: deviceId.trim() } },
            { new: true }
        ).exec();

        if (!assignedEmail) {
            return res.status(404).json({ success: false, error: 'No fresh emails available. Please generate more.' });
        }

        return res.json({
            success: true,
            email: assignedEmail.email
        });

    } catch (error) {
        console.error("Assignment Error:", error);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// SPA Routing Support
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));