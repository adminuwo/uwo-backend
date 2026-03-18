try {
    require('multer');
    require('pdf-parse');
    require('mammoth');
    console.log('Imports OK');
} catch (e) {
    console.error('Import failed:', e.message);
}
