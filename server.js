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

// Fast MX Check with 1.5s Timeout
async function isValidDomainFast(email) {
    try {
        const domain = email.split('@')[1];
        if (!domain) return false;
        const mxPromise = dns.resolveMx(domain);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1500));
        const mxRecords = await Promise.race([mxPromise, timeoutPromise]);
        return mxRecords && mxRecords.length > 0;
    } catch {
        return false;
    }
}

// Single Scraping Task with Faker.js
async function scrapeBatchWithFaker(selectedDomain) {
    let allText = '';
    const fakeName = faker.person.fullName();
    const targetDomain = selectedDomain === 'all' 
        ? ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)] 
        : selectedDomain;
    
    const query = `"${fakeName}" "@${targetDomain}"`;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    try {
        const params = new URLSearchParams({ q: query });
        const { data } = await axios.post('https://lite.duckduckgo.com/lite/', params.toString(), {
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 2500
        });
        const $ = cheerio.load(data);
        allText += ' ' + $('body').text();
    } catch (e) {}

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    return [...new Set(allText.match(emailRegex) || [])];
}

// FAST SCRAPE & SAVE ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 10, domain = 'all' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 10, 50);

        // ৫টি Faker নাম তৈরি করে প্যারালাল স্ক্র্যাপ রান করা (দ্রুত রেসপন্সের জন্য)
        const parallelTasks = Array.from({ length: 5 }, () => scrapeBatchWithFaker(domain));
        const resultsArray = await Promise.all(parallelTasks);
        const scraped = [...new Set(resultsArray.flat())];

        let validEmailsList = [];

        for (const email of scraped) {
            if (validEmailsList.length >= requestedCount) break;

            const emailDomain = email.split('@')[1]?.toLowerCase();
            if (!emailDomain) continue;

            if (domain !== 'all' && emailDomain !== domain.toLowerCase()) continue;
            if (domain === 'all' && !ALLOWED_DOMAINS.includes(emailDomain)) continue;

            // ১. ডুপ্লিকেট চেক
            const exists = await EmailModel.findOne({ email });
            if (exists) continue;

            // ২. MX ভ্যালিডেশন
            const isValidMx = await isValidDomainFast(email);
            if (isValidMx) {
                try {
                    await EmailModel.create({ email, isUsed: false });
                    validEmailsList.push(email);
                } catch (e) {
                    continue;
                }
            }
        }

        if (validEmailsList.length === 0) {
            return res.json({
                success: false,
                error: 'No valid emails scraped in this round. Please click "Scrape Real Emails" again.'
            });
        }

        res.json({
            success: true,
            message: `Scraped & MX-verified ${validEmailsList.length} real emails using Faker!`,
            emails: validEmailsList
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Scraping process timed out.' });
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