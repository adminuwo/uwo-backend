const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();

const Subscriber = require('./models/Subscriber');

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB');

        const subscribers = await Subscriber.find().sort({ created_at: -1 }).limit(5);

        console.log('\n📧 Latest 5 Subscribers:');
        console.log('========================');

        if (subscribers.length === 0) {
            console.log('No subscribers found.');
        } else {
            subscribers.forEach((sub, index) => {
                console.log(`${index + 1}. ${sub.email} - ${new Date(sub.created_at).toLocaleString()}`);
            });
        }

        console.log('\n✅ Total subscribers:', await Subscriber.countDocuments());

        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Error:', err);
        process.exit(1);
    });
