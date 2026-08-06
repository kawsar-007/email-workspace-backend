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

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('MongoDB Connected Successfully'))
.catch(err => console.error('MongoDB Connection Error:', err));

// Database Schema (unique: true ডুপ্লিকেট এড়াতে সাহায্য করে)
const emailSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false, index: true },
    assignedDevice: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const EmailModel = mongoose.model('Email', emailSchema);

// ২১টি অনুমোদিত ডোমেইন লিস্ট
const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'aol.com', 'protonmail.com', 'zoho.com', 'yandex.com', 'mail.com',
    'gmx.com', 'hubspot.com', 'mailchimp.com', 'sendgrid.com', 'fastmail.com',
    'tutanota.com', 'runbox.com', 'hushmail.com', 'lycos.com', 'zohomail.com', 'inbox.com'
];

// MX Record Check Function
async function isValidDomain(email) {
    try {
        const domain = email.split('@')[1];
        if (!domain) return false;
        const mxRecords = await dns.resolveMx(domain);
        return mxRecords && mxRecords.length > 0;
    } catch {
        return false;
    }
}

// Scrape Function (Search & Extract)
async function scrapeRealEmails(keyword, domain) {
    try {
        const searchQuery = domain === 'all' 
            ? `"${keyword}" "@gmail.com" OR "@yahoo.com" OR "@outlook.com" OR "@zoho.com"` 
            : `"${keyword}" "@${domain}"`;

        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36' 
            }
        });

        const $ = cheerio.load(data);
        const textContent = $('body').text();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        
        return [...new Set(textContent.match(emailRegex) || [])];
    } catch (err) {
        return [];
    }
}

// SCRAPE & SAVE ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: 'Database connecting. Retry shortly.' });
        }

        const { count = 10, domain = 'all', target = 'marketing' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 10, 50);

        const scrapedEmails = await scrapeRealEmails(target, domain);
        let validEmailsList = [];

        for (const email of scrapedEmails) {
            if (validEmailsList.length >= requestedCount) break;

            const emailDomain = email.split('@')[1];

            // Domain match checking
            if (domain !== 'all' && emailDomain !== domain) continue;
            if (domain === 'all' && !ALLOWED_DOMAINS.includes(emailDomain)) continue;

            // ১. MongoDB তে আগে সেভ করা আছে কি না চেক
            const exists = await EmailModel.findOne({ email });
            if (exists) continue;

            // ২. MX Record চেক
            const validMx = await isValidDomain(email);
            if (validMx) {
                try {
                    await EmailModel.create({ email, isUsed: false });
                    validEmailsList.push(email);
                } catch (e) {
                    continue; // Duplicate entry bypass
                }
            }
        }

        res.json({
            success: true,
            message: `Scraped and verified ${validEmailsList.length} unique real emails!`,
            emails: validEmailsList
        });

    } catch (error) {
        console.error("Scraping Error:", error);
        res.status(500).json({ success: false, error: 'Scraping failed.' });
    }
});

// ASSIGN EMAIL ENDPOINT
app.post('/api/get-email', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: 'Database connecting. Retry shortly.' });
        }

        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ success: false, error: 'Device ID required.' });

        const assignedEmail = await EmailModel.findOneAndUpdate(
            { isUsed: false },
            { $set: { isUsed: true, assignedDevice: deviceId.trim() } },
            { new: true }
        ).exec();

        if (!assignedEmail) {
            return res.status(404).json({ success: false, error: 'No unused emails left. Scrape more.' });
        }

        res.json({ success: true, email: assignedEmail.email });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));