const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);


// The connection string from your .env file
require('dotenv').config();
const uri = process.env.MONGO_URI;

console.log("⏳ Testing MongoDB Connection...");
console.log(`📡 Connecting to: ${uri}`);

mongoose.connect(uri)
    .then(() => {
        console.log("✅ SUCCESS! Connected to MongoDB.");
        process.exit(0);
    })
    .catch(err => {
        console.error("❌ FAILED! Could not connect.");
        console.error("DETAILS:", err.message);
        if (err.cause) console.error("CAUSE:", err.cause);
        process.exit(1);
    });
