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

// Schema Definition
const emailSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false, index: true },
    assignedDevice: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
const EmailModel = mongoose.model('Email', emailSchema);

// ২১টি অফিশিয়াল ডোমেইন
const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'aol.com', 'protonmail.com', 'zoho.com', 'yandex.com', 'mail.com',
    'gmx.com', 'hubspot.com', 'mailchimp.com', 'sendgrid.com', 'fastmail.com',
    'tutanota.com', 'runbox.com', 'hushmail.com', 'lycos.com', 'zohomail.com', 'inbox.com'
];

// সোশ্যাল মিডিয়া প্ল্যাটফর্ম সমূহের লিস্ট
const SOCIAL_PLATFORMS = ['site:facebook.com', 'site:instagram.com', 'site:linkedin.com', 'site:twitter.com'];

// র‍্যান্ডম ফার্স্ট ও লাস্ট নেম ডাটাসেট
const firstNames = ['james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles', 'alexander', 'daniel', 'matthew', 'anthony', 'mark', 'emily', 'emma', 'olivia', 'sophia', 'isabella', 'mia', 'charlotte', 'amelia', 'harper', 'evelyn'];
const lastNames = ['smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis', 'rodriguez', 'martinez', 'hernandez', 'lopez', 'gonzales', 'wilson', 'anderson', 'thomas', 'taylor', 'moore', 'jackson', 'martin', 'lee', 'perez', 'thompson', 'white'];

function getRandomName() {
    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${fn} ${ln}`;
}

// MX Record Fast Check Function
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

// সোশ্যাল মিডিয়া এবং ইঞ্জিন থেকে নাম দিয়ে স্ক্র্যাপ করার ফাংশন
async function scrapeEmailsByName(selectedDomain) {
    let allText = '';
    const nameQuery = getRandomName();
    const platform = SOCIAL_PLATFORMS[Math.floor(Math.random() * SOCIAL_PLATFORMS.length)];
    
    // নির্দিষ্ট ডোমেইন বেছে নিলে শুধু সেটি, অন্যথায় অল
    const targetDomain = selectedDomain === 'all' ? 'gmail.com' : selectedDomain;
    const query = `${platform} "${nameQuery}" "@${targetDomain}"`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // Source 1: DuckDuckGo Lite
    try {
        const params = new URLSearchParams();
        params.append('q', query);
        const { data } = await axios.post('https://lite.duckduckgo.com/lite/', params.toString(), {
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 4000
        });
        const $ = cheerio.load(data);
        allText += ' ' + $('body').text();
    } catch (e) {}

    // Source 2: Bing
    try {
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(bingUrl, { headers, timeout: 4000 });
        const $ = cheerio.load(data);
        allText += ' ' + $('body').text();
    } catch (e) {}

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    return [...new Set(allText.match(emailRegex) || [])];
}

// SCRAPE & VERIFY ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 10, domain = 'all' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 10, 50);

        let validEmailsList = [];
        let attempts = 0;
        const maxAttempts = 10; // সর্বোচ্চ ১০ বার নাম পরিবর্তন করে সোশ্যাল মিডিয়ায় খুঁজবে

        while (validEmailsList.length < requestedCount && attempts < maxAttempts) {
            attempts++;
            const scraped = await scrapeEmailsByName(domain);

            for (const email of scraped) {
                if (validEmailsList.length >= requestedCount) break;

                const emailDomain = email.split('@')[1]?.toLowerCase();
                if (!emailDomain) continue;

                // ডোমেইন ফিল্টারিং
                if (domain !== 'all' && emailDomain !== domain.toLowerCase()) continue;
                if (domain === 'all' && !ALLOWED_DOMAINS.includes(emailDomain)) continue;

                // ১. ডুপ্লিকেট চেক (MongoDB)
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
        }

        if (validEmailsList.length === 0) {
            return res.json({
                success: false,
                error: 'No valid emails found in this attempt. Try scraping again!'
            });
        }

        res.json({
            success: true,
            message: `Scraped and saved ${validEmailsList.length} real & MX-verified emails from social media!`,
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
            return res.status(404).json({ success: false, error: 'No fresh emails in DB. Scrape more.' });
        }

        res.json({ success: true, email: assignedEmail.email });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));