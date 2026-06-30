const express = require('express');
const multer = require('multer');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
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
    await fs.mkdir('./uploads/versions', { recursive: true });
    await fs.mkdir('./uploads/workflows', { recursive: true });
})();

// ── Multer storages ────────────────────────────────────────────────────────

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

const imageStorage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase())
});

const imageUpload = multer({
    storage: imageStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG/PNG files allowed'));
    }
});

// ── Helper ─────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
    const h = (hex || '#000000').replace('#', '');
    return {
        r: parseInt(h.slice(0, 2), 16) / 255,
        g: parseInt(h.slice(2, 4), 16) / 255,
        b: parseInt(h.slice(4, 6), 16) / 255
    };
}

async function embedFont(pdfDoc) {
    try { return await pdfDoc.embedFont(StandardFonts.Helvetica); }
    catch { return await pdfDoc.embedFont(StandardFonts.TimesRoman); }
}

// Windows system TTF paths that support Thai (Unicode) — tried in order
const WIN_FONTS = {
    regular:    ['C:\\Windows\\Fonts\\arial.ttf',    'C:\\Windows\\Fonts\\segoeui.ttf',  'C:\\Windows\\Fonts\\tahoma.ttf'],
    bold:       ['C:\\Windows\\Fonts\\arialbd.ttf',  'C:\\Windows\\Fonts\\segoeuib.ttf', 'C:\\Windows\\Fonts\\tahomabd.ttf'],
    italic:     ['C:\\Windows\\Fonts\\ariali.ttf',   'C:\\Windows\\Fonts\\segoeuii.ttf', 'C:\\Windows\\Fonts\\arial.ttf'],
    bolditalic: ['C:\\Windows\\Fonts\\arialbi.ttf',  'C:\\Windows\\Fonts\\segoeuiz.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf']
};

// Embed a Unicode-capable TTF; cache per (pdfDoc request) via the cache Map.
async function embedUnicodeFont(pdfDoc, bold, italic, cache) {
    const variant = (bold && italic) ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    if (cache && cache.has(variant)) return cache.get(variant);

    pdfDoc.registerFontkit(fontkit);

    const paths = WIN_FONTS[variant] || WIN_FONTS.regular;
    for (const p of paths) {
        try {
            const bytes = await fs.readFile(p);
            const f = await pdfDoc.embedFont(bytes, { subset: true });
            if (cache) cache.set(variant, f);
            return f;
        } catch {}
    }
    // Last resort: standard font (Thai will fail but prevents crash)
    const f = await pdfDoc.embedFont(StandardFonts.Helvetica);
    if (cache) cache.set(variant, f);
    return f;
}

// ── Upload single PDF ──────────────────────────────────────────────────────

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

// ── Serve PDF bytes for PDF.js viewing ────────────────────────────────────

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

// ── Apply all operations and return outputId ───────────────────────────────

app.post('/api/process', async (req, res) => {
    const { fileId, operations = [], formValues = {} } = req.body;
    try {
        const pdfBytes = await fs.readFile(path.join(UPLOAD_DIR, fileId));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();
        const fontCache = new Map();
        const font = await embedUnicodeFont(pdfDoc, false, false, fontCache);

        for (const op of operations) {
            if (op.pageIndex < 0 || op.pageIndex >= pages.length) continue;
            const page = pages[op.pageIndex];

            if (op.type === 'whiteout') {
                page.drawRectangle({
                    x: op.pdfX, y: op.pdfY,
                    width: op.pdfWidth, height: op.pdfHeight,
                    color: rgb(1, 1, 1), borderWidth: 0
                });

            } else if (op.type === 'highlight') {
                const { r, g, b } = hexToRgb(op.color || '#ffff00');
                page.drawRectangle({
                    x: op.pdfX, y: op.pdfY,
                    width: op.pdfWidth, height: op.pdfHeight,
                    color: rgb(r, g, b),
                    opacity: parseFloat(op.opacity || 0.4),
                    borderWidth: 0
                });

            } else if (op.type === 'text') {
                const { r, g, b } = hexToRgb(op.color || '#000000');
                const opFont = await embedUnicodeFont(pdfDoc, op.bold, op.italic, fontCache);
                const opSize = op.fontSize || 12;
                page.drawText(op.text, {
                    x: op.pdfX, y: op.pdfY,
                    size: opSize,
                    font: opFont,
                    color: rgb(r, g, b)
                });
                if (op.underline) {
                    const tw = opFont.widthOfTextAtSize(op.text, opSize);
                    page.drawLine({
                        start: { x: op.pdfX, y: op.pdfY - 1.5 },
                        end:   { x: op.pdfX + tw, y: op.pdfY - 1.5 },
                        thickness: Math.max(0.5, opSize * 0.06),
                        color: rgb(r, g, b)
                    });
                }

            } else if (op.type === 'image') {
                const base64 = op.imageData.split(',')[1];
                const imgBytes = Buffer.from(base64, 'base64');
                const isPng = op.imageData.includes('image/png');
                const img = isPng ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
                page.drawImage(img, {
                    x: op.pdfX, y: op.pdfY,
                    width: op.pdfWidth, height: op.pdfHeight
                });

            } else if (op.type === 'shape') {
                const { r, g, b } = hexToRgb(op.color || '#ff0000');
                const bw = parseFloat(op.borderWidth || 2);

                if (op.subtype === 'rect') {
                    page.drawRectangle({
                        x: op.pdfX, y: op.pdfY,
                        width: op.pdfWidth, height: op.pdfHeight,
                        borderColor: rgb(r, g, b),
                        borderWidth: bw
                    });

                } else if (op.subtype === 'ellipse') {
                    page.drawEllipse({
                        x: op.pdfX + op.pdfWidth / 2,
                        y: op.pdfY + op.pdfHeight / 2,
                        xScale: op.pdfWidth / 2,
                        yScale: op.pdfHeight / 2,
                        borderColor: rgb(r, g, b),
                        borderWidth: bw
                    });

                } else if (op.subtype === 'line') {
                    page.drawLine({
                        start: { x: op.pdfX, y: op.pdfY },
                        end: { x: op.pdfX2, y: op.pdfY2 },
                        thickness: bw,
                        color: rgb(r, g, b)
                    });
                }
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

// ── Download processed PDF ─────────────────────────────────────────────────

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

// ── Merge multiple PDFs ────────────────────────────────────────────────────

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

// ── Split PDF by page groups ───────────────────────────────────────────────

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

// ── Add watermark to all pages ─────────────────────────────────────────────

app.post('/api/watermark', async (req, res) => {
    const { fileId, text, opacity = 0.3, fontSize = 60, color = '#888888', rotation = -45 } = req.body;
    try {
        const pdfBytes = await fs.readFile(path.join(UPLOAD_DIR, fileId));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();
        const font = await embedUnicodeFont(pdfDoc, false, false, new Map());
        const { r, g, b } = hexToRgb(color);

        for (const page of pages) {
            const { width, height } = page.getSize();
            const textWidth = font.widthOfTextAtSize(text, fontSize);
            page.drawText(text, {
                x: (width - textWidth) / 2,
                y: (height - fontSize) / 2,
                size: fontSize,
                font,
                color: rgb(r, g, b),
                opacity,
                rotate: degrees(rotation)
            });
        }

        const outputBytes = await pdfDoc.save();
        const outputId = uuidv4() + '.pdf';
        await fs.writeFile(path.join(OUTPUT_DIR, outputId), outputBytes);
        res.json({ success: true, outputId });
    } catch (err) {
        console.error('Watermark error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Page Manager (rotate / delete) ────────────────────────────────────────

app.post('/api/pages', async (req, res) => {
    const { fileId, ops = [] } = req.body;
    try {
        const pdfBytes = await fs.readFile(path.join(UPLOAD_DIR, fileId));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();

        // Apply rotations first
        for (const op of ops) {
            if (op.type === 'rotate') {
                if (op.pageIndex < 0 || op.pageIndex >= pages.length) continue;
                const page = pages[op.pageIndex];
                const cur = page.getRotation().angle || 0;
                page.setRotation(degrees((cur + op.degrees) % 360));
            }
        }

        // Apply deletions (descending index order)
        const deleteIndices = ops
            .filter(op => op.type === 'delete')
            .map(op => op.pageIndex)
            .filter(idx => idx >= 0 && idx < pages.length);

        const uniqueDesc = [...new Set(deleteIndices)].sort((a, b) => b - a);
        for (const idx of uniqueDesc) {
            pdfDoc.removePage(idx);
        }

        const outputBytes = await pdfDoc.save();
        const outputId = uuidv4() + '.pdf';
        await fs.writeFile(path.join(OUTPUT_DIR, outputId), outputBytes);
        res.json({ success: true, outputId });
    } catch (err) {
        console.error('Pages error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Compress PDF ───────────────────────────────────────────────────────────

app.post('/api/compress', async (req, res) => {
    const { fileId } = req.body;
    try {
        const inputPath = path.join(UPLOAD_DIR, fileId);
        const pdfBytes = await fs.readFile(inputPath);
        const originalSize = pdfBytes.length;

        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const outputBytes = await pdfDoc.save({ useObjectStreams: true });
        const newSize = outputBytes.length;

        const outputId = uuidv4() + '.pdf';
        await fs.writeFile(path.join(OUTPUT_DIR, outputId), outputBytes);
        res.json({ success: true, outputId, originalSize, newSize });
    } catch (err) {
        console.error('Compress error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Add Header / Footer / Page Numbers ────────────────────────────────────

app.post('/api/addpages', async (req, res) => {
    const {
        fileId,
        headerText = '',
        footerText = '',
        addPageNumbers = false,
        startPage = 1,
        fontSize = 11
    } = req.body;
    try {
        const pdfBytes = await fs.readFile(path.join(UPLOAD_DIR, fileId));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();
        const font = await embedUnicodeFont(pdfDoc, false, false, new Map());

        pages.forEach((page, i) => {
            const { width, height } = page.getSize();

            if (headerText) {
                const tw = font.widthOfTextAtSize(headerText, fontSize);
                page.drawText(headerText, {
                    x: (width - tw) / 2,
                    y: height - 20,
                    size: fontSize,
                    font,
                    color: rgb(0.2, 0.2, 0.2)
                });
            }

            let footer = footerText;
            if (addPageNumbers) {
                const pn = String(startPage + i);
                footer = footer ? `${footer}   ${pn}` : pn;
            }

            if (footer) {
                const tw = font.widthOfTextAtSize(footer, fontSize);
                page.drawText(footer, {
                    x: (width - tw) / 2,
                    y: 15,
                    size: fontSize,
                    font,
                    color: rgb(0.2, 0.2, 0.2)
                });
            }
        });

        const outputBytes = await pdfDoc.save();
        const outputId = uuidv4() + '.pdf';
        await fs.writeFile(path.join(OUTPUT_DIR, outputId), outputBytes);
        res.json({ success: true, outputId });
    } catch (err) {
        console.error('AddPages error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Image → PDF ────────────────────────────────────────────────────────────

app.post('/api/image-to-pdf', imageUpload.array('images', 30), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        const pdfDoc = await PDFDocument.create();

        for (const file of req.files) {
            const imgBytes = await fs.readFile(file.path);
            const isJpg = file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg';
            const img = isJpg ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);
            const { width, height } = img;
            const page = pdfDoc.addPage([width, height]);
            page.drawImage(img, { x: 0, y: 0, width, height });
            fs.unlink(file.path).catch(() => {});
        }

        const outputBytes = await pdfDoc.save();
        const outputId = uuidv4() + '.pdf';
        await fs.writeFile(path.join(OUTPUT_DIR, outputId), outputBytes);
        res.json({ success: true, outputId, pageCount: pdfDoc.getPageCount() });
    } catch (err) {
        console.error('Image-to-PDF error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Version Control ────────────────────────────────────────────────────────

app.post('/api/versions/save', async (req, res) => {
    const { fileId, versionName, description } = req.body;
    try {
        const metaPath = path.join('./uploads/versions', fileId.replace('.pdf', '') + '.json');
        let meta = { fileId, versions: [] };
        try { meta = JSON.parse(await fs.readFile(metaPath, 'utf8')); } catch (_) {}

        const pdfBytes = await fs.readFile(path.join(UPLOAD_DIR, fileId));
        const versionId = uuidv4();
        const versionFile = versionId + '.pdf';
        await fs.writeFile(path.join('./uploads/versions', versionFile), pdfBytes);

        meta.versions.push({
            id: versionId,
            name: versionName || `Version ${meta.versions.length + 1}`,
            description: description || '',
            filename: versionFile,
            timestamp: new Date().toISOString(),
            size: pdfBytes.length
        });
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
        res.json({ success: true, versionId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/versions/:fileId', async (req, res) => {
    try {
        const metaPath = path.join('./uploads/versions', req.params.fileId.replace('.pdf', '') + '.json');
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        res.json({ success: true, versions: meta.versions });
    } catch (_) {
        res.json({ success: true, versions: [] });
    }
});

app.get('/api/version-file/:versionId', async (req, res) => {
    const fp = path.join('./uploads/versions', req.params.versionId + '.pdf');
    try {
        const data = await fs.readFile(fp);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="version_${req.params.versionId}.pdf"`);
        res.send(data);
    } catch {
        res.status(404).json({ error: 'Version not found' });
    }
});

app.post('/api/versions/:versionId/restore', async (req, res) => {
    const { fileId } = req.body;
    try {
        const src = path.join('./uploads/versions', req.params.versionId + '.pdf');
        const dst = path.join(UPLOAD_DIR, fileId);
        await fs.copyFile(src, dst);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/versions/:versionId', async (req, res) => {
    const { fileId } = req.body;
    try {
        const metaPath = path.join('./uploads/versions', fileId.replace('.pdf', '') + '.json');
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        const ver = meta.versions.find(v => v.id === req.params.versionId);
        if (ver) {
            await fs.unlink(path.join('./uploads/versions', ver.filename)).catch(() => {});
            meta.versions = meta.versions.filter(v => v.id !== req.params.versionId);
            await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Approval Workflow ──────────────────────────────────────────────────────

app.post('/api/workflow/create', async (req, res) => {
    const { fileId, title, steps = [] } = req.body;
    try {
        const id = uuidv4();
        const workflow = {
            id, fileId, title,
            steps: steps.map((s, i) => ({
                index: i, name: s.name, role: s.role, email: s.email || '',
                status: 'pending', comment: '', timestamp: null
            })),
            currentStep: 0,
            status: 'active',
            createdAt: new Date().toISOString()
        };
        await fs.writeFile(path.join('./uploads/workflows', id + '.json'), JSON.stringify(workflow, null, 2));
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/workflow/:id', async (req, res) => {
    try {
        const wf = JSON.parse(await fs.readFile(path.join('./uploads/workflows', req.params.id + '.json'), 'utf8'));
        res.json({ success: true, workflow: wf });
    } catch {
        res.status(404).json({ error: 'Workflow not found' });
    }
});

app.get('/api/workflows', async (req, res) => {
    try {
        const files = await fs.readdir('./uploads/workflows').catch(() => []);
        const workflows = [];
        for (const f of files) {
            if (!f.endsWith('.json')) continue;
            try {
                const wf = JSON.parse(await fs.readFile(path.join('./uploads/workflows', f), 'utf8'));
                workflows.push(wf);
            } catch (_) {}
        }
        workflows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, workflows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/workflow/:id/action', async (req, res) => {
    const { stepIndex, action, comment } = req.body;
    try {
        const fp = path.join('./uploads/workflows', req.params.id + '.json');
        const wf = JSON.parse(await fs.readFile(fp, 'utf8'));
        if (stepIndex < 0 || stepIndex >= wf.steps.length) return res.status(400).json({ error: 'Invalid step' });
        wf.steps[stepIndex].status = action;
        wf.steps[stepIndex].comment = comment || '';
        wf.steps[stepIndex].timestamp = new Date().toISOString();
        if (action === 'rejected') {
            wf.status = 'rejected';
        } else if (action === 'approved') {
            const nextPending = wf.steps.findIndex((s, i) => i > stepIndex && s.status === 'pending');
            if (nextPending >= 0) {
                wf.currentStep = nextPending;
            } else {
                const allApproved = wf.steps.every(s => s.status === 'approved');
                if (allApproved) wf.status = 'completed';
            }
        }
        await fs.writeFile(fp, JSON.stringify(wf, null, 2));
        res.json({ success: true, workflow: wf });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/workflow/:id', async (req, res) => {
    try {
        await fs.unlink(path.join('./uploads/workflows', req.params.id + '.json'));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Cleanup files older than 4 hours ──────────────────────────────────────

setInterval(async () => {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
        const files = await fs.readdir(dir).catch(() => []);
        for (const f of files) {
            const fp = path.join(dir, f);
            const stat = await fs.stat(fp).catch(() => null);
            if (stat && stat.isFile() && stat.mtimeMs < cutoff) fs.unlink(fp).catch(() => {});
        }
    }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PDF Editor running on port ${PORT}`));
