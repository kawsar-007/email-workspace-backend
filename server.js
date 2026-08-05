const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { faker } = require('@faker-js/faker');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment / Config Variables
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kawsarmahamud14_db_user:BZHFzP67WepBJEGF@cluster0.rtr3kmq.mongodb.net/emailDB?retryWrites=true&w=majority";

// MongoDB Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Email Schema
const emailSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  assigned: { type: Boolean, default: false },
  deviceId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

const Email = mongoose.model('Email', emailSchema);

// ২১টি ডোমেইন প্রোভাইডার লিস্ট
const defaultDomains = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'aol.com', 'protonmail.com', 'zoho.com', 'gmx.com', 'mail.com',
  'yandex.com', 'fastmail.com', 'hushmail.com', 'lycos.com', 'inbox.com',
  'rediffmail.com', 'proton.me', 'live.com', 'msn.com', 'cox.net', 'sbcglobal.net'
];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Faker.js ব্যবহার করে আনলিমিটেড ইউনিক ইমেইল জেনারেট করার ফাংশন
function generateRandomEmail(customDomain) {
  const fname = faker.person.firstName().toLowerCase().replace(/[^a-z]/g, '');
  const lname = faker.person.lastName().toLowerCase().replace(/[^a-z]/g, '');
  const num = faker.number.int({ min: 1000, max: 9999 });
  const domain = customDomain || getRandomItem(defaultDomains);
  
  return `${fname}.${lname}${num}@${domain}`;
}

// 1. Fetch Domains
app.get('/api/domains', (req, res) => {
  res.json({ domains: defaultDomains });
});

// 2. Generate Emails
app.post('/api/emails/generate', async (req, res) => {
  try {
    const { count = 1, domain } = req.body;
    const limit = parseInt(count) || 1;
    let generatedCount = 0;

    for (let i = 0; i < limit; i++) {
      const emailStr = generateRandomEmail(domain);
      try {
        await Email.create({ email: emailStr });
        generatedCount++;
      } catch (err) {
        // Skip duplicate email errors if any overlap happens
      }
    }

    res.json({ 
      success: true, 
      message: `${generatedCount} emails generated and saved successfully.`,
      count: generatedCount 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Fetch Unused Email for Device (Atomic Operation)
app.post('/api/emails/fetch-unused', async (req, res) => {
  try {
    const deviceId = req.body.deviceId || req.body.device_id;

    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }

    const emailRecord = await Email.findOneAndUpdate(
      { assigned: false },
      { $set: { assigned: true, deviceId: deviceId } },
      { new: true }
    );

    if (!emailRecord) {
      return res.status(404).json({ success: false, message: 'No unused emails available' });
    }

    res.json({
      success: true,
      email: emailRecord.email,
      deviceId: emailRecord.deviceId
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Serve Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});