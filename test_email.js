const nodemailer = require('nodemailer');
require('dotenv').config();

console.log('Testing email configuration...');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('SMTP_HOST:', process.env.SMTP_HOST);
console.log('SMTP_PORT:', process.env.SMTP_PORT);

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: false, // false for 587 (STARTTLS)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

const testEmail = {
    from: `"EFV™ World" <${process.env.EMAIL_USER}>`,
    to: 'test@example.com',
    subject: 'Test Email from UWO Backend',
    html: '<h1>Test Email</h1><p>If you receive this, email configuration is working!</p>'
};

console.log('\n📤 Sending test email...');

transporter.sendMail(testEmail)
    .then(info => {
        console.log('✅ Email sent successfully!');
        console.log('Message ID:', info.messageId);
        console.log('Response:', info.response);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Email sending failed!');
        console.error('Error:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    });
