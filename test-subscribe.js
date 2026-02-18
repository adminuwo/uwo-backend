// Native fetch is used (Node v18+)

async function testSubscribe() {
    try {
        const response = await fetch('http://localhost:5000/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'uwo_test_mail@mailinator.com' })
        });
        const data = await response.json();
        console.log('Response:', data);
    } catch (err) {
        console.error('Error:', err);
    }
}

testSubscribe();
