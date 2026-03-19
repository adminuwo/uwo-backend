const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
    fileName: {
        type: String,
        required: true
    },
    extractedText: {
        type: String,
        required: true
    },
    fileType: {
        type: String,
        required: true
    },
    fileUrl: {
        type: String,
        required: false
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Document', DocumentSchema);
