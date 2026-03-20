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
const { Storage } = require('@google-cloud/storage');
const { franc } = require('franc-min');
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
    console.warn('⚠️ Could not load admin .json, using fallback credentials');
    // Updated fallback to match user's expected email: admin@uwo.com
    admins = [{ 
        email: process.env.ADMIN_EMAIL || "admin@uwo.com", 
        password: process.env.ADMIN_PASSWORD || "uwo@1234" 
    }];
}

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// --- Vertex AI Config ---
const project = process.env.GOOGLE_PROJECT_ID || 'unified-web-options';
const location = process.env.GOOGLE_LOCATION || 'asia-south1';
const bucketName = process.env.GCS_BUCKET_NAME || 'uwo-rag-docs';

console.log(`✅ Google Cloud initializing with project: ${project}`);
console.log(`📍 Location: ${location}`);

const vertexAI = new VertexAI({ project: project, location: location });

// --- Google Cloud Storage Init ---
const storageClient = new Storage({ projectId: project });
const bucket = storageClient.bucket(bucketName);

console.log(`🪣 Using GCS Bucket: ${bucketName}`);


// Models
const knowledgeText = knowledgeBase.map(item => `Q: ${item.question}\nA: ${item.answer}`).join('\n\n');
const generativeModel = vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `You are UWO AI Assistant, a professional AI assistant for the UWO (Unified Web Options) digital platform.

-------------------------------------

🌍 LANGUAGE INTELLIGENCE (VERY IMPORTANT):
1. Always detect the language of the user's input automatically.
2. Respond ONLY in the same language as the user’s message.
   - If user writes in English → reply in English
   - If user writes in Hindi → reply in Hindi
   - If user writes in Hinglish → reply in Hinglish
   - If user writes in Marathi → reply in Marathi
3. NEVER switch language on your own.
4. NEVER translate unless user explicitly asks.

-------------------------------------

🔁 LANGUAGE SWITCH (USER CONTROL):
If user says "Explain in Hindi", "Marathi me batao", or "Tell me in Sanskrit", then switch to that language immediately and continue until changed again.

-------------------------------------

🌐 MULTI-LANGUAGE SUPPORT:
You support all major languages (English, Hindi, Hinglish, Marathi, Gujarati, Tamil, Telugu, Bengali, Sanskrit, and many international languages).
If asked about support, answer: "I can communicate in multiple languages including English, Hindi, Hinglish, Marathi, Gujarati, Tamil, Telugu, Bengali, Sanskrit, and many international languages like Spanish, French, and more. You can ask me in any language."

-------------------------------------

🧠 BEHAVIOR RULES:
- Be professional, clear, and helpful.
- Do not mix languages unnecessarily.
- Keep tone natural and human-like.
- Match user's tone (formal/informal).
- NO APOLOGIES: Never say "the provided documents do not contain..." or "I don't have information in the context". Always answer naturally.

-------------------------------------

📌 CONTEXT USAGE (FOR RAG):
If local context from documents is provided, use it to answer. Always follow the same language rule even when using provided context.

-------------------------------------

🚫 STRICT RULES:
- Do NOT default to Hindi or English.
- ONLY follow user's language.
- If unsure → respond in the most dominant language used in the query.

-------------------------------------

🎯 GOAL:
1. First, search and answer from the provided DOCUMENT CONTEXT (RAG).
2. If the answer is NOT in the documents, use your general knowledge but answer BRILLIANTLY.
3. Deliver a natural, human-like, multilingual conversation experience where the user feels the AI understands and speaks their language perfectly.`
});

console.log(`✅ Vertex AI initialized successfully`);
console.log(`🤖 Model: gemini-2.5-flash`);
console.log(`🆔 Project: ${project}`);

// Log Cloudinary Status
console.log(`[INFO] [Cloudinary Config] Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME ? 'Set' : 'Not Set'}`);
console.log(`[INFO] [Cloudinary Config] API Key: ${process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not Set'}`);
console.log(`[INFO] [Cloudinary Config] API Secret: ${process.env.CLOUDINARY_API_SECRET ? 'Set' : 'Not Set'}`);

// --- Language Detection Helper ---
const detectLanguage = (text) => {
    const lower = text.toLowerCase().trim();
    
    // 1. Manual Language Overrides (Highest Priority)
    if (lower.includes("marathi") || /[\u0900-\u097F]/.test(text) && (lower.includes("येथे") || lower.includes("कसे"))) return "Marathi";
    if (lower.includes("hindi")) return "Hindi";
    if (lower.includes("hinglish")) return "Hinglish";
    if (lower.includes("sanskrit")) return "Sanskrit";

    // 2. Clear script check for Devanagari (Default to Hindi)
    if (/[\u0900-\u097F]/.test(text)) return "Hindi";

    // 3. Hinglish Keywords Check
    const hinglishKeywords = ["hai", "kya", "nhi", "btao", "kaise", "sab", "toh", "ka", "ki", "ko", "kar", "ho", "tu", "teri", "mera"];
    const words = lower.split(/\W+/);
    if (hinglishKeywords.some(kw => words.includes(kw))) return "Hinglish";

    // Default to English - NEVER random languages
    return "English";
};

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
        const fileName = `${Date.now()}-${req.file.originalname}`;
        let extractedText = "";

        // 1. Extract Text for RAG context
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
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(400).json({ message: "Unsupported file type: " + req.file.mimetype });
        }

        // 2. Upload to GCS Bucket for permanent storage
        console.log(`☁️ Uploading ${req.file.originalname} to GCS...`);
        const gcsFile = bucket.file(fileName);
        
        await bucket.upload(filePath, {
            destination: fileName,
            metadata: { contentType: req.file.mimetype }
        });

        // Make file public if needed, or just store the internal path
        // For simplicity we store the public URL or just the path
        const fileUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;

        // 3. Save to MongoDB
        const newDoc = new Document({
            fileName: req.file.originalname,
            extractedText: extractedText,
            fileType: req.file.mimetype,
            fileUrl: fileUrl
        });

        await newDoc.save();

        // 4. Cleanup local file
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        res.json({ message: "Document uploaded to Cloud and indexed successfully!", url: fileUrl });
    } catch (err) {
        console.error("❌ RAG Upload Error:", err);
        // Clean up even if upload fails
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ message: "Document not found" });

        // Delete from GCS if URL exists
        if (doc.fileUrl) {
            try {
                const urlParts = doc.fileUrl.split('/');
                const fileName = urlParts[urlParts.length - 1];
                console.log(`🗑️ Deleting ${fileName} from GCS...`);
                await bucket.file(fileName).delete();
            } catch (gcsErr) {
                console.error("⚠️ Failed to delete from GCS (might not exist):", gcsErr.message);
            }
        }

        await Document.findByIdAndDelete(req.params.id);
        res.json({ message: "Document deleted from Cloud and DB" });
    } catch (err) {
        console.error("❌ Delete Error:", err);
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
app.post('/api/aisa-demo', async (req, res) => {
    try {
        const { name, email, phone, company, message } = req.body;
        
        // Save to Database
        const newLead = new Contact({
            name,
            email,
            purpose: 'AISA Demo Request',
            message: `Company: ${company || 'N/A'}\nPhone: ${phone || 'N/A'}\n\nMessage: ${message}`,
            source: 'AISA Landing Page'
        });
        await newLead.save();

        // Send Email Notification
        await sendAdminNotification({
            name,
            email,
            purpose: 'AISA Demo Request',
            message: `Company: ${company || 'N/A'}\nPhone: ${phone || 'N/A'}\n\nMessage: ${message}`,
            source: 'AISA Landing Page'
        });

        res.status(201).json({ message: 'Demo request sent successfully' });
    } catch (err) {
        console.error('❌ AISA Demo Error:', err);
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

        // Step 1: Detect Language
        const detectedLang = detectLanguage(message);
        console.log(`💬 User Message (${email || 'Anonymous'}): "${message}" | Detected: ${detectedLang}`);

        // Step 2: Fetch RAG context (from DB + knowledge_base.js) -- Truncated to avoid 128k Context Limit Error
        const allDocs = await Document.find();
        let docsContext = allDocs.map(d => `--- FILE: ${d.fileName} ---\n${d.extractedText}`).join("\n\n");
        
        // Safety truncation: 60,000 chars is approx 50,000 tokens maximum with complex unicode (Safe for 131,072 limit)
        if (docsContext.length > 60000) {
            docsContext = docsContext.substring(0, 60000) + "\n\n...[ADDITIONAL CONTENT TRUNCATED TO FIT MEMORY LIMIT]...";
        }

        const contextText = `### CORE KNOWLEDGE:\n${knowledgeText}\n\n### UPLOADED DOCUMENTS:\n${docsContext}`;

        // Step 3: Generate Dynamic System Prompt
        const dynamicSystemInstruction = `You are UWO AI Assistant, a premium, minimalist expert guide.

### STRICT RESPONSE FORMAT (NON-NEGOTIABLE):
1. **NO INTROS/OUTROS**: Do not say "Okay", "Here is", or "Based on info". Start directly with SUMMARY.
2. **NO SYMBOLS**: Never use **, ##, *, or markdown.
3. **HEADINGS & TERMS**: All headings (SUMMARY, KEY POINTS, etc.) and key terms MUST be in ALL CAPS followed by a colon: (e.g. SUMMARY:, IMPORTANT TERM:).
4. **BULLETS ONLY**: Every single point must start with "• ".
5. **ONE LINE PER POINT**: Do NOT write paragraphs. Max 1 line per bullet.
6. **STRICT LENGTH**: Maximum 150-200 words total. Be extremely concise.
7. **LANGUAGE**: Respond only in ${detectedLang}. (Devanagari for Hindi/Marathi, Roman for English).

### STRUCTURE:
SUMMARY:
• [Point 1 about topic]
• [Point 2 about topic]

KEY POINTS:
• [TERM IN CAPITALS]: [1 sentence explanation]
• [TERM IN CAPITALS]: [1 sentence explanation]
• [TERM IN CAPITALS]: [1 sentence explanation]

BENEFITS:
• [Benefit 1]
• [Benefit 2]

CONCLUSION:
• [One sentence final impact]

### KNOWLEDGE CONTEXT:
${contextText}

### RAG PRIORITY RULES:
- STEP 1: Always analyze the "UPLOADED DOCUMENTS" context first.
- STEP 2: If the query is related to UWO or documents, answer strictly from them.
- STEP 3: If facts are not in documents, use your general knowledge to help the user.
- NO APOLOGIES: Never say "not found in documents". Just answer naturally.`;

        const tempModel = vertexAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: dynamicSystemInstruction
        });

        console.log(`🤖 LLM Called | Model: gemini-2.5-flash | Detected: ${detectedLang}`);
        let result;
        try {
            result = await tempModel.generateContent(message);
        } catch (aiErr) {
            console.error("❌ Vertex AI generateContent Error:", JSON.stringify(aiErr?.message || aiErr));
            return res.status(500).json({ error: 'AI generation failed', details: aiErr?.message });
        }
        let responseText = result.response.candidates[0].content.parts[0].text;
        console.log(`✨ AI Response received [Length: ${responseText.length}]`);

        // Step 5: Hard Language Enforcement (Fallback)
        // Basic check: if we asked for Hindi/Marathi (Devanagari) but got ASCII, it's wrong.
        const isActuallyDevanagari = /[\u0900-\u097F]/.test(responseText);
        if ((detectedLang === "Hindi" || detectedLang === "Marathi") && !isActuallyDevanagari && !message.toLowerCase().includes("english")) {
            console.log("⚠️ Incorrect language detected in AI response. Enforcing rewrite...");
            const rewriteResult = await tempModel.generateContent(`Your previous response was not in ${detectedLang}. Rewrite the following response strictly in ${detectedLang} script only: \n\n${responseText}`);
            responseText = rewriteResult.response.candidates[0].content.parts[0].text;
        }

        // Log to database if user is registered
        if (email) {
            try {
                const newLog = new ChatLog({ email, message, reply: responseText });
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
