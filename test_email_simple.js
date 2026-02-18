const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const dns = require('dns');

// Force DNS to use Google servers
dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config();

async function testEmail() {
    console.log('🔍 Testing Email Configuration...\n');

    console.log('📧 Email User:', process.env.EMAIL_USER);
    console.log('🔑 Email Pass:', process.env.EMAIL_PASS ? '***' + process.env.EMAIL_PASS.slice(-4) : 'NOT SET');
    console.log('🌐 SMTP Host:', process.env.SMTP_HOST || 'smtp.gmail.com');
    console.log('🔌 SMTP Port:', process.env.SMTP_PORT || 587);
    console.log('');

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false, // false for 587 (STARTTLS)
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false
        },
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000,
        socketTimeout: 10000
    });

    // Test 1: Verify connection
    console.log('📡 Testing SMTP connection...');
    try {
        await transporter.verify();
        console.log('✅ SMTP connection successful!\n');
    } catch (error) {
        console.error('❌ SMTP connection failed:', error.message);
        console.error('Full error:', error);
        return;
    }

    // Test 2: Send simple email (no attachments)
    console.log('📨 Sending test email (no attachments)...');
    const simpleMailOptions = {
        from: `"EFV™ Test" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER, // Send to yourself for testing
        subject: 'Test Email - Simple',
        html: '<h1>Test Email</h1><p>If you receive this, basic email sending works!</p>'
    };

    try {
        const info = await transporter.sendMail(simpleMailOptions);
        console.log('✅ Simple email sent successfully!');
        console.log('📬 Message ID:', info.messageId);
        console.log('📤 Response:', info.response);
    } catch (error) {
        console.error('❌ Failed to send simple email:', error.message);
        console.error('Full error:', error);
    }
}

testEmail().catch(console.error);
