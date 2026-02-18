const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String, required: true },
    purpose: { type: String },
    source: { type: String, default: 'UWO' }, // 'UWO' or 'EFV'
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Contact', ContactSchema);
