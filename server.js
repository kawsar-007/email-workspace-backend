const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const dns = require('dns').promises;
const validator = require('email-validator');
const path = require('path');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Web Dashboard Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Direct MongoDB Atlas Connection with Provided Credentials
const mongoURI = "mongodb+srv://kawsarmahamud14_db_user:BZHFzP67WepBJEGF@cluster0.abcde.mongodb.net/EmailDB?retryWrites=true&w=majority";

mongoose.connect(process.env.MONGO_URI || mongoURI)
  .then(() => console.log('MongoDB Database Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Schema Definition
const EmailSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  isUsed: { type: Boolean, default: false },
  usedByDevice: { type: String, default: null },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const Email = mongoose.model('Email', EmailSchema);

// Expanded First Name Pool (50+ Names)
const firstNames = [
  'john', 'alex', 'david', 'michael', 'james', 'robert', 'william', 'daniel', 'matthew', 'joseph', 
  'samuel', 'anthony', 'andrew', 'ryan', 'brandon', 'jason', 'ethan', 'joshua', 'noah', 'logan', 
  'lucas', 'jackson', 'benjamin', 'mason', 'oliver', 'jacob', 'elijah', 'liam', 'alexander', 'henry', 
  'sebastian', 'jack', 'owen', 'theodore', 'wyatt', 'luke', 'julian', 'leo', 'jayden', 'gabriel', 
  'dylan', 'grayson', 'levi', 'isaac', 'cameron', 'caleb', 'christian', 'hunter', 'aaron', 'charles'
];

// Expanded Last Name Pool (50+ Names)
const lastNames = [
  'smith', 'johnson', 'williams', 'brown', 'jones', 'miller', 'davis', 'garcia', 'rodriguez', 'wilson', 
  'martinez', 'taylor', 'anderson', 'thomas', 'white', 'harris', 'martin', 'thompson', 'robinson', 'clark', 
  'lewis', 'lee', 'walker', 'hall', 'allen', 'young', 'hernandez', 'king', 'wright', 'lopez', 
  'hill', 'scott', 'green', 'adams', 'baker', 'gonzalez', 'nelson', 'carter', 'mitchell', 'perez', 
  'roberts', 'turner', 'phillips', 'campbell', 'parker', 'evans', 'edwards', 'collins', 'stewart', 'morris'
];

// Full Domain Pool (Major, Regional & Free Webmail Providers)
const defaultDomains = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'live.com', 'msn.com', 'ymail.com', 'rocketmail.com',
  'aol.com', 'protonmail.com', 'zoho.com', 'mail.com', 'gmx.com',
  'gmx.de', 'web.de', 'mail.ru', 'yandex.com', 'cox.net', 'sbcglobal.net', 'comcast.net'
];

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Custom Email Pattern Generator
function generateEmailPattern(customDomain) {
  const fName = getRandomElement(firstNames);
  const lName = getRandomElement(lastNames);
  const randomNum = Math.floor(100 + Math.random() * 9900);
  const domain = customDomain || getRandomElement(defaultDomains);

  const formats = [
    `${fName}.${lName}${randomNum}@${domain}`,
    `${fName}${lName}${randomNum}@${domain}`,
    `${fName}_${lName}${randomNum}@${domain}`,
    `${lName}.${fName}${randomNum}@${domain}`,
    `${fName}${randomNum}@${domain}`
  ];

  return getRandomElement(formats);
}

// MX Validation Helper Function
async function validateMxRecord(email) {
  try {
    const domain = email.split('@')[1];
    const addresses = await dns.resolveMx(domain);
    return addresses && addresses.length > 0;
  } catch (err) {
    return false;
  }
}

// 1. Unlimited / Bulk Background Email Generator API (Validated)
app.post('/api/emails/generate', async (req, res) => {
  const { count = 0, domain } = req.body; // count = 0 means Unlimited

  res.json({
    success: true,
    message: `Background email generation started for ${count === 0 ? 'unlimited' : count} records.`
  });

  (async () => {
    let generatedCount = 0;
    const target = count === 0 ? Infinity : count;

    while (generatedCount < target) {
      const email = generateEmailPattern(domain);

      // Check Syntax & MX Record
      if (validator.validate(email)) {
        const isValidMx = await validateMxRecord(email);
        if (isValidMx) {
          try {
            const newEmail = new Email({ email });
            await newEmail.save();
            generatedCount++;
            
            if (generatedCount % 10 === 0) {
              console.log(`[Workspace Engine] Generated & saved ${generatedCount} validated emails.`);
            }
          } catch (err) {
            // Skips duplicates automatically
          }
        }
      }
      
      // Prevent high CPU usage
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  })();
});

// 2. Manual Email Input & MX Validation API
app.post('/api/emails/add', async (req, res) => {
  const { email } = req.body;

  if (!email || !validator.validate(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }

  try {
    const isValidMx = await validateMxRecord(email);
    if (!isValidMx) {
      return res.status(400).json({ success: false, message: 'Domain MX record invalid' });
    }

    const newEmail = new Email({ email });
    await newEmail.save();
    res.json({ success: true, message: 'Email validated and added', data: newEmail });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already exists in database' });
    }
    res.status(500).json({ success: false, message: 'Server or Domain validation error' });
  }
});

// 3. Fetch Unused Email for Device (Ensures 1 Email -> 1 Device Only)
app.post('/api/emails/fetch-unused', async (req, res) => {
  const { deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  try {
    // Atomic Operation: Finds unassigned email and locks it instantly
    const emailRecord = await Email.findOneAndUpdate(
      { isUsed: false },
      { 
        $set: { 
          isUsed: true, 
          usedByDevice: deviceId, 
          usedAt: new Date() 
        } 
      },
      { new: true, sort: { createdAt: 1 } }
    );

    if (!emailRecord) {
      return res.status(404).json({ success: false, message: 'No unused emails available in database' });
    }

    res.json({
      success: true,
      email: emailRecord.email,
      assignedTo: emailRecord.usedByDevice
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));