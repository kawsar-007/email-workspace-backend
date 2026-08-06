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
mongoose.connect(MONGO_URI).catch(err => console.error('MongoDB Error:', err));

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

// MX Check
async function isValidDomainFast(email) {
    try {
        const domain = email.split('@')[1];
        if (!domain) return false;
        const mxPromise = dns.resolveMx(domain);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500));
        const mxRecords = await Promise.race([mxPromise, timeoutPromise]);
        return mxRecords && mxRecords.length > 0;
    } catch {
        return false;
    }
}

// Improved Multi-Engine Scraper (Bing + DuckDuckGo)
async function scrapeRealEmails(keyword, selectedDomain) {
    let allExtracted = [];

    // Simple search queries (Strict boolean format removed to avoid 0 results)
    const targetDomain = selectedDomain === 'all' ? 'gmail.com' : selectedDomain;
    const query = `${keyword} @${targetDomain}`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    };

    // Engine 1: DuckDuckGo HTML
    try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(ddgUrl, { headers, timeout: 5000 });
        const $ = cheerio.load(data);
        const text = $('body').text();
        const found = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        allExtracted.push(...found);
    } catch (e) {
        console.log('DuckDuckGo Scrape bypassed or timed out.');
    }

    // Engine 2: Bing Search Fallback
    try {
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(bingUrl, { headers, timeout: 5000 });
        const $ = cheerio.load(data);
        const text = $('body').text();
        const found = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        allExtracted.push(...found);
    } catch (e) {
        console.log('Bing Scrape bypassed or timed out.');
    }

    // Cleanup & Distinct list
    return [...new Set(allExtracted)];
}

// ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 10, domain = 'all', target = 'marketing' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 10, 50);

        const scrapedEmails = await scrapeRealEmails(target, domain);

        if (scrapedEmails.length === 0) {
            return res.json({ 
                success: false, 
                error: 'No emails found right now. Try keywords like "crypto", "business", "contact", or select a specific domain like "gmail.com".' 
            });
        }

        // 1. Domain Match Filtering
        const filteredCandidateEmails = scrapedEmails.filter(email => {
            const emailDomain = email.split('@')[1]?.toLowerCase();
            if (!emailDomain) return false;
            if (domain !== 'all') return emailDomain === domain.toLowerCase();
            return ALLOWED_DOMAINS.includes(emailDomain);
        });

        if (filteredCandidateEmails.length === 0) {
            return res.json({ 
                success: false, 
                error: 'Emails were scraped, but none matched your domain filter. Try selecting "gmail.com" or "All Domains".' 
            });
        }

        // 2. Check Existing Database Emails
        const existingDocs = await EmailModel.find({ email: { $in: filteredCandidateEmails } }).select('email');
        const existingEmails = new Set(existingDocs.map(d => d.email));
        const freshEmails = filteredCandidateEmails.filter(e => !existingEmails.has(e));

        // 3. Parallel MX Verification
        const verificationResults = await Promise.all(
            freshEmails.map(async (email) => {
                const valid = await isValidDomainFast(email);
                return valid ? email : null;
            })
        );

        const validEmailsList = verificationResults.filter(Boolean).slice(0, requestedCount);

        // 4. Bulk Save
        if (validEmailsList.length > 0) {
            const docsToInsert = validEmailsList.map(email => ({ email, isUsed: false }));
            await EmailModel.insertMany(docsToInsert, { ordered: false }).catch(() => {});
        } else {
            return res.json({ success: false, error: 'Emails found were either duplicates or invalid MX domains. Try again.' });
        }

        res.json({
            success: true,
            message: `Scraped & verified ${validEmailsList.length} real unique emails!`,
            emails: validEmailsList
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Internal scraping error.' });
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
            return res.status(404).json({ success: false, error: 'No fresh emails in DB. Scrape first.' });
        }

        res.json({ success: true, email: assignedEmail.email });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));