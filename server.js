const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Contact = require('./models/Contact');
const Website = require('./models/Website');
const Subscriber = require('./models/Subscriber');
const ChatLog = require('./models/ChatLog');
const Document = require('./models/Document');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const dns = require('dns');
const { VertexAI } = require('@google-cloud/vertexai');
const knowledgeBase = require('./knowledge_base');

// Force DNS to use Google servers to fix Reliance Jio SRV lookup issue
dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config();

const app = express();
app.set('trust proxy', true); // Trust GCP Load Balancer
app.use(cors());
app.use(express.json());

// Log all requests for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/uwo_database';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Load Admin Credentials from .json file
const adminsPath = path.join(__dirname, '..', 'uwo', '.json');
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

// --- Vertex AI Config ---
const project = process.env.GOOGLE_PROJECT_ID || 'ai-mall-484810';
const location = process.env.GOOGLE_LOCATION || 'us-central1';

console.log(`✅ Vertex AI initializing with project: ${project}`);
console.log(`📍 Location: ${location}`);

const vertexAI = new VertexAI({ project: project, location: location });

// Models
const knowledgeText = knowledgeBase.map(item => `Q: ${item.question}\nA: ${item.answer}`).join('\n\n');
const generativeModel = vertexAI.getGenerativeModel({
    model: 'gemini-2.0-flash-001',
    systemInstruction: `You are the UWO AI Assistant. You are a versatile expert AI with both local UWO knowledge and vast general knowledge of the world.

Tone: Professional, helpful, smart, and direct.

Guidelines:
1. LANGUAGE: Respond in the user's language (Marathi for Marathi, Hindi for Hindi, etc.).
2. HYBRID INTELLIGENCE: Use the provided document context to answer UWO-related questions.
3. NO APOLOGIES: Never say "the provided documents do not contain..." or "I don't have information in the context".
4. BE A CHATGPT-LIKE ASSISTANT: If a question is not about UWO (e.g., "what is Instagram?", "write a poem", "how to code in JS"), provide a complete and high-quality answer using your general training.
5. UWO BRANDING: Always represent UWO (Unified Web Options) as a premium global brand.`
});

console.log(`✅ Vertex AI initialized successfully`);
console.log(`🤖 Model: gemini-2.0-flash-001`);
console.log(`🆔 Project: ${project}`);

// Log Cloudinary Status
console.log(`[INFO] [Cloudinary Config] Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME ? 'Set' : 'Not Set'}`);
console.log(`[INFO] [Cloudinary Config] API Key: ${process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not Set'}`);
console.log(`[INFO] [Cloudinary Config] API Secret: ${process.env.CLOUDINARY_API_SECRET ? 'Set' : 'Not Set'}`);

// Helper: Get Embeddings (Vertex AI textembedding-gecko@003)
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

// Helper function to send notification to Admin
const sendAdminNotification = async (data) => {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    const adminMailOptions = {
        from: `"UWO System" <${process.env.EMAIL_USER}>`,
        to: 'admin@uwo24.com',
        subject: `New Lead: ${data.source || 'Contact Form'} Submission`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-top: 5px solid #162377;">
                <h2 style="color: #162377;">New ${data.source || 'Contact Form'} Submission</h2>
                <p><strong>Name:</strong> ${data.name || 'Not provided'}</p>
                <p><strong>Email:</strong> <a href="mailto:${data.email}">${data.email}</a></p>
                <p><strong>Purpose:</strong> ${data.purpose || 'Not specified'}</p>
                <hr>
                <p><strong>Message:</strong></p>
                <p style="background: #f4f4f4; padding: 15px; border-radius: 5px;">${data.message || 'No message content'}</p>
                <hr>
                <p style="font-size: 12px; color: #666;">This is an automated notification from your UWO website backend.</p>
            </div>
        `
    };

    try {
        console.log(`📤 Attempting to notify admin for lead: ${data.email} (${data.source || 'Contact Form'})`);
        const info = await transporter.sendMail(adminMailOptions);
        console.log('✅ Admin notified successfully: ' + info.response);
    } catch (err) {
        console.error('❌ Failed to notify admin via email:', err);
    }
};

// --- RAG (Document Handling) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
        cb(null, './uploads');
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.post('/api/admin/upload-doc', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const filePath = req.file.path;
        let extractedText = "";

        if (req.file.mimetype === 'application/pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const parser = new pdf.PDFParse({ data: dataBuffer, verbosity: 0 });
            const pdfData = await parser.getText();
            extractedText = pdfData.text;
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const docResult = await mammoth.extractRawText({ path: filePath });
            extractedText = docResult.value;
        } else if (req.file.mimetype === 'text/plain' || req.file.mimetype === 'text/markdown') {
            extractedText = fs.readFileSync(filePath, 'utf8');
        } else {
            return res.status(400).json({ message: "Unsupported file type: " + req.file.mimetype });
        }

        const newDoc = new Document({
            fileName: req.file.originalname,
            extractedText: extractedText,
            fileType: req.file.mimetype
        });

        await newDoc.save();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ message: "Document uploaded and indexed successfully!" });
    } catch (err) {
        console.error("❌ RAG Upload Error:", err);
        res.status(500).json({ message: "Error processing document: " + err.message });
    }
});

app.get('/api/admin/list-docs', async (req, res) => {
    try {
        const docs = await Document.find().sort({ uploadedAt: -1 });
        res.json(docs);
    } catch (err) {
        res.status(500).json({ message: "Error fetching documents" });
    }
});

app.delete('/api/admin/delete-doc/:id', async (req, res) => {
    try {
        await Document.findByIdAndDelete(req.params.id);
        res.json({ message: "Document deleted" });
    } catch (err) {
        res.status(500).json({ message: "Error deleting document" });
    }
});

// --- ROUTES ---

// 1. Submit Contact Form
app.get('/api/health', (req, res) => {
    res.send('Hello World!');
});
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

        // Notify Admin
        await sendAdminNotification({
            name,
            email,
            message,
            purpose,
            source: source || 'Web Contact Form'
        });

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
        const { email, source, message } = req.body;

        // 1. Save to DB (Only if new)
        const existing = await Subscriber.findOne({ email });
        if (!existing) {
            const newSubscriber = new Subscriber({ email });
            await newSubscriber.save();

            // Also save to Contact collection to show in Admin Panel
            const newContact = new Contact({
                name: 'New Chat User',
                email: email,
                purpose: 'Chatbot Lead',
                message: message || 'User provided email via Chatbot.',
                source: source || 'UWO'
            });
            await newContact.save();

            // Notify Admin of the new Chatbot Lead
            await sendAdminNotification({
                name: 'New Chat User',
                email: email,
                purpose: 'Chatbot Lead',
                message: message || 'User provided email via Chatbot.',
                source: source || 'UWO Chatbot'
            });
        } else {
            console.log(`♻️ User ${email} already exists, resending welcome email...`);
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

// 8.1 Register Email (Chatbot Specific)
app.post('/api/register-email', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: 'Valid email is required' });
        }

        // 1. Save to Subscriber collection (Only if new)
        let subscriber = await Subscriber.findOne({ email });
        if (!subscriber) {
            subscriber = new Subscriber({ email });
            await subscriber.save();

            // Save the lead details into Contacts for Admin panel visibility
            const newLead = new Contact({
                name: 'New Chat User',
                email: email,
                purpose: 'Chatbot Lead',
                message: 'User registered via UWO AI Chatbot.',
                source: 'UWO AI'
            });
            await newLead.save();

            // Notify Admin via email (as requested)
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT) || 587,
                secure: false,
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                },
                tls: { rejectUnauthorized: false }
            });

            const timestamp = new Date().toLocaleString();
            const adminMailOptions = {
                from: `"UWO AI Bot" <${process.env.EMAIL_USER}>`,
                to: 'admin@uwo24.com',
                subject: 'New User Interaction - UWO AI Bot',
                html: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px;">
                        <h2 style="color: #162377;">New User Interaction - UWO AI Bot</h2>
                        <p style="font-size: 16px; color: #475569;">A new user has started a conversation on the UWO platform.</p>
                        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p><strong>Email:</strong> <span style="color: #162377;">${email}</span></p>
                            <p><strong>Time:</strong> ${timestamp}</p>
                        </div>
                        <p style="font-size: 14px; color: #94a3b8;">This lead has been archived in the system database.</p>
                    </div>
                `
            };

            await transporter.sendMail(adminMailOptions);
            console.log(`✅ Admin notified of new chatbot user: ${email}`);
        }

        res.status(200).json({ message: 'Registered successfully', registered: true });
    } catch (err) {
        console.error("❌ Register Email Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 9. Chat (Public)
app.post('/api/chat', async (req, res) => {
    try {
        const { message, email } = req.body;
        if (!message) return res.status(400).json({ message: 'Message is required' });

        console.log(`💬 User Message (${email || 'Anonymous'}): "${message}"`);

        // Fetch RAG context
        const allDocs = await Document.find();
        const contextText = allDocs.map(d => `--- FILE: ${d.fileName} ---\n${d.extractedText}`).join("\n\n");

        const prompt = contextText.length > 0
            ? `Knowledge Context:\n${contextText}\n\nUser Question: ${message}\n\nInstruction: Provide an expert response. If the information is in the context, use it. If not, answer using your vast technical and general knowledge naturally. Speak naturally in the user's language.`
            : message;

        const result = await generativeModel.generateContent(prompt);
        const responseText = result.response.candidates[0].content.parts[0].text;

        // Log to database if user is registered
        if (email) {
            try {
                const newLog = new ChatLog({
                    email,
                    message,
                    reply: responseText
                });
                await newLog.save();
            } catch (logErr) {
                console.error("⚠️ Failed to log chat:", logErr);
            }
        }

        res.json({ reply: responseText });
    } catch (err) {
        console.error("❌ Chat Error Details:", err);
        res.status(500).json({ error: err.message || "I'm having trouble connecting to AI right now." });
    }
});

const PORT = process.env.PORT || 5000;

// Global Error Handler
app.use((err, req, res, next) => {
    console.error("🔥 Global Error caught:", err);
    res.status(500).json({ error: "An internal server error occurred.", details: err.message });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} `));
