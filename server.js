const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { faker } = require('@faker-js/faker');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Database Schema & Model
const emailSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  deviceId: { type: String, default: null },
  assignedAt: { type: Date, default: null },
  isAssigned: { type: Boolean, default: false }
});

const Email = mongoose.model('Email', emailSchema);

// Supported Domains
const DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

// --- API ENDPOINTS ---

// 1. Get Available Domains
app.get('/api/domains', (req, res) => {
  res.json({ success: true, domains: DOMAINS });
});

// 2. Generate Emails (Background Generation using Faker.js)
app.post('/api/generate-emails', async (req, res) => {
  try {
    const { count = 100, domain } = req.body;
    const generateCount = parseInt(count, 10);

    // Run background insertion asynchronously
    (async () => {
      const emailDocs = [];
      for (let i = 0; i < generateCount; i++) {
        const firstName = faker.person.firstName().toLowerCase().replace(/[^a-z0-9]/g, '');
        const lastName = faker.person.lastName().toLowerCase().replace(/[^a-z0-9]/g, '');
        const randomNumber = faker.number.int({ min: 10, max: 9999 });
        
        const selectedDomain = domain && DOMAINS.includes(domain) 
          ? domain 
          : DOMAINS[Math.floor(Math.random() * DOMAINS.length)];

        const generatedEmail = `${firstName}${lastName}${randomNumber}@${selectedDomain}`;
        emailDocs.push({ email: generatedEmail });
      }

      try {
        await Email.insertMany(emailDocs, { ordered: false });
      } catch (err) {
        // Ignore duplicate key errors if generated email collides
      }
    })();

    res.json({
      success: true,
      message: `Background email generation started for ${generateCount} records.`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Assign 1:1 Unique Email for a Device (Atomic Logic)
app.post('/api/get-device-email', async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Device ID is required.' });
    }

    // Check if device already has an assigned email
    let existingAssignment = await Email.findOne({ deviceId });
    if (existingAssignment) {
      return res.json({
        success: true,
        email: existingAssignment.email,
        message: 'Retrieved existing assigned email for this device.'
      });
    }

    // Atomically find an unassigned email and map it to this device
    const assignedEmail = await Email.findOneAndUpdate(
      { isAssigned: false },
      { $set: { deviceId, isAssigned: true, assignedAt: new Date() } },
      { new: true }
    );

    if (!assignedEmail) {
      return res.status(404).json({
        success: false,
        error: 'No unassigned emails available in pool. Please generate more.'
      });
    }

    res.json({
      success: true,
      email: assignedEmail.email,
      message: 'New unique email assigned successfully.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Express v5 Compatible Wildcard Route (Fixes PathError)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});