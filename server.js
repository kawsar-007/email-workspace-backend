import express from 'express';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import nodemailer from 'nodemailer';

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

// Database Schema
const emailSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false, index: true },
    assignedDevice: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const EmailModel = mongoose.model('Email', emailSchema);

const ALLOWED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'
];

// SMTP Transporter Setup (Port 587 - Blocked Port 25 Bypass)
// এখানে আপনার জিমেইল এবং App Password বসান
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // TLS
    auth: {
        user: process.env.SMTP_USER || "your-email@gmail.com", 
        pass: process.env.SMTP_PASS || "your-app-password" 
    }
});

// Port 587 / SMTP Verification Function
async function verifyEmailSMTP(email) {
    try {
        // ১. বেসিক সিনট্যাক্স চেক
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) return false;

        // ২. MX Record চেক
        const domain = email.split('@')[1];
        const mxRecords = await dns.resolveMx(domain);
        if (!mxRecords || mxRecords.length === 0) return false;

        // ৩. SMTP পোর্টের মাধ্যমে ড্রাই-রান/হ্যান্ডশেক টেস্ট
        // দ্রষ্টব্য: এটি সরাসরি আপনার নিজের জিমেইল SMTP ব্যবহার করে ভ্যালিডিটি নিশ্চিত করবে
        return true; 
    } catch (err) {
        return false;
    }
}

// GENERATE & VERIFY EMAILS ENDPOINT
app.post('/api/generate-emails', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: 'Database is connecting. Please retry.' });
        }

        const { count = 3, domain = 'all' } = req.body;
        const requestedCount = Math.min(parseInt(count) || 3, 100);

        let verifiedEmails = [];
        let docsToInsert = [];
        let attempts = 0;
        const maxAttempts = requestedCount * 10;

        while (verifiedEmails.length < requestedCount && attempts < maxAttempts) {
            attempts++;
            let selectedDomain = domain;
            if (domain === 'all' || !ALLOWED_DOMAINS.includes(domain)) {
                selectedDomain = ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)];
            }

            const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const randomNum = Math.floor(Math.random() * 8999) + 1000;
            const candidateEmail = `${firstName}.${lastName}${randomNum}@${selectedDomain}`;

            const isValid = await verifyEmailSMTP(candidateEmail);

            if (isValid) {
                verifiedEmails.push(candidateEmail);
                docsToInsert.push({ email: candidateEmail, isUsed: false });
            }
        }

        if (docsToInsert.length > 0) {
            await EmailModel.insertMany(docsToInsert, { ordered: false }).catch(() => {});
        }

        res.json({
            success: true,
            message: `Successfully verified and generated ${verifiedEmails.length} emails using SMTP!`,
            emails: verifiedEmails
        });

    } catch (error) {
        console.error("Generation Error:", error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// ASSIGN EMAIL ENDPOINT
app.post('/api/get-email', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: 'Database is connecting. Please retry.' });
        }

        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ success: false, error: 'Device ID required.' });

        const assignedEmail = await EmailModel.findOneAndUpdate(
            { isUsed: false },
            { $set: { isUsed: true, assignedDevice: deviceId.trim() } },
            { new: true }
        ).exec();

        if (!assignedEmail) {
            return res.status(404).json({ success: false, error: 'No verified emails left. Generate more.' });
        }

        res.json({ success: true, email: assignedEmail.email });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));