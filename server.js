import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import axios from 'axios';
import * as cheerio from 'cheerio';
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

// Fast MX Record Check
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

// Scrape Emails via Multiple Sources
async function fetchRealEmails(selectedDomain) {
    let rawText = '';
    const firstName = faker.person.firstName();
    const targetDomain = selectedDomain === 'all' 
        ? ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)] 
        : selectedDomain;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36'
    };

    // Source 1: DuckDuckGo Lite (Optimized Query)
    try {
        const query = `${firstName} ${targetDomain}`;
        const params = new URLSearchParams({ q: query });
        const { data } = await axios.post('https://lite.duckduckgo.com/lite/', params.toString(), {
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 3000
        });
        const $ = cheerio.load(data);
        rawText += ' ' + $('body').text();
    } catch (e) {}

    // Source 2: Reddit Public API (High Yield Fallback)
    try {
        const redditQuery = `${firstName} ${targetDomain}`;
        const res = await axios.get(`https://www.reddit.com/search.json?q=${encodeURIComponent(redditQuery)}&limit=25`, {
            headers,
            timeout: 3000
        });
        rawText += ' ' + JSON.stringify(res.data);
    } catch (e) {}

    // Extract emails using Regex
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    return [...new Set(rawText.match(emailRegex) || [])];
}

// SCRAPE & VERIFY ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 10, domain = 'all' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 10, 50);

        // Run parallel scraping tasks for higher success rate
        const parallelScrapes = Array.from({ length: 6 }, () => fetchRealEmails(domain));
        const results = await Promise.all(parallelScrapes);
        const extractedEmails = [...new Set(results.flat())];

        let validEmails = [];

        for (const email of extractedEmails) {
            if (validEmails.length >= requestedCount) break;

            const cleanEmail = email.toLowerCase().trim();
            const emailDomain = cleanEmail.split('@')[1];
            if (!emailDomain) continue;

            // Domain Filter
            if (domain !== 'all' && emailDomain !== domain.toLowerCase()) continue;
            if (domain === 'all' && !ALLOWED_DOMAINS.includes(emailDomain)) continue;

            // 1. Check DB Duplicates
            const exists = await EmailModel.findOne({ email: cleanEmail });
            if (exists) continue;

            // 2. MX Record Validation
            const hasValidMx = await isValidDomainFast(cleanEmail);
            if (hasValidMx) {
                try {
                    await EmailModel.create({ email: cleanEmail, isUsed: false });
                    validEmails.push(cleanEmail);
                } catch (e) {
                    continue;
                }
            }
        }

        if (validEmails.length === 0) {
            return res.json({
                success: false,
                error: 'No new emails matched criteria in this attempt. Click "Scrape Real Emails" again.'
            });
        }

        res.json({
            success: true,
            message: `Scraped and MX-verified ${validEmails.length} real emails!`,
            emails: validEmails
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Server scraping timeout. Please try again.' });
    }
});

// ASSIGN EMAIL ENDPOINT
app.post('/api/get-email', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ success: false, error: 'Device ID required.' });

        const assignedEmail = await EmailModel.findOneAndUpdate(
            { isUsed: false },
            { $set: { isUsed: true, assignedDevice: deviceId.trim() } },
            { new: true }
        ).exec();

        if (!assignedEmail) {
            return res.status(404).json({ success: false, error: 'No fresh emails in DB. Scrape more first.' });
        }

        res.json({ success: true, email: assignedEmail.email });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));