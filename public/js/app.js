pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ──────────────────────────────────────────────────────────────────
const S = {
    fileId: null,
    originalName: '',
    pageCount: 0,
    formFields: [],
    pdfDoc: null,
    scale: 1.5,
    tool: 'select',
    annotations: [],   // { id, type, pageIndex, pdfX, pdfY, ... }
    nextId: 1,
    sigData: null,
    stampData: null,
    formValues: {},
    dragging: null,    // { el, ann, startX, startY, origLeft, origTop }
    mergeFiles: []
};

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setupUpload();
    setupToolbar();
    setupSignaturePad();
    setupStampUpload();
    setupMerge();
    setupSplit();
    setupDownload();
    setupReset();
    setupBack();
    setupDragMove();
});

// ── Upload Screen ──────────────────────────────────────────────────────────
function setupUpload() {
    const dz = document.getElementById('drop-zone');
    const fi = document.getElementById('file-input');
    const btn = document.getElementById('btn-choose-file');
    const qaMerge = document.getElementById('qa-merge');
    const qaSplit = document.getElementById('qa-split');

    btn.addEventListener('click', () => fi.click());
    dz.addEventListener('click', e => { if (e.target === dz || e.target.classList.contains('dz-main') || e.target.classList.contains('dz-icon')) fi.click(); });
    fi.addEventListener('change', () => { if (fi.files[0]) uploadFile(fi.files[0]); });

    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        const f = e.dataTransfer.files[0];
        if (f && f.name.endsWith('.pdf')) uploadFile(f);
    });

    qaMerge.addEventListener('click', openMerge);
    qaSplit.addEventListener('click', () => {
        // Need a file first — open file picker then switch to split tool
        fi.click();
        fi.onchange = () => {
            if (fi.files[0]) {
                uploadFile(fi.files[0]).then(() => activateTool('split'));
                fi.onchange = () => { if (fi.files[0]) uploadFile(fi.files[0]); };
            }
        };
    });
}

async function uploadFile(file) {
    showLoading('กำลังอัปโหลด...');
    try {
        const fd = new FormData();
        fd.append('pdf', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        S.fileId = data.fileId;
        S.originalName = data.originalName;
        S.pageCount = data.pageCount;
        S.formFields = data.formFields || [];
        S.annotations = [];
        S.formValues = {};
        S.sigData = null;
        S.stampData = null;
        S.nextId = 1;

        document.getElementById('file-name').textContent = data.originalName;
        document.getElementById('page-badge').textContent = `${data.pageCount} หน้า`;

        showScreen('editor');
        await renderPdf();
        renderFormFields();
        updateAnnotationList();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ── PDF Rendering ──────────────────────────────────────────────────────────
async function renderPdf() {
    showLoading('กำลังโหลด PDF...');
    try {
        const loadingTask = pdfjsLib.getDocument(`/api/pdf/${S.fileId}`);
        S.pdfDoc = await loadingTask.promise;

        const container = document.getElementById('pages-container');
        container.innerHTML = '';

        // Determine scale from first page
        const firstPage = await S.pdfDoc.getPage(1);
        const vp1 = firstPage.getViewport({ scale: 1 });
        const viewerW = document.getElementById('viewer-wrap').clientWidth - 60;
        S.scale = Math.min(Math.max(viewerW / vp1.width, 0.8), 2.5);

        for (let i = 1; i <= S.pdfDoc.numPages; i++) {
            const page = await S.pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: S.scale });

            // Wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'page-wrapper';
            wrapper.dataset.pageIndex = i - 1;

            // PDF canvas
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            // Annotation overlay
            const overlay = document.createElement('div');
            overlay.className = 'annotation-overlay tool-select';
            overlay.dataset.pageIndex = i - 1;
            overlay.dataset.pdfW = (viewport.width / S.scale).toFixed(2);
            overlay.dataset.pdfH = (viewport.height / S.scale).toFixed(2);
            overlay.style.width = viewport.width + 'px';
            overlay.style.height = viewport.height + 'px';
            overlay.addEventListener('click', handleOverlayClick);

            wrapper.appendChild(canvas);
            wrapper.appendChild(overlay);
            container.appendChild(wrapper);

            const lbl = document.createElement('div');
            lbl.className = 'page-label';
            lbl.textContent = `หน้า ${i} / ${S.pdfDoc.numPages}`;
            container.appendChild(lbl);
        }
    } catch (err) {
        alert('โหลด PDF ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ── Toolbar ────────────────────────────────────────────────────────────────
function setupToolbar() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => activateTool(btn.dataset.tool));
    });
}

function activateTool(tool) {
    S.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    if (tool === 'merge') { openMerge(); return; }

    const panelMap = { select: 'select', text: 'text', signature: 'signature', stamp: 'stamp', forms: 'forms', split: 'split' };
    const pId = panelMap[tool] || 'select';
    const panel = document.getElementById('panel-' + pId);
    if (panel) panel.classList.add('active');

    // Update overlay cursor class
    document.querySelectorAll('.annotation-overlay').forEach(ov => {
        ov.className = `annotation-overlay tool-${tool}`;
    });
}

// ── Overlay Click ──────────────────────────────────────────────────────────
function handleOverlayClick(e) {
    if (S.dragging) return; // ignore click after drag
    const ov = e.currentTarget;
    const rect = ov.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const pageIndex = parseInt(ov.dataset.pageIndex);
    const pdfH = parseFloat(ov.dataset.pdfH);

    const pdfX = cx / S.scale;
    const pdfY = pdfH - cy / S.scale;

    if (S.tool === 'text') spawnTextInput(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH);
    else if (S.tool === 'signature' && S.sigData) placeImage(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH, S.sigData, 'signature');
    else if (S.tool === 'stamp' && S.stampData) placeImage(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH, S.stampData, 'stamp');
    else if (S.tool === 'signature' && !S.sigData) activateTool('signature');
    else if (S.tool === 'stamp' && !S.stampData) activateTool('stamp');
}

// ── Text Tool ──────────────────────────────────────────────────────────────
function spawnTextInput(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH) {
    const fontSize = parseInt(document.getElementById('text-size').value) || 14;
    const color = document.getElementById('text-color').value || '#000000';
    const pxSize = fontSize * S.scale;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'text-input-el';
    inp.style.left = cx + 'px';
    inp.style.top = (cy - pxSize) + 'px';
    inp.style.fontSize = pxSize + 'px';
    inp.style.color = color;
    inp.placeholder = 'พิมพ์ข้อความ...';

    const commit = () => {
        const txt = inp.value.trim();
        inp.remove();
        if (!txt) return;
        // pdfY adjusted: baseline = click Y → pdfY already = pdfH - cy/scale
        const ann = { id: S.nextId++, type: 'text', pageIndex, pdfX, pdfY, text: txt, fontSize, color };
        S.annotations.push(ann);
        renderAnnotationElement(ov, ann, cx, cy - pxSize, pdfH);
        updateAnnotationList();
    };

    inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') inp.remove(); });
    inp.addEventListener('blur', commit);
    ov.appendChild(inp);
    inp.focus();
}

// ── Image/Signature Tool ───────────────────────────────────────────────────
function placeImage(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH, imageData, subtype) {
    const stampPtWidth = parseInt(document.getElementById('stamp-width')?.value || 150);

    const img = new Image();
    img.src = imageData;
    img.onload = () => {
        const ratio = img.naturalHeight / img.naturalWidth;
        const pdfWidth = stampPtWidth;
        const pdfHeight = pdfWidth * ratio;
        const canvasW = pdfWidth * S.scale;
        const canvasH = pdfHeight * S.scale;

        // bottom-left in PDF coords (image centered on click)
        const imgPdfX = pdfX - pdfWidth / 2;
        const imgPdfY = pdfY - pdfHeight / 2;

        const ann = { id: S.nextId++, type: 'image', subtype, pageIndex, pdfX: imgPdfX, pdfY: imgPdfY, pdfWidth, pdfHeight, imageData };
        S.annotations.push(ann);

        const elX = cx - canvasW / 2;
        const elY = cy - canvasH / 2;
        renderAnnotationElement(ov, ann, elX, elY, pdfH);
        updateAnnotationList();
    };
}

// ── Render annotation DOM element ──────────────────────────────────────────
function renderAnnotationElement(ov, ann, elX, elY, pdfH) {
    let el;
    if (ann.type === 'text') {
        el = document.createElement('div');
        el.className = 'annot-text';
        el.textContent = ann.text;
        el.style.left = elX + 'px';
        el.style.top = elY + 'px';
        el.style.fontSize = (ann.fontSize * S.scale) + 'px';
        el.style.color = ann.color;
    } else {
        el = document.createElement('img');
        el.className = 'annot-image';
        el.src = ann.imageData;
        el.style.left = elX + 'px';
        el.style.top = elY + 'px';
        el.style.width = (ann.pdfWidth * S.scale) + 'px';
        el.style.height = (ann.pdfHeight * S.scale) + 'px';
    }

    el.dataset.annId = ann.id;
    el.title = 'คลิกขวาเพื่อลบ | ลากเพื่อย้าย';

    el.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        removeAnnotation(ann.id);
    });

    makeDraggable(el, ann, ov, pdfH);
    ov.appendChild(el);
}

// ── Draggable annotations ──────────────────────────────────────────────────
function makeDraggable(el, ann, ov, pdfH) {
    el.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const rect = ov.getBoundingClientRect();
        S.dragging = {
            el, ann, ov, pdfH,
            startX: e.clientX, startY: e.clientY,
            origLeft: parseFloat(el.style.left),
            origTop: parseFloat(el.style.top)
        };
    });
}

function setupDragMove() {
    document.addEventListener('mousemove', e => {
        if (!S.dragging) return;
        const { el, ann, ov, pdfH, startX, startY, origLeft, origTop } = S.dragging;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newLeft = origLeft + dx;
        const newTop = origTop + dy;
        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';

        // Update PDF coords
        if (ann.type === 'text') {
            const pxSize = ann.fontSize * S.scale;
            ann.pdfX = newLeft / S.scale;
            ann.pdfY = pdfH - (newTop + pxSize) / S.scale;
        } else {
            ann.pdfX = newLeft / S.scale;
            ann.pdfY = pdfH - (newTop + ann.pdfHeight * S.scale) / S.scale;
        }
    });

    document.addEventListener('mouseup', () => {
        if (S.dragging) {
            // Brief timeout so the overlay click handler sees S.dragging still set
            const d = S.dragging;
            S.dragging = null;
            setTimeout(() => {}, 10);
        }
    });
}

// ── Annotation management ──────────────────────────────────────────────────
function removeAnnotation(id) {
    S.annotations = S.annotations.filter(a => a.id !== id);
    document.querySelectorAll(`[data-ann-id="${id}"]`).forEach(el => el.remove());
    updateAnnotationList();
}

function updateAnnotationList() {
    const list = document.getElementById('annotation-list');
    if (S.annotations.length === 0) {
        list.innerHTML = '<p class="empty-hint">ยังไม่มีรายการ<br>เลือกเครื่องมือด้านซ้ายเพื่อเริ่ม</p>';
        return;
    }
    list.innerHTML = S.annotations.map(a => {
        const icon = a.type === 'text' ? 'T' : (a.subtype === 'signature' ? '✍' : '🖼');
        const label = a.type === 'text' ? a.text.substring(0, 20) : (a.subtype === 'signature' ? 'ลายเซ็น' : 'รูปภาพ');
        return `<div class="annot-item">
            <span class="annot-item-icon">${icon}</span>
            <div class="annot-item-info">
                <div class="annot-item-label">${label}</div>
                <div class="annot-item-meta">หน้า ${a.pageIndex + 1}</div>
            </div>
            <button class="annot-item-del" onclick="removeAnnotation(${a.id})">✕</button>
        </div>`;
    }).join('');
}

// ── Signature Pad ──────────────────────────────────────────────────────────
function setupSignaturePad() {
    const canvas = document.getElementById('sig-canvas');
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let drawing = false, lx = 0, ly = 0;

    const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
    };

    const start = (e) => { e.preventDefault(); drawing = true; const p = getPos(e); lx = p.x; ly = p.y; };
    const move = (e) => {
        e.preventDefault();
        if (!drawing) return;
        const p = getPos(e);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke();
        lx = p.x; ly = p.y;
    };
    const end = () => { drawing = false; };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    document.getElementById('sig-clear').addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        S.sigData = null;
        document.getElementById('sig-status').textContent = '';
    });

    document.getElementById('sig-use').addEventListener('click', () => {
        S.sigData = canvas.toDataURL('image/png');
        document.getElementById('sig-status').textContent = '✅ พร้อมใช้ — คลิกบนหน้า PDF เพื่อวาง';
    });
}

// ── Stamp Upload ───────────────────────────────────────────────────────────
function setupStampUpload() {
    const btn = document.getElementById('stamp-upload-btn');
    const fi = document.getElementById('stamp-file');
    btn.addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => {
        const file = fi.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            S.stampData = ev.target.result;
            document.getElementById('stamp-preview').innerHTML =
                `<img src="${S.stampData}" alt="stamp">`;
            document.getElementById('stamp-status').textContent = '✅ พร้อมใช้ — คลิกบนหน้า PDF เพื่อวาง';
        };
        reader.readAsDataURL(file);
    });
}

// ── Form Fields ────────────────────────────────────────────────────────────
function renderFormFields() {
    const container = document.getElementById('form-fields-list');
    if (!S.formFields || S.formFields.length === 0) {
        container.innerHTML = '<p class="empty-hint">ไม่พบ form fields<br>ใน PDF นี้</p>';
        return;
    }
    container.innerHTML = S.formFields.map(f => {
        if (f.type === 'CheckBox') {
            return `<div class="field-item">
                <label>${f.name}</label>
                <input type="checkbox" ${f.value === 'true' ? 'checked' : ''} onchange="S.formValues['${f.name}'] = this.checked ? 'true' : 'false'">
            </div>`;
        }
        return `<div class="field-item">
            <label>${f.name}</label>
            <input type="text" value="${f.value || ''}" oninput="S.formValues['${f.name}'] = this.value" placeholder="${f.type}">
        </div>`;
    }).join('');
}

// ── Merge ──────────────────────────────────────────────────────────────────
function setupMerge() {
    const modal = document.getElementById('merge-modal');
    const close = document.getElementById('merge-close');
    const cancel = document.getElementById('merge-cancel');
    const fi = document.getElementById('merge-file-input');
    const dz = document.getElementById('merge-drop');
    const doBtn = document.getElementById('btn-do-merge');

    const closeModal = () => { modal.style.display = 'none'; S.mergeFiles = []; document.getElementById('merge-list').innerHTML = ''; };
    close.addEventListener('click', closeModal);
    cancel.addEventListener('click', closeModal);

    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => addMergeFiles(fi.files));
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addMergeFiles(e.dataTransfer.files); });

    doBtn.addEventListener('click', doMerge);
}

function addMergeFiles(files) {
    for (const f of files) {
        if (f.name.endsWith('.pdf')) S.mergeFiles.push(f);
    }
    renderMergeList();
}

function renderMergeList() {
    const list = document.getElementById('merge-list');
    if (S.mergeFiles.length === 0) { list.innerHTML = ''; return; }
    list.innerHTML = S.mergeFiles.map((f, i) =>
        `<div class="merge-item">
            <span>📄</span>
            <span class="merge-item-name">${f.name}</span>
            <button class="annot-item-del" onclick="S.mergeFiles.splice(${i},1);renderMergeList()">✕</button>
        </div>`
    ).join('');
}

function openMerge() {
    S.mergeFiles = [];
    document.getElementById('merge-list').innerHTML = '';
    document.getElementById('merge-modal').style.display = 'flex';
    // Reset toolbar active (merge doesn't have a persistent panel)
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
}

async function doMerge() {
    if (S.mergeFiles.length < 2) { alert('กรุณาเลือกอย่างน้อย 2 ไฟล์'); return; }
    showLoading('กำลังรวม PDF...');
    try {
        const fd = new FormData();
        S.mergeFiles.forEach(f => fd.append('pdfs', f));
        const res = await fetch('/api/merge', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        triggerDownload(`/api/download/${data.outputId}`, 'merged.pdf');
        document.getElementById('merge-modal').style.display = 'none';
        S.mergeFiles = [];
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ── Split ──────────────────────────────────────────────────────────────────
function setupSplit() {
    document.getElementById('add-range').addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'split-row';
        row.innerHTML = `<input type="text" class="range-input" placeholder="เช่น 4-6"><button class="remove-range">&#10005;</button>`;
        row.querySelector('.remove-range').addEventListener('click', () => row.remove());
        document.getElementById('split-ranges').appendChild(row);
    });

    document.getElementById('split-ranges').addEventListener('click', e => {
        if (e.target.classList.contains('remove-range')) {
            const rows = document.querySelectorAll('#split-ranges .split-row');
            if (rows.length > 1) e.target.closest('.split-row').remove();
        }
    });

    document.getElementById('btn-do-split').addEventListener('click', doSplit);
}

function parseRange(str, total) {
    const pages = new Set();
    str.split(',').forEach(part => {
        part = part.trim();
        if (part.includes('-')) {
            const [a, b] = part.split('-').map(Number);
            for (let i = a; i <= b; i++) if (i >= 1 && i <= total) pages.add(i);
        } else {
            const n = parseInt(part);
            if (n >= 1 && n <= total) pages.add(n);
        }
    });
    return [...pages].sort((a, b) => a - b);
}

async function doSplit() {
    if (!S.fileId) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
    const inputs = document.querySelectorAll('#split-ranges .range-input');
    const groups = [...inputs].map(i => parseRange(i.value, S.pageCount)).filter(g => g.length > 0);
    if (groups.length === 0) { alert('กรุณาระบุช่วงหน้าให้ถูกต้อง'); return; }

    showLoading('กำลังแยก PDF...');
    try {
        const res = await fetch('/api/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: S.fileId, pageGroups: groups })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        // Download all parts sequentially
        for (let i = 0; i < data.outputIds.length; i++) {
            await new Promise(r => setTimeout(r, 400 * i));
            triggerDownload(`/api/download/${data.outputIds[i]}`, `part${i + 1}.pdf`);
        }
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ── Download (Apply & Save) ────────────────────────────────────────────────
function setupDownload() {
    document.getElementById('btn-download').addEventListener('click', async () => {
        if (!S.fileId) return;
        showLoading('กำลังสร้างไฟล์...');
        try {
            const res = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileId: S.fileId,
                    operations: S.annotations.map(a => {
                        if (a.type === 'text') {
                            return { type: 'text', pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, text: a.text, fontSize: a.fontSize, color: a.color };
                        } else {
                            return { type: 'image', pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, pdfWidth: a.pdfWidth, pdfHeight: a.pdfHeight, imageData: a.imageData };
                        }
                    }),
                    formValues: S.formValues
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            const outName = 'edited_' + S.originalName;
            triggerDownload(`/api/download/${data.outputId}`, outName);
        } catch (err) {
            alert('เกิดข้อผิดพลาด: ' + err.message);
        } finally {
            hideLoading();
        }
    });
}

// ── Reset & Back ───────────────────────────────────────────────────────────
function setupReset() {
    document.getElementById('btn-reset').addEventListener('click', () => {
        if (S.annotations.length === 0 && Object.keys(S.formValues).length === 0) return;
        if (!confirm('ล้างการแก้ไขทั้งหมดหรือไม่?')) return;
        S.annotations = [];
        S.formValues = {};
        document.querySelectorAll('.annot-text, .annot-image').forEach(el => el.remove());
        updateAnnotationList();
        renderFormFields();
    });
}

function setupBack() {
    document.getElementById('btn-back').addEventListener('click', () => {
        if (S.annotations.length > 0 || Object.keys(S.formValues).length > 0) {
            if (!confirm('กลับไปจะสูญเสียการแก้ไข ต้องการดำเนินต่อหรือไม่?')) return;
        }
        S.fileId = null;
        S.pdfDoc = null;
        S.annotations = [];
        document.getElementById('pages-container').innerHTML = '';
        showScreen('upload');
        // Reset file input
        document.getElementById('file-input').value = '';
    });
}

// ── Utilities ──────────────────────────────────────────────────────────────
function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(name + '-screen').classList.add('active');
}

function showLoading(text = 'กำลังประมวลผล...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}
