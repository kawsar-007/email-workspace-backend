import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import axios from 'axios';
import { faker } from '@faker-js/faker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://user:pass@cluster.mongodb.net/emaildb";
mongoose.connect(MONGO_URI).catch(err => console.error('MongoDB Error:', err));

const emailSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    domain: { type: String, required: true, index: true },
    isUsed: { type: Boolean, default: false, index: true },
    assignedDevice: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
const EmailModel = mongoose.model('Email', emailSchema);

const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'aol.com', 'protonmail.com', 'zoho.com', 'yandex.com', 'mail.com',
    'gmx.com', 'hubspot.com', 'mailchimp.com', 'sendgrid.com', 'fastmail.com',
    'tutanota.com', 'runbox.com', 'hushmail.com', 'lycos.com', 'zohomail.com', 'inbox.com'
];

// MX Verification
async function isValidDomainFast(email) {
    try {
        const domain = email.split('@')[1];
        if (!domain) return false;
        const mxPromise = dns.resolveMx(domain);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000));
        const mxRecords = await Promise.race([mxPromise, timeoutPromise]);
        return mxRecords && mxRecords.length > 0;
    } catch {
        return false;
    }
}

// Multi-Source Fetching
async function fetchEmailsFromPublicSources(targetDomain) {
    let rawContent = '';
    const name = faker.person.firstName().toLowerCase();

    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    try {
        const hnRes = await axios.get(`https://hn.algolia.com/api/v1/search?query=${name}%20${targetDomain}&hitsPerPage=30`, { timeout: 3000 });
        rawContent += ' ' + JSON.stringify(hnRes.data);
    } catch (e) {}

    try {
        const redditRes = await axios.get(`https://www.reddit.com/search.json?q=${name}+${targetDomain}&limit=25`, { headers, timeout: 3000 });
        rawContent += ' ' + JSON.stringify(redditRes.data);
    } catch (e) {}

    try {
        const params = new URLSearchParams({ q: `${name} "@${targetDomain}"` });
        const ddgRes = await axios.post('https://lite.duckduckgo.com/lite/', params.toString(), {
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 2500
        });
        rawContent += ' ' + ddgRes.data;
    } catch (e) {}

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    return [...new Set(rawContent.match(emailRegex) || [])];
}

// 1. SCRAPE ENDPOINT (MULTIPLE DOMAINS SUPPORT)
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 10, domains = [] } = req.body;
        const requestedCount = Math.min(parseInt(count) || 10, 50);

        const targetDomains = domains.length > 0 ? domains : ALLOWED_DOMAINS;

        // নির্বাচিত ডোমেইনগুলোর উপর প্যারালাল স্ক্র্যাপিং
        const tasks = [];
        for (let i = 0; i < 5; i++) {
            const randomDomain = targetDomains[Math.floor(Math.random() * targetDomains.length)];
            tasks.push(fetchEmailsFromPublicSources(randomDomain));
        }

        const results = await Promise.all(tasks);
        const extracted = [...new Set(results.flat())];

        let validEmails = [];

        for (const rawEmail of extracted) {
            if (validEmails.length >= requestedCount) break;

            const email = rawEmail.toLowerCase().trim();
            const emailDomain = email.split('@')[1];
            if (!emailDomain) continue;

            // কাস্টম ফিল্টারিং
            if (!targetDomains.includes(emailDomain)) continue;

            const exists = await EmailModel.findOne({ email });
            if (exists) continue;

            const hasValidMx = await isValidDomainFast(email);
            if (hasValidMx) {
                try {
                    await EmailModel.create({ email, domain: emailDomain, isUsed: false });
                    validEmails.push(email);
                } catch (e) {
                    continue;
                }
            }
        }

        if (validEmails.length === 0) {
            return res.json({
                success: false,
                error: 'No new emails matched selected domains. Try again.'
            });
        }

        res.json({
            success: true,
            message: `Scraped and saved ${validEmails.length} MX-verified emails!`,
            emails: validEmails
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Scraping timeout occurred.' });
    }
});

// 2. ASSIGN ENDPOINT
app.post('/api/get-email', async (req, res) => {
    try {
        const { deviceId, domains = [] } = req.body;
        if (!deviceId) return res.status(400).json({ success: false, error: 'Device ID required.' });

        const query = { isUsed: false };
        if (domains.length > 0) {
            query.domain = { $in: domains };
        }

        const candidates = await EmailModel.find(query).limit(10);

        if (candidates.length === 0) {
            return res.status(404).json({ success: false, error: 'No fresh emails for selected domains. Scrape first.' });
        }

        let assignedEmailDoc = null;

        for (const doc of candidates) {
            const isMxValid = await isValidDomainFast(doc.email);
            if (isMxValid) {
                assignedEmailDoc = await EmailModel.findOneAndUpdate(
                    { _id: doc._id, isUsed: false },
                    { $set: { isUsed: true, assignedDevice: deviceId.trim() } },
                    { new: true }
                );
                if (assignedEmailDoc) break;
            } else {
                await EmailModel.deleteOne({ _id: doc._id });
            }
        }

        if (!assignedEmailDoc) {
            return res.status(404).json({ success: false, error: 'Selected emails failed MX check. Scrape again.' });
        }

        res.json({ success: true, email: assignedEmailDoc.email });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));