const express = require('express');
const multer = require('multer');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.static('public'));

const UPLOAD_DIR = './uploads';
const OUTPUT_DIR = './output';

(async () => {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
})();

const pdfStorage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, uuidv4() + '.pdf')
});

const upload = multer({
    storage: pdfStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const isPdf = file.mimetype === 'application/pdf' ||
            path.extname(file.originalname).toLowerCase() === '.pdf';
        isPdf ? cb(null, true) : cb(new Error('Only PDF files allowed'));
    }
});

// Upload single PDF
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
    try {
        const pdfBytes = await fs.readFile(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

        let formFields = [];
        try {
            const form = pdfDoc.getForm();
            formFields = form.getFields().map(f => {
                const type = f.constructor.name.replace('PDF', '');
                let value = '';
                try {
                    if (type === 'TextField') value = f.getText() || '';
                    else if (type === 'CheckBox') value = f.isChecked() ? 'true' : 'false';
                } catch (_) {}
                return { name: f.getName(), type, value };
            });
        } catch (_) {}

        res.json({
            success: true,
            fileId: req.file.filename,
            originalName: req.file.originalname,
            pageCount: pdfDoc.getPageCount(),
            formFields
        });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Serve PDF bytes for PDF.js viewing
app.get('/api/pdf/:fileId', async (req, res) => {
    const fp = path.join(UPLOAD_DIR, req.params.fileId);
    try {
        const data = await fs.readFile(fp);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(data);
    } catch {
        res.status(404).json({ error: 'File not found' });
    }
});

// Apply all operations and return outputId
app.post('/api/process', async (req, res) => {
    const { fileId, operations = [], formValues = {} } = req.body;
    try {
        const pdfBytes = await fs.readFile(path.join(UPLOAD_DIR, fileId));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();

        let font;
        try { font = await pdfDoc.embedFont(StandardFonts.Helvetica); }
        catch { font = await pdfDoc.embedFont(StandardFonts.TimesRoman); }

        for (const op of operations) {
            if (op.pageIndex < 0 || op.pageIndex >= pages.length) continue;
            const page = pages[op.pageIndex];

            if (op.type === 'text') {
                const hex = (op.color || '#000000').replace('#', '');
                const r = parseInt(hex.slice(0, 2), 16) / 255;
                const g = parseInt(hex.slice(2, 4), 16) / 255;
                const b = parseInt(hex.slice(4, 6), 16) / 255;
                page.drawText(op.text, {
                    x: op.pdfX,
                    y: op.pdfY,
                    size: op.fontSize || 12,
                    font,
                    color: rgb(r, g, b)
                });
            } else if (op.type === 'image') {
                const base64 = op.imageData.split(',')[1];
                const imgBytes = Buffer.from(base64, 'base64');
                const isPng = op.imageData.includes('image/png');
                const img = isPng
                    ? await pdfDoc.embedPng(imgBytes)
                    : await pdfDoc.embedJpg(imgBytes);
                page.drawImage(img, {
                    x: op.pdfX,
                    y: op.pdfY,
                    width: op.pdfWidth,
                    height: op.pdfHeight
                });
            }
        }

        // Fill form fields
        if (Object.keys(formValues).length > 0) {
            try {
                const form = pdfDoc.getForm();
                for (const [name, value] of Object.entries(formValues)) {
                    try {
                        const field = form.getField(name);
                        const type = field.constructor.name.replace('PDF', '');
                        if (type === 'TextField') field.setText(String(value));
                        else if (type === 'CheckBox') {
                            value === 'true' ? field.check() : field.uncheck();
                        }
                    } catch (_) {}
                }
                form.flatten();
            } catch (_) {}
        }

        const outputBytes = await pdfDoc.save();
        const outputId = uuidv4() + '.pdf';
        await fs.writeFile(path.join(OUTPUT_DIR, outputId), outputBytes);
        res.json({ success: true, outputId });
    } catch (err) {
        console.error('Process error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Download processed PDF
app.get('/api/download/:outputId', async (req, res) => {
    const fp = path.join(OUTPUT_DIR, req.params.outputId);
    try {
        const data = await fs.readFile(fp);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="edited.pdf"');
        res.send(data);
    } catch {
        res.status(404).json({ error: 'Output not found' });
    }
});

// Merge multiple PDFs
app.post('/api/merge', upload.array('pdfs', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).json({ error: 'Need at least 2 PDFs to merge' });
        }
        const merged = await PDFDocument.create();
        for (const file of req.files) {
            const bytes = await fs.readFile(file.path);
            const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const copied = await merged.copyPages(doc, doc.getPageIndices());
            copied.forEach(p => merged.addPage(p));
        }
        const outputBytes = await merged.save();
        const outputId = uuidv4() + '.pdf';
        await fs.writeFile(path.join(OUTPUT_DIR, outputId), outputBytes);
        for (const file of req.files) fs.unlink(file.path).catch(() => {});
        res.json({ success: true, outputId, pageCount: merged.getPageCount() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Split PDF by page groups
app.post('/api/split', async (req, res) => {
    const { fileId, pageGroups } = req.body;
    try {
        const pdfBytes = await fs.readFile(path.join(UPLOAD_DIR, fileId));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const total = pdfDoc.getPageCount();
        const outputIds = [];

        for (const group of pageGroups) {
            const newDoc = await PDFDocument.create();
            const indices = group.map(p => p - 1).filter(i => i >= 0 && i < total);
            if (indices.length === 0) continue;
            const copied = await newDoc.copyPages(pdfDoc, indices);
            copied.forEach(p => newDoc.addPage(p));
            const bytes = await newDoc.save();
            const outputId = uuidv4() + '.pdf';
            await fs.writeFile(path.join(OUTPUT_DIR, outputId), bytes);
            outputIds.push(outputId);
        }
        res.json({ success: true, outputIds });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Cleanup files older than 4 hours
setInterval(async () => {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
        const files = await fs.readdir(dir).catch(() => []);
        for (const f of files) {
            const fp = path.join(dir, f);
            const stat = await fs.stat(fp).catch(() => null);
            if (stat && stat.mtimeMs < cutoff) fs.unlink(fp).catch(() => {});
        }
    }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PDF Editor running on port ${PORT}`));
