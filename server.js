import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import axios from 'axios';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://user:pass@cluster.mongodb.net/emaildb";
mongoose.connect(MONGO_URI).catch(err => console.error(err));

// Database Schema
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

// Fast MX Check with Timeout
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

// Optimized Scrape Function
async function scrapeRealEmails(keyword, domain) {
    try {
        const searchQuery = domain === 'all' 
            ? `"${keyword}" "@gmail.com" OR "@yahoo.com" OR "@outlook.com"` 
            : `"${keyword}" "@${domain}"`;

        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 4000 // 4 seconds max timeout
        });

        const $ = cheerio.load(data);
        const textContent = $('body').text();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        
        return [...new Set(textContent.match(emailRegex) || [])];
    } catch (err) {
        return [];
    }
}

// FAST SCRAPE & SAVE ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 10, domain = 'all', target = 'marketing' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 10, 50);

        const scrapedEmails = await scrapeRealEmails(target, domain);
        if (scrapedEmails.length === 0) {
            return res.json({ success: false, error: 'No emails found for this target. Try another keyword.' });
        }

        // ১. একবারে ডোমেইন ফিল্টারিং
        const filteredCandidateEmails = scrapedEmails.filter(email => {
            const emailDomain = email.split('@')[1];
            if (domain !== 'all') return emailDomain === domain;
            return ALLOWED_DOMAINS.includes(emailDomain);
        });

        // ২. ডাটাবেসে একসাথে ডুপ্লিকেট চেক (Bulk Query)
        const existingDocs = await EmailModel.find({ email: { $in: filteredCandidateEmails } }).select('email');
        const existingEmails = new Set(existingDocs.map(d => d.email));
        const freshEmails = filteredCandidateEmails.filter(e => !existingEmails.has(e));

        // ৩. প্যারালাল MX ভ্যালিডেশন (Parallel Verification)
        const verificationResults = await Promise.all(
            freshEmails.map(async (email) => {
                const valid = await isValidDomainFast(email);
                return valid ? email : null;
            })
        );

        const validEmailsList = verificationResults.filter(Boolean).slice(0, requestedCount);

        // ৪. ডাটাবেসে ইনসার্ট
        if (validEmailsList.length > 0) {
            const docsToInsert = validEmailsList.map(email => ({ email, isUsed: false }));
            await EmailModel.insertMany(docsToInsert, { ordered: false }).catch(() => {});
        }

        res.json({
            success: true,
            message: `Scraped and saved ${validEmailsList.length} unique real emails!`,
            emails: validEmailsList
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Scraping process failed.' });
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
            return res.status(404).json({ success: false, error: 'No fresh emails left. Please scrape more.' });
        }

        res.json({ success: true, email: assignedEmail.email });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));