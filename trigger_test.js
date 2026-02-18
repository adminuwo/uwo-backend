const http = require('http');

const data = JSON.stringify({
    email: 'test_auto_' + Date.now() + '@example.com' // Unique email every time to avoid duplicate error
});

const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/subscribe',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let responseData = '';

    console.log(`STATUS: ${res.statusCode}`);

    res.on('data', (chunk) => {
        responseData += chunk;
    });

    res.on('end', () => {
        console.log('Response:', responseData);
        if (res.statusCode === 201) {
            console.log('✅ TEST PASSED: Email sent successfully via API!');
        } else {
            console.error('❌ TEST FAILED: ' + responseData);
        }
    });
});

req.on('error', (e) => {
    console.error(`❌ Problem with request: ${e.message}`);
});

req.write(data);
req.end();
