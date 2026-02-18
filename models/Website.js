const mongoose = require('mongoose');

const WebsiteSchema = new mongoose.Schema({
    // Fields based on "website" context - modifying strict to false allows flexibility
    // if the user has existing data with unknown fields.
    name: { type: String },
    url: { type: String },
    description: { type: String },
    created_at: { type: Date, default: Date.now }
}, { strict: false });

// Force collection name to 'website' to match the user's URL path: /UWO-web/website/find
module.exports = mongoose.model('Website', WebsiteSchema, 'website');
