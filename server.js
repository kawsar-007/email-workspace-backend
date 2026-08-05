import express from 'express';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import dns from 'dns';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const resolveMxAsync = promisify(dns.resolveMx);

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

// ALL 21 DOMAINS LIST
const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 
    'icloud.com', 'mail.com', 'zoho.com', 'proton.me', 
    'protonmail.com', 'gmx.com', 'yandex.com', 'aol.com',
    'live.com', 'msn.com', 'inbox.com', 'fastmail.com',
    'hushmail.com', 'lycos.com', 'rediffmail.com', 'comcast.net',
    'sbcglobal.net'
];

// Cache valid domains to make lookup 100x faster after first verification
const domainMxCache = new Map();

// Fast Domain MX Validity Checker
async function isDomainValid(domain) {
    if (domainMxCache.has(domain)) {
        return domainMxCache.get(domain);
    }
    try {
        const addresses = await resolveMxAsync(domain);
        const isValid = addresses && addresses.length > 0;
        domainMxCache.set(domain, isValid);
        return isValid;
    } catch (err) {
        domainMxCache.set(domain, false);
        return false;
    }
}

// FAST & VALID API: Fast parallel generation with strict validity checks
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 3, domain = 'all' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 3, 50);

        const generateAndValidateSingle = async () => {
            let selectedDomain = domain;
            if (domain === 'all' || !ALLOWED_DOMAINS.includes(domain)) {
                selectedDomain = ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)];
            }

            // Step 1: Check Domain Real-world Validity via DNS
            const validDomain = await isDomainValid(selectedDomain);
            if (!validDomain) return null;

            // Step 2: Generate clean, standard compliant email string
            const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const randomNum = Math.floor(Math.random() * 8999) + 1000;
            const email = `${firstName}.${lastName}${randomNum}@${selectedDomain}`;

            // Step 3: Save valid email to DB
            try {
                const newEmailDoc = new EmailModel({ email: email, isUsed: false });
                await newEmailDoc.save();
                return email;
            } catch (err) {
                // Ignore duplicates
                return null;
            }
        };

        // Execute batch validations concurrently in parallel promises
        const tasks = Array.from({ length: requestedCount * 3 }, () => generateAndValidateSingle());
        const rawResults = await Promise.all(tasks);
        
        // Filter non-null valid emails
        const validEmails = rawResults.filter(email => email !== null).slice(0, requestedCount);

        if (validEmails.length === 0) {
            return res.status(400).json({ success: false, error: 'Could not generate valid emails at this time.' });
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

// Wildcard Fallback Route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));