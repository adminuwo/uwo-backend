const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Contact = require('./models/Contact');
const Website = require('./models/Website');
const Subscriber = require('./models/Subscriber');
const nodemailer = require('nodemailer');
const dns = require('dns');

// Force DNS to use Google servers to fix Reliance Jio SRV lookup issue
dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/uwo_database';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Load Admin Credentials from .json file
const fs = require('fs');
const path = require('path');
const adminsPath = path.join(__dirname, '..', '.json');
let admins = [];

try {
    const data = fs.readFileSync(adminsPath, 'utf8');
    admins = JSON.parse(data);
    console.log('✅ Admin credentials loaded from .json');
} catch (err) {
    console.error('❌ Error loading .json:', err);
    // Fallback if file missing
    admins = [{ email: "admin@uwo24.com", password: "uwo@1234" }];
}

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Middleware for JWT Verification
const auth = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

// --- ROUTES ---

// 1. Submit Contact Form
app.post('/api/contacts', async (req, res) => {
    try {
        const { name, email, message, purpose, source } = req.body;
        const newContact = new Contact({
            name,
            email,
            message,
            purpose,
            source: source || 'UWO'
        });
        await newContact.save();
        res.status(201).json({ message: 'Message sent successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Admin Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const admin = admins.find(a => a.email === email && a.password === password);

    if (!admin) {
        return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ email: admin.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

// 3. Get All Messages (Protected)
app.get('/api/contacts', auth, async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ created_at: -1 });
        res.json(contacts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.1 Get All Messages (PUBLIC - For Testing)
app.get('/api/contacts/test', async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ created_at: -1 });
        res.json({ total: contacts.length, data: contacts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Delete Message (Protected)
app.delete('/api/contacts/:id', auth, async (req, res) => {
    try {
        await Contact.findByIdAndDelete(req.params.id);
        res.json({ message: 'Message deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Website Routes (Created as per request)
app.post('/api/website', async (req, res) => {
    try {
        const newItem = new Website(req.body);
        await newItem.save();
        res.status(201).json({ message: 'Item added to Website collection', data: newItem });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/website', async (req, res) => {
    try {
        const items = await Website.find();
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Subscriber Route
app.post('/api/subscribe', async (req, res) => {
    try {
        const { email } = req.body;

        // 1. Save to DB (Only if new)
        const existing = await Subscriber.findOne({ email });
        if (!existing) {
            const newSubscriber = new Subscriber({ email });
            await newSubscriber.save();

            // Also save to Contact collection to show in Admin Panel
            const newContact = new Contact({
                name: 'New Subscriber',
                email: email,
                purpose: 'Newsletter Subscription',
                message: 'User subscribed to EFV™ updates.',
                source: 'EFV'
            });
            await newContact.save();
        } else {
            console.log(`♻️ User ${email} already exists, resending email...`);
        }

        // 2. Send Welcome Email (Always)
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT) || 587, // Use 587 for TLS
            secure: false, // false for 587 (STARTTLS), true for 465 (SSL)
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            tls: {
                rejectUnauthorized: false
            },
            connectionTimeout: 60000, // 60 seconds
            greetingTimeout: 60000,
            socketTimeout: 60000
        });

        const mailOptions = {
            from: `"EFV™ World" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Welcome to the EFV™ World',
            html: `
                <!-- Main Wrapper Table -->
                <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#050811" style="background-color: #050811; margin: 0; padding: 0; width: 100% !important;">
                    <tr>
                        <td align="center" valign="top" style="padding: 40px 10px;">
                            
                            <!-- Main Email Card (600px Width) -->
                            <table border="0" cellpadding="0" cellspacing="0" width="600" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #0b1120; background-image: url('cid:herobg'); background-size: cover; background-position: center; border-radius: 24px; overflow: hidden; box-shadow: 0 50px 120px rgba(0,0,0,0.9), 0 0 15px rgba(214, 165, 89, 0.12); border: 1.5px solid rgba(214, 165, 89, 0.45);">
                                <tr>
                                    <td align="center" valign="top" style="padding: 0; background-color: rgba(11, 17, 32, 0.82);">
                                        
                                        <!-- Unified Inner Content Table -->
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%;">
                                            
                                            <!-- Row: Header Section -->
                                            <tr>
                                                <td align="center" style="padding: 60px 30px 40px 30px;">
                                                    <img src="cid:efvlogo" width="110" style="display: block; border: 0;" alt="EFV™ Logo">
                                                    <div style="color: #D6A559; font-size: 22px; font-weight: 800; margin-top: 15px; letter-spacing: 5px; text-transform: uppercase;">EFV™</div>
                                                </td>
                                            </tr>

                                            <!-- Row: Hero Content Section -->
                                            <tr>
                                                <td align="center" style="padding: 0 30px 50px 30px;">
                                                    <div style="margin-bottom: 40px;">
                                                        <a href="https://www.amazon.in/dp/B0GKPT184H" style="display: inline-block; background-color: #000; color: #FABE56; border: 1.5px solid #FABE56; padding: 12px 36px; text-decoration: none; font-weight: 800; font-size: 11px; letter-spacing: 2px; border-radius: 100px; box-shadow: 0 8px 20px rgba(0,0,0,0.5);">
                                                            THE BIG OPPORTUNITY IS HERE →
                                                        </a>
                                                    </div>
                                                    <img src="cid:efvbook" alt="EFV™ Book" width="280" style="width: 280px; height: auto; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 40px 80px rgba(0,0,0,0.9); display: block;">
                                                </td>
                                            </tr>

                                            <!-- Row: Descriptive Content Section -->
                                            <tr>
                                                <td align="center" style="padding: 0 40px 60px 40px;">
                                                    <div style="text-align: center; margin-bottom: 40px;">
                                                        <h2 style="color: #ffffff; font-size: 26px; font-weight: 900; margin: 0; letter-spacing: 3px; text-transform: uppercase;">THE ORIGIN CODE™</h2>
                                                        <div style="margin: 20px auto; height: 1px; width: 50px; background-color: #D6A559;"></div>
                                                    </div>
                                                    
                                                    <div style="color: #94a3b8; font-size: 15px; line-height: 1.6; font-weight: 400; text-align: center;">
                                                        <p style="margin-bottom: 25px;">Welcome to the <span style="color: #ffffff; font-weight: 700;">EFV™ Intelligent Ecosystem</span>. You are now part of an elite global frequency dedicated to architecting universal growth.</p>
                                                        <p style="margin-bottom: 25px;"><span style="color: #FABE56; font-weight: 700;">Volume 1: The Origin Code</span> is officially live. This foundational work serves as the blueprint for understanding cognitive evolution and the mechanics of deep intelligent frameworks.</p>
                                                        <p style="margin-bottom: 40px;">Your access is now <span style="color: #FABE56; font-weight: 800; letter-spacing: 1px;">ACTIVE</span>. Take the first step into the new era of cognitive dominance today.</p>
                                                    </div>

                                                    <a href="https://www.amazon.in/dp/B0GKPT184H" style="display: inline-block; background-color: #000; color: #FABE56; border: 2.2px solid #FABE56; padding: 16px 50px; text-decoration: none; font-weight: 900; font-size: 15px; letter-spacing: 1.5px; border-radius: 100px; box-shadow: 0 15px 35px rgba(0,0,0,0.5);">
                                                        Claim Access Now
                                                    </a>
                                                </td>
                                            </tr>

                                            <!-- Row: Phase/Roadmap Section -->
                                            <tr>
                                                <td align="center" style="padding: 0 40px 60px 40px;">
                                                    <div style="background-color: rgba(250, 190, 86, 0.03); border: 1.8px solid #FABE56; border-radius: 20px; padding: 45px 30px; text-align: center;">
                                                        <div style="display: inline-block; padding: 10px 22px; background-color: #FABE56; border-radius: 6px; margin-bottom: 25px;">
                                                            <span style="color: #000; font-size: 11px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase;">COMING SOON</span>
                                                        </div>
                                                        <h3 style="margin: 0 0 12px 0; color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase;">NEXT PHASE: VOLUME 2</h3>
                                                        <p style="margin: 0; color: #D6A559; font-size: 14px; font-weight: 600; opacity: 0.9;">Exclusive Early Access Reservation Pending.</p>
                                                    </div>
                                                </td>
                                            </tr>

                                            <!-- Row: Retail Channels Section -->
                                            <tr>
                                                <td align="center" style="padding: 0 30px 60px 30px;">
                                                    <div style="margin-bottom: 30px; color: #FABE56; font-size: 11px; letter-spacing: 5px; text-transform: uppercase; font-weight: 800;">RETAIL CHANNELS</div>
                                                    
                                                    <!-- Buttons Sub-Table -->
                                                    <table border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse: collapse;">
                                                        <tr>
                                                            <td align="center" style="padding: 6px;">
                                                                <a href="https://efvworld.online" style="text-decoration: none; display: block; background-color: #0f172a; border: 1.2px solid rgba(214, 165, 89, 0.35); border-radius: 12px; padding: 12px 18px; min-width: 145px;">
                                                                    <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                                        <tr>
                                                                            <td valign="middle" style="padding-right: 10px; line-height: 1;">
                                                                                <img src="cid:efvicon" width="18" style="display: block; border: 0;" alt="">
                                                                            </td>
                                                                            <td valign="middle" style="color: #D6A559; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; white-space: nowrap; line-height: 1;">
                                                                                EFV™ Site
                                                                            </td>
                                                                        </tr>
                                                                    </table>
                                                                </a>
                                                            </td>
                                                            <td align="center" style="padding: 6px;">
                                                                <a href="https://amazon.in" style="text-decoration: none; display: block; background-color: #0f172a; border: 1.2px solid rgba(214, 165, 89, 0.35); border-radius: 12px; padding: 12px 18px; min-width: 135px;">
                                                                    <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                                        <tr>
                                                                            <td valign="middle" style="padding-right: 10px; line-height: 1;">
                                                                                <img src="cid:amazonicon" width="16" style="display: block; border: 0;" alt="">
                                                                            </td>
                                                                            <td valign="middle" style="color: #D6A559; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; white-space: nowrap; line-height: 1;">
                                                                                Amazon
                                                                            </td>
                                                                        </tr>
                                                                    </table>
                                                                </a>
                                                            </td>
                                                            <td align="center" style="padding: 6px;">
                                                                <a href="https://notionpress.com" style="text-decoration: none; display: block; background-color: #0f172a; border: 1.2px solid rgba(214, 165, 89, 0.35); border-radius: 12px; padding: 12px 18px; min-width: 155px;">
                                                                    <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                                        <tr>
                                                                            <td valign="middle" style="padding-right: 10px; line-height: 1;">
                                                                                <img src="cid:notionicon" width="18" style="display: block; border: 0;" alt="">
                                                                            </td>
                                                                            <td valign="middle" style="color: #D6A559; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; white-space: nowrap; line-height: 1;">
                                                                                NotionPress
                                                                            </td>
                                                                        </tr>
                                                                    </table>
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <!-- Buttons Row 2 -->
                                                    <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin-top: 5px; border-collapse: collapse;">
                                                        <tr>
                                                            <td align="center" style="padding: 6px;">
                                                                <a href="https://flipkart.com" style="text-decoration: none; display: block; background-color: #0f172a; border: 1.2px solid rgba(214, 165, 89, 0.35); border-radius: 12px; padding: 12px 25px; min-width: 135px;">
                                                                    <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                                        <tr>
                                                                            <td valign="middle" style="padding-right: 10px; line-height: 1;">
                                                                                <img src="cid:flipkarticon" width="18" style="display: block; border: 0;" alt="">
                                                                            </td>
                                                                            <td valign="middle" style="color: #D6A559; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; white-space: nowrap; line-height: 1;">
                                                                                Flipkart
                                                                            </td>
                                                                        </tr>
                                                                    </table>
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>

                                            <!-- Row: Footer Logo and Legal -->








                                            <tr>
                                                <td align="center"
                                                    style="padding:60px 40px;
                                                    background-color: rgba(11, 17, 32, 0.82);
                                                    border-top: 1px solid rgba(255,255,255,0.05);">

                                                    <div style="color:#D6A559;
                                                    font-size:22px;
                                                    font-weight:900;
                                                    letter-spacing:8px;
                                                    margin-bottom:25px;
                                                    text-transform:uppercase;">
                                                    UWO™
                                                    </div>

                                                    <p style="color:#D6A559;
                                                    font-size:10px;
                                                    text-transform:uppercase;
                                                    letter-spacing:5px;
                                                    line-height:2.2;
                                                    margin:0;
                                                    font-weight:700;
                                                    opacity:0.9;">
                                                    Architecting Universal Growth. © 2024 UWO Pvt. Ltd.
                                                    </p>

                                                </td>
                                            </tr>   


                                        </table>
                                        <!-- End Unified Inner Content Table -->

                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>
                </table>
            `,
            attachments: [
                {
                    filename: 'EFV_Book.png',
                    path: path.join(__dirname, '../images/EFVBOOK.png'),
                    cid: 'efvbook'
                },
                {
                    filename: 'hero-bg.png',
                    path: path.join(__dirname, '../images/ChatGPT Image Feb 9, 2026, 09_09_27 PM.png'),
                    cid: 'herobg'
                },
                {
                    filename: 'EFV.png',
                    path: path.join(__dirname, '../images/EFV.png'),
                    cid: 'efvlogo'
                },
                {
                    filename: 'EFV_Icon.png',
                    path: path.join(__dirname, '../images/EFV.png'),
                    cid: 'efvicon'
                },
                {
                    filename: 'Amazon_Icon.png',
                    path: path.join(__dirname, '../images/amazon.png'),
                    cid: 'amazonicon'
                },
                {
                    filename: 'Notion_Icon.png',
                    path: path.join(__dirname, '../images/notion.png'),
                    cid: 'notionicon'
                },
                {
                    filename: 'Flipkart_Icon.png',
                    path: path.join(__dirname, '../images/flipcard.png'),
                    cid: 'flipkarticon'
                }
            ]
        };

        try {
            console.log(`📤 Attempting to send welcome email to: ${email} `);
            const info = await transporter.sendMail(mailOptions);
            console.log('✅ Email sent: ' + info.response);
            res.status(201).json({ message: 'Subscribed successfully! Welcome email sent.' });
        } catch (emailError) {
            console.error('❌ Error sending email:', emailError);
            // Return success since the user is subscribed in the database
            res.status(201).json({
                message: 'Subscribed successfully!',
                warning: 'Failed to send welcome email.',
                error: emailError.message
            });
        }
    } catch (err) {
        console.error('❌ Server Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 7. Get All Subscribers (Protected)
app.get('/api/subscribers', auth, async (req, res) => {
    try {
        const subscribers = await Subscriber.find().sort({ created_at: -1 });
        res.json(subscribers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Delete Subscriber (Protected)
app.delete('/api/subscribers/:id', auth, async (req, res) => {
    try {
        const subscriber = await Subscriber.findByIdAndDelete(req.params.id);
        if (!subscriber) {
            return res.status(404).json({ message: 'Subscriber not found' });
        }
        res.json({ message: 'Subscriber removed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} `));
