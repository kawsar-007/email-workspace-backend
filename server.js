import express from 'express';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import validate from 'deep-email-validator';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// MongoDB Atlas Connection (আপনার মঙ্গোডিবি ইউআরএল বসাবেন)
const MONGO_URI = process.env.MONGO_URI || 'YOUR_MONGODB_CONNECTION_STRING';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Database Schema Setup
const emailSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    isUsed: { type: Boolean, default: false },
    deviceId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
const Email = mongoose.model('Email', emailSchema);

// Helper Function: Live SMTP Validation
async function checkEmailValidity(email) {
    try {
        const res = await validate({
            email: email,
            validateRegex: true,
            validateMx: true,
            validateTypo: false,
            validateDisposable: false,
            validateSMTP: true // লাইভ ইনবক্স চেক করবে
        });
        return res.valid;
    } catch (error) {
        return false;
    }
}

// 1. Route: SMTP ভ্যালিডেশন করে ইমেইল জেনারেট ও সেভ করা
app.post('/api/generate-emails', async (req, res) => {
    try {
        const { count = 5, domain } = req.body;
        const verifiedEmails = [];
        let attempts = 0;
        const maxAttempts = count * 8; // Safety limit

        while (verifiedEmails.length < count && attempts < maxAttempts) {
            attempts++;
            const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const selectedDomain = domain || 'gmail.com';
            const candidateEmail = `${firstName}.${lastName}${Math.floor(Math.random() * 899 + 100)}@${selectedDomain}`;

            // ডাটাবেজে আগে থেকে আছে কি না চেক
            const exists = await Email.findOne({ email: candidateEmail });
            if (exists) continue;

            // SMTP Handshake Verification
            const isValid = await checkEmailValidity(candidateEmail);
            if (isValid) {
                verifiedEmails.push({ email: candidateEmail, isUsed: false });
            }
        }

        if (verifiedEmails.length > 0) {
            await Email.insertMany(verifiedEmails, { ordered: false }).catch(() => {});
        }

        res.json({
            success: true,
            message: `${verifiedEmails.length}টি লাইভ সচল ইমেইল ডাটাবেজে সেভ করা হয়েছে!`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "ইমেইল জেনারেট করতে সমস্যা হয়েছে।" });
    }
});

// 2. Route: একই ডিভাইসকে প্রতিবার নতুন (Unused) ইমেইল দেওয়া
app.post('/api/get-device-email', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ success: false, error: "Device ID প্রয়োজন।" });

        // সরাসরি পরবর্তী unused (isUsed: false) ইমেইলটি নিয়ে Lock করবে
        const assignedDoc = await Email.findOneAndUpdate(
            { isUsed: false },
            { $set: { isUsed: true, deviceId: deviceId } },
            { new: true, sort: { createdAt: 1 } }
        );

        if (assignedDoc) {
            res.json({ success: true, email: assignedDoc.email });
        } else {
            res.status(404).json({ success: false, error: "ডাটাবেজে কোনো খালি ভ্যালিড ইমেইল নেই! নতুন ইমেইল জেনারেট করুন।" });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "সার্ভার অভ্যন্তরীণ ত্রুটি।" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));