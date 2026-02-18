const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const dns = require('dns');
const path = require('path');
const fs = require('fs');

// Force DNS to use Google servers
dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config();

async function testEmailWithAttachments() {
    console.log('🔍 Testing Email with Attachments...\n');

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
        },
        connectionTimeout: 30000, // 30 seconds
        greetingTimeout: 30000,
        socketTimeout: 30000
    });

    // Check which files exist
    const attachmentFiles = [
        { name: 'EFVBOOK.png', path: path.join(__dirname, '../images/EFVBOOK.png') },
        { name: 'ChatGPT Image Feb 9, 2026, 09_09_27 PM.png', path: path.join(__dirname, '../images/ChatGPT Image Feb 9, 2026, 09_09_27 PM.png') },
        { name: 'EFV.png', path: path.join(__dirname, '../images/EFV.png') },
        { name: 'Amazon.png', path: path.join(__dirname, '../images/Amazon.png') },
        { name: 'notion.png', path: path.join(__dirname, '../images/notion.png') },
        { name: 'flipcard.png', path: path.join(__dirname, '../images/flipcard.png') }
    ];

    console.log('📁 Checking attachment files:');
    for (const file of attachmentFiles) {
        const exists = fs.existsSync(file.path);
        const size = exists ? (fs.statSync(file.path).size / 1024).toFixed(2) + ' KB' : 'N/A';
        console.log(`  ${exists ? '✅' : '❌'} ${file.name} - ${size}`);
    }
    console.log('');

    // Send email with attachments
    console.log('📨 Sending test email with attachments...');
    const mailOptions = {
        from: `"EFV™ Test" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: 'Test Email - With Attachments',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h1>Test Email with Attachments</h1>
                <p>Testing email with embedded images:</p>
                <img src="cid:efvlogo" width="100" alt="EFV Logo">
                <p>If you see the logo above, attachments are working!</p>
            </div>
        `,
        attachments: [
            {
                filename: 'EFV.png',
                path: path.join(__dirname, '../images/EFV.png'),
                cid: 'efvlogo'
            }
        ]
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email with attachments sent successfully!');
        console.log('📬 Message ID:', info.messageId);
        console.log('📤 Response:', info.response);
    } catch (error) {
        console.error('❌ Failed to send email with attachments:', error.message);
        console.error('Error code:', error.code);
        console.error('Full error:', error);
    }
}

testEmailWithAttachments().catch(console.error);
