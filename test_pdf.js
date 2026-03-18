const pdf = require('pdf-parse');
async function test() {
    try {
        const buffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
        const parser = new pdf.PDFParse({ data: buffer });
        const result = await parser.getText();
        console.log('Final Text Result:', result.text);
    } catch (e) {
        console.error('Error:', e.message);
    }
}
test();
