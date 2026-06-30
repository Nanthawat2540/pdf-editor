pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const S = {
    fileId: null,
    originalName: '',
    pageCount: 0,
    formFields: [],
    pdfDoc: null,
    baseScale: 1.5,
    scale: 1.5,
    zoomIndex: 2,
    tool: 'edittext',
    shapeSubtype: 'rect',
    annotations: [],
    redoStack: [],
    nextId: 1,
    sigData: null,
    stampData: null,
    formValues: {},
    pageOps: [],
    pagePdfHeights: {},
    dragging: null,
    drawingRect: null,
    drawingLine: null,
    mergeFiles: [],
    img2pdfFiles: [],
    activeDrawCanvases: {},
    pageTextItems: {},
    canvasSnapshots: {},
    editTextDrag: null,
    _suppressEditClick: false
};

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 175, 200];

document.addEventListener('DOMContentLoaded', () => {
    setupUpload();
    setupToolbar();
    setupFmtToolbar();
    setupSignaturePad();
    setupStampUpload();
    setupMerge();
    setupImg2Pdf();
    setupSplit();
    setupWatermark();
    setupDownload();
    setupReset();
    setupBack();
    setupDragMove();
    setupUndoRedo();
    setupZoom();
    setupPageManager();
    setupHeaderFooter();
    setupDraw();
    setupHighlightOpacity();
    setupTabSidebar();
    setupOCR();
    setupVersions();
    setupWorkflow();
    setupCompressBtn();
    setupSaveVersionHeader();
});

function setupFmtToolbar() {
    const toolbar = document.getElementById('shared-word-toolbar');
    if (!toolbar) return;

    toolbar.querySelectorAll('.fmt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            updateFmtPreview();
        });
    });

    toolbar.querySelector('.fmt-font').addEventListener('change', updateFmtPreview);
    toolbar.querySelector('.fmt-size').addEventListener('input',  updateFmtPreview);
    toolbar.querySelector('.fmt-color').addEventListener('input', updateFmtPreview);

    updateFmtPreview();
}

function updateFmtPreview() {
    const toolbar = document.getElementById('shared-word-toolbar');
    if (!toolbar) return;
    const preview = toolbar.querySelector('.wtb-preview');
    if (!preview) return;
    const fmt = getFmt();
    preview.style.fontFamily    = fontFamilyCSS(fmt.font);
    preview.style.fontWeight    = fmt.bold      ? 'bold'      : 'normal';
    preview.style.fontStyle     = fmt.italic    ? 'italic'    : 'normal';
    preview.style.textDecoration = fmt.underline ? 'underline' : 'none';
    preview.style.color         = fmt.color;
}

function getFmt() {
    const toolbar = document.getElementById('shared-word-toolbar');
    if (!toolbar || !toolbar.classList.contains('visible')) {
        return { font: 'helvetica', size: 14, bold: false, italic: false, underline: false, color: '#000000' };
    }
    return {
        font:      toolbar.querySelector('.fmt-font')?.value      || 'helvetica',
        size:      parseInt(toolbar.querySelector('.fmt-size')?.value) || 14,
        bold:      toolbar.querySelector('.fmt-bold')?.classList.contains('active')      || false,
        italic:    toolbar.querySelector('.fmt-italic')?.classList.contains('active')    || false,
        underline: toolbar.querySelector('.fmt-underline')?.classList.contains('active') || false,
        color:     toolbar.querySelector('.fmt-color')?.value || '#000000'
    };
}

function fontFamilyCSS(family) {
    if (family === 'times')   return 'Times New Roman, Times, serif';
    if (family === 'courier') return 'Courier New, Courier, monospace';
    return 'Helvetica, Arial, sans-serif';
}

function showWordToolbar(show) {
    const toolbar = document.getElementById('shared-word-toolbar');
    if (toolbar) toolbar.classList.toggle('visible', show);
}

function setupUpload() {
    const dz  = document.getElementById('drop-zone');
    const fi  = document.getElementById('file-input');
    const btn = document.getElementById('btn-choose-file');

    if (btn) btn.addEventListener('click', () => fi && fi.click());
    if (dz) {
        dz.addEventListener('click', e => {
            if (e.target === dz || e.target.classList.contains('dz-main') || e.target.classList.contains('dz-icon')) {
                if (fi) fi.click();
            }
        });
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', e => {
            e.preventDefault();
            dz.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f && f.name.toLowerCase().endsWith('.pdf')) uploadFile(f);
        });
    }
    if (fi) fi.addEventListener('change', () => { if (fi.files[0]) uploadFile(fi.files[0]); });

    const qaM = document.getElementById('qa-merge');
    const qaI = document.getElementById('qa-img2pdf');
    if (qaM) qaM.addEventListener('click', openMerge);
    if (qaI) qaI.addEventListener('click', openImg2Pdf);
}

async function uploadFile(file) {
    showLoading('กำลังอัปโหลด...');
    try {
        const fd = new FormData();
        fd.append('pdf', file);
        const res  = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        S.fileId        = data.fileId;
        S.originalName  = data.originalName;
        S.pageCount     = data.pageCount;
        S.formFields    = data.formFields || [];
        S.annotations   = [];
        S.redoStack     = [];
        S.formValues    = {};
        S.sigData       = null;
        S.stampData     = null;
        S.nextId        = 1;
        S.pageOps       = [];
        S.pagePdfHeights = {};
        S.activeDrawCanvases = {};
        S.pageTextItems = {};
        S.pdfDoc        = null;

        const fnEl = document.getElementById('file-name');
        const pbEl = document.getElementById('page-badge');
        if (fnEl) fnEl.textContent = data.originalName;
        if (pbEl) pbEl.textContent = `${data.pageCount} หน้า`;

        showScreen('editor');
        showWordToolbar(S.tool === 'text' || S.tool === 'edittext');
        await renderPdf();
        renderFormFields();
        updateAnnotationList();
        renderPageManager();
        loadVersions();
        loadWorkflows();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        hideLoading();
    }
}

async function renderPdf() {
    showLoading('กำลังโหลด PDF...');
    try {
        if (!S.pdfDoc) {
            const loadingTask = pdfjsLib.getDocument(`/api/pdf/${S.fileId}`);
            S.pdfDoc = await loadingTask.promise;
        }

        const container = document.getElementById('pages-container');
        container.innerHTML = '';
        S.activeDrawCanvases = {};
        S.pageTextItems = {};

        const firstPage = await S.pdfDoc.getPage(1);
        const vp1 = firstPage.getViewport({ scale: 1 });
        const viewerWrap = document.getElementById('viewer-wrap');
        const viewerW = viewerWrap ? viewerWrap.clientWidth - 60 : 800;
        S.baseScale = Math.min(Math.max(viewerW / vp1.width, 0.5), 2.5);
        S.scale = S.baseScale * (ZOOM_LEVELS[S.zoomIndex] / 100);

        for (let i = 1; i <= S.pdfDoc.numPages; i++) {
            const page     = await S.pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: S.scale });
            const pdfH     = viewport.height / S.scale;
            S.pagePdfHeights[i - 1] = pdfH;

            const textContent = await page.getTextContent();
            const items = [];
            for (const item of textContent.items) {
                if (!item.str || !item.str.trim()) continue;
                const tx      = pdfjsLib.Util.transform(viewport.transform, item.transform);
                const canvasH = Math.abs(item.height * S.scale);
                const canvasW = Math.abs(item.width  * S.scale);
                const canvasX = tx[4];
                const canvasY = tx[5] - canvasH;
                items.push({
                    str:           item.str,
                    canvasX,
                    canvasY,
                    canvasW:       Math.max(canvasW, 8),
                    canvasH:       Math.max(canvasH, 8),
                    pdfX:          item.transform[4],
                    pdfY_baseline: item.transform[5],
                    pdfFontSize:   Math.abs(item.height) || 12
                });
            }
            S.pageTextItems[i - 1] = items;

            const wrapper = document.createElement('div');
            wrapper.className = 'page-wrapper';
            wrapper.dataset.pageIndex = i - 1;

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            canvas.width  = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

            const drawCanvas = document.createElement('canvas');
            drawCanvas.className = 'draw-canvas';
            drawCanvas.width  = viewport.width;
            drawCanvas.height = viewport.height;
            drawCanvas.dataset.pageIndex = i - 1;
            S.activeDrawCanvases[i - 1] = drawCanvas;

            const overlay = document.createElement('div');
            overlay.className = 'annotation-overlay tool-select';
            overlay.dataset.pageIndex = i - 1;
            overlay.dataset.pdfW = (viewport.width / S.scale).toFixed(2);
            overlay.dataset.pdfH = pdfH.toFixed(2);
            overlay.style.width  = viewport.width  + 'px';
            overlay.style.height = viewport.height + 'px';
            overlay.addEventListener('click',     handleOverlayClick);
            overlay.addEventListener('mousedown', handleOverlayMousedown);

            wrapper.appendChild(canvas);
            wrapper.appendChild(drawCanvas);
            wrapper.appendChild(overlay);
            container.appendChild(wrapper);

            const lbl = document.createElement('div');
            lbl.className   = 'page-label';
            lbl.textContent = `หน้า ${i} / ${S.pdfDoc.numPages}`;
            container.appendChild(lbl);
        }

        updateOverlayCursors();
        rerenderAnnotations();

        if (S.tool === 'edittext') activateEditTextMode();

    } catch (err) {
        alert('โหลด PDF ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

function rerenderAnnotations() {
    document.querySelectorAll('[data-ann-id]').forEach(el => el.remove());
    for (const ann of S.annotations) {
        if (ann._bakedToCanvas) {
            const pdfH = S.pagePdfHeights[ann.pageIndex];
            ann._parts.forEach(part => paintAnnotationToCanvas(part, pdfH));
            continue;
        }
        const ov = findOverlayForPage(ann.pageIndex);
        if (!ov) continue;
        const pdfH = S.pagePdfHeights[ann.pageIndex] || parseFloat(ov.dataset.pdfH);
        const { elX, elY } = pdfCoordsToEl(ann, pdfH);
        renderAnnotationElement(ov, ann, elX, elY, pdfH);
    }
}

function findOverlayForPage(pageIndex) {
    return [...document.querySelectorAll('.annotation-overlay')].find(
        ov => parseInt(ov.dataset.pageIndex) === pageIndex
    );
}

function getPageCanvas(pageIndex) {
    const w = document.querySelector(`.page-wrapper[data-page-index="${pageIndex}"]`);
    return w ? w.querySelector('.pdf-canvas') : null;
}

function saveCanvasSnapshot(pageIndex) {
    const c = getPageCanvas(pageIndex);
    return c ? c.toDataURL() : null;
}

function restoreCanvasSnapshot(pageIndex, snapshot) {
    if (!snapshot) return;
    const c = getPageCanvas(pageIndex);
    if (!c) return;
    const img = new Image();
    img.onload = () => c.getContext('2d').drawImage(img, 0, 0);
    img.src = snapshot;
}

function paintAnnotationToCanvas(ann, pdfH) {
    const c = getPageCanvas(ann.pageIndex);
    if (!c) return;
    const ctx = c.getContext('2d');
    pdfH = pdfH || S.pagePdfHeights[ann.pageIndex];
    if (ann.type === 'whiteout') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(
            ann.pdfX * S.scale,
            (pdfH - ann.pdfY - ann.pdfHeight) * S.scale,
            ann.pdfWidth * S.scale,
            ann.pdfHeight * S.scale
        );
    } else if (ann.type === 'text') {
        ctx.fillStyle = ann.color || '#000000';
        const fam    = fontFamilyCSS(ann.fontFamily || 'helvetica');
        const style  = `${ann.italic ? 'italic ' : ''}${ann.bold ? 'bold ' : ''}${ann.fontSize * S.scale}px ${fam}`;
        ctx.font = style;
        const tx = ann.pdfX * S.scale;
        const ty = (pdfH - ann.pdfY) * S.scale;
        ctx.fillText(ann.text, tx, ty);
        if (ann.underline) {
            const tw = ctx.measureText(ann.text).width;
            ctx.strokeStyle = ann.color || '#000000';
            ctx.lineWidth   = Math.max(0.5, ann.fontSize * S.scale * 0.06);
            ctx.beginPath();
            ctx.moveTo(tx, ty + 2);
            ctx.lineTo(tx + tw, ty + 2);
            ctx.stroke();
        }
    }
}

function pdfCoordsToEl(ann, pdfH) {
    if (ann.type === 'text') {
        const pxSize = ann.fontSize * S.scale;
        return { elX: ann.pdfX * S.scale, elY: (pdfH - ann.pdfY) * S.scale - pxSize };
    } else if (ann.type === 'shape' && ann.subtype === 'line') {
        const x1 = ann.pdfX  * S.scale;
        const y1 = (pdfH - ann.pdfY)  * S.scale;
        const x2 = ann.pdfX2 * S.scale;
        const y2 = (pdfH - ann.pdfY2) * S.scale;
        return { elX: Math.min(x1, x2), elY: Math.min(y1, y2) };
    } else {
        const elX = ann.pdfX * S.scale;
        const elY = (pdfH - ann.pdfY - ann.pdfHeight) * S.scale;
        return { elX, elY };
    }
}

function setupToolbar() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => activateTool(btn.dataset.tool));
    });
    document.querySelectorAll('.shape-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.shape-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.shapeSubtype = btn.dataset.shape;
        });
    });
}

function activateTool(tool) {
    if (tool === 'merge')    { openMerge();    return; }
    if (tool === 'img2pdf')  { openImg2Pdf();  return; }
    if (tool === 'compress') { doCompress();   return; }

    const prevTool = S.tool;
    if (prevTool === 'edittext' && tool !== 'edittext') deactivateEditTextMode();

    S.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    const panelMap = {
        select: 'select', text: 'text', signature: 'signature', stamp: 'stamp',
        whiteout: 'whiteout', watermark: 'watermark', forms: 'forms', split: 'split',
        highlight: 'highlight', draw: 'draw', shape: 'shape',
        pagemgr: 'pagemgr', headfoot: 'headfoot', edittext: 'edittext'
    };
    const pId   = panelMap[tool] || 'select';
    const panel = document.getElementById('panel-' + pId);
    if (panel) panel.classList.add('active');

    showWordToolbar(tool === 'text' || tool === 'edittext');
    updateOverlayCursors();

    if (tool === 'edittext') activateEditTextMode();
}

function updateOverlayCursors() {
    document.querySelectorAll('.annotation-overlay').forEach(ov => {
        ov.className = `annotation-overlay tool-${S.tool}`;
        ov.style.pointerEvents = S.tool === 'draw' ? 'none' : '';
    });
    document.querySelectorAll('.draw-canvas').forEach(dc => {
        if (S.tool === 'draw') {
            dc.style.pointerEvents = 'auto';
            dc.style.cursor = 'crosshair';
        } else {
            dc.style.pointerEvents = 'none';
            dc.style.cursor = '';
        }
    });
}

function activateEditTextMode() {
    deactivateEditTextMode();
    document.querySelectorAll('.annotation-overlay').forEach(ov => {
        const pageIndex = parseInt(ov.dataset.pageIndex);
        const items     = S.pageTextItems[pageIndex] || [];
        if (items.length === 0) return;

        const layer = document.createElement('div');
        layer.className = 'text-edit-layer';
        layer.style.width  = ov.style.width;
        layer.style.height = ov.style.height;

        items.forEach((item, idx) => {
            const span = document.createElement('div');
            span.className = 'text-edit-span';
            span.style.left   = item.canvasX + 'px';
            span.style.top    = item.canvasY + 'px';
            span.style.width  = item.canvasW + 'px';
            span.style.height = item.canvasH + 'px';
            span.title        = item.str;
            span.dataset.idx  = idx;

            span.addEventListener('click', e => {
                e.stopPropagation();
                openTextEditInput(ov, layer, item, pageIndex);
            });
            layer.appendChild(span);
        });

        ov.appendChild(layer);
    });
}

function openTextEditInput(ov, layer, item, pageIndex) {
    const existing = ov.querySelector('.text-edit-input-wrap');
    if (existing) existing.remove();

    const fmt    = getFmt();
    const fmtSz  = fmt.size || item.pdfFontSize;
    const pxSize = fmtSz * S.scale;
    const family = fontFamilyCSS(fmt.font);

    const wrap = document.createElement('div');
    wrap.className = 'text-edit-input-wrap';
    wrap.style.left  = item.canvasX + 'px';
    wrap.style.top   = item.canvasY + 'px';
    wrap.style.width = Math.max(item.canvasW, 80) + 'px';

    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.value       = item.str;
    inp.className   = 'text-edit-input';
    inp.style.fontSize   = pxSize + 'px';
    inp.style.fontFamily = family;
    inp.style.fontWeight = fmt.bold   ? 'bold'   : 'normal';
    inp.style.fontStyle  = fmt.italic ? 'italic' : 'normal';
    inp.style.textDecoration = fmt.underline ? 'underline' : 'none';
    inp.style.color = fmt.color !== '#000000' ? fmt.color : '#000';

    wrap.appendChild(inp);
    ov.appendChild(wrap);
    inp.focus();
    inp.select();

    const commit = () => {
        const newText = inp.value;
        wrap.remove();
        if (newText === item.str || newText === '') return;

        const pdfH     = S.pagePdfHeights[pageIndex] || parseFloat(ov.dataset.pdfH);
        const pdfW     = item.canvasW / S.scale;
        const snapshot = saveCanvasSnapshot(pageIndex);

        const woAnn = {
            type: 'whiteout', pageIndex,
            pdfX:      item.pdfX - 1,
            pdfY:      item.pdfY_baseline - item.pdfFontSize * 0.25,
            pdfWidth:  pdfW + 2,
            pdfHeight: item.pdfFontSize * 1.3
        };
        const txAnn = {
            type: 'text', pageIndex,
            pdfX:      item.pdfX,
            pdfY:      item.pdfY_baseline,
            text:      newText,
            fontSize:  Math.round(fmtSz),
            color:     fmt.color,
            bold:      fmt.bold,
            italic:    fmt.italic,
            underline: fmt.underline,
            fontFamily: fmt.font
        };

        paintAnnotationToCanvas(woAnn, pdfH);
        paintAnnotationToCanvas(txAnn, pdfH);

        const groupAnn = {
            id: S.nextId++,
            type: 'edittext-group',
            pageIndex,
            _parts: [woAnn, txAnn],
            _snapshot: snapshot,
            _bakedToCanvas: true
        };
        S.annotations.push(groupAnn);
        S.redoStack = [];
        updateAnnotationList();
    };

    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { wrap.remove(); }
    });
    inp.addEventListener('blur', commit);
}

function deactivateEditTextMode() {
    document.querySelectorAll('.text-edit-layer').forEach(el => el.remove());
    document.querySelectorAll('.text-edit-input-wrap').forEach(el => el.remove());
}

function openNearestTextEdit(ov, pageIndex, cx, cy) {
    const items = S.pageTextItems[pageIndex] || [];
    if (items.length === 0) return;
    let nearest = null, minDist = Infinity;
    for (const item of items) {
        const centerX = item.canvasX + item.canvasW / 2;
        const centerY = item.canvasY + item.canvasH / 2;
        const dist = Math.hypot(cx - centerX, cy - centerY);
        if (dist < minDist) { minDist = dist; nearest = item; }
    }
    if (!nearest || minDist > 300) return;
    const layer = ov.querySelector('.text-edit-layer');
    openTextEditInput(ov, layer, nearest, pageIndex);
}

function openCombinedTextEdit(ov, items, pageIndex) {
    items.sort((a, b) => a.canvasY !== b.canvasY ? a.canvasY - b.canvasY : a.canvasX - b.canvasX);
    const combinedText = items.map(i => i.str).join(' ');
    const left   = Math.min(...items.map(i => i.canvasX));
    const top    = Math.min(...items.map(i => i.canvasY));
    const right  = Math.max(...items.map(i => i.canvasX + i.canvasW));
    const first  = items[0];

    const existing = ov.querySelector('.text-edit-input-wrap');
    if (existing) existing.remove();

    const fmt    = getFmt();
    const fmtSz  = fmt.size || first.pdfFontSize;
    const family = fontFamilyCSS(fmt.font);

    const wrap = document.createElement('div');
    wrap.className     = 'text-edit-input-wrap';
    wrap.style.left    = left + 'px';
    wrap.style.top     = top + 'px';
    wrap.style.width   = Math.max(right - left, 120) + 'px';

    const inp = document.createElement('input');
    inp.type      = 'text';
    inp.value     = combinedText;
    inp.className = 'text-edit-input';
    inp.style.fontSize   = (fmtSz * S.scale) + 'px';
    inp.style.fontFamily = family;
    inp.style.fontWeight = fmt.bold   ? 'bold'   : 'normal';
    inp.style.fontStyle  = fmt.italic ? 'italic' : 'normal';
    inp.style.textDecoration = fmt.underline ? 'underline' : 'none';
    inp.style.color = fmt.color !== '#000000' ? fmt.color : '#000';

    wrap.appendChild(inp);
    ov.appendChild(wrap);
    inp.focus();
    inp.select();

    const commit = () => {
        const newText = inp.value;
        wrap.remove();
        if (newText === combinedText || newText === '') return;
        const pdfH     = S.pagePdfHeights[pageIndex] || parseFloat(ov.dataset.pdfH);
        const snapshot = saveCanvasSnapshot(pageIndex);
        const parts    = [];
        for (const item of items) {
            const wo = {
                type: 'whiteout', pageIndex,
                pdfX:      item.pdfX - 1,
                pdfY:      item.pdfY_baseline - item.pdfFontSize * 0.25,
                pdfWidth:  item.canvasW / S.scale + 2,
                pdfHeight: item.pdfFontSize * 1.3
            };
            parts.push(wo);
            paintAnnotationToCanvas(wo, pdfH);
        }
        const tx = {
            type: 'text', pageIndex,
            pdfX: first.pdfX, pdfY: first.pdfY_baseline,
            text: newText,
            fontSize: Math.round(fmtSz),
            color:     fmt.color,
            bold:      fmt.bold,
            italic:    fmt.italic,
            underline: fmt.underline,
            fontFamily: fmt.font
        };
        parts.push(tx);
        paintAnnotationToCanvas(tx, pdfH);
        S.annotations.push({ id: S.nextId++, type: 'edittext-group', pageIndex, _parts: parts, _snapshot: snapshot, _bakedToCanvas: true });
        S.redoStack = [];
        updateAnnotationList();
    };
    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { wrap.remove(); }
    });
    inp.addEventListener('blur', commit);
}

function handleOverlayMousedown(e) {
    if (S.tool === 'edittext') {
        if (e.target.classList.contains('text-edit-span')) return;
        e.stopPropagation();
        const ov = e.currentTarget;
        const rect = ov.getBoundingClientRect();
        S.editTextDrag = {
            startX: e.clientX - rect.left,
            startY: e.clientY - rect.top,
            ov, pageIndex: parseInt(ov.dataset.pageIndex),
            preview: null, moved: false
        };
        return;
    }
    const isRectDraw = S.tool === 'whiteout' || S.tool === 'highlight' ||
        (S.tool === 'shape' && (S.shapeSubtype === 'rect' || S.shapeSubtype === 'ellipse'));

    if (!isRectDraw) return;
    e.stopPropagation();

    const ov    = e.currentTarget;
    const rect  = ov.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    let previewClass = 'annot-whiteout-preview';
    if (S.tool === 'highlight') previewClass = 'annot-highlight-preview';
    else if (S.tool === 'shape') previewClass = 'annot-shape-preview';

    const preview = document.createElement('div');
    preview.className = previewClass;

    if (S.tool === 'highlight') {
        const col = document.getElementById('hl-color').value;
        const op  = parseInt(document.getElementById('hl-opacity').value) / 100;
        preview.style.background = hexToRgbaCSS(col, op);
    } else if (S.tool === 'shape') {
        const col = document.getElementById('shape-color').value;
        const bw  = parseInt(document.getElementById('shape-border').value) || 2;
        preview.style.border     = `${bw}px dashed ${col}`;
        preview.style.background = 'transparent';
        if (S.shapeSubtype === 'ellipse') preview.style.borderRadius = '50%';
    }
    preview.style.left   = startX + 'px';
    preview.style.top    = startY + 'px';
    preview.style.width  = '0';
    preview.style.height = '0';
    ov.appendChild(preview);

    S.drawingRect = { startX, startY, preview, ov, pageIndex: parseInt(ov.dataset.pageIndex) };
}

function handleOverlayClick(e) {
    if (S.tool === 'whiteout' || S.tool === 'highlight' || S.tool === 'shape') return;
    if (S.tool === 'edittext') {
        if (S._suppressEditClick) { S._suppressEditClick = false; return; }
        if (e.target.classList.contains('text-edit-span')) return;
        if (S.dragging) return;
        const ov        = e.currentTarget;
        const rect      = ov.getBoundingClientRect();
        const cx        = e.clientX - rect.left;
        const cy        = e.clientY - rect.top;
        const pageIndex = parseInt(ov.dataset.pageIndex);
        openNearestTextEdit(ov, pageIndex, cx, cy);
        return;
    }
    if (S.dragging) return;
    const ov        = e.currentTarget;
    const rect      = ov.getBoundingClientRect();
    const cx        = e.clientX - rect.left;
    const cy        = e.clientY - rect.top;
    const pageIndex = parseInt(ov.dataset.pageIndex);
    const pdfH      = parseFloat(ov.dataset.pdfH);
    const pdfX      = cx / S.scale;
    const pdfY      = pdfH - cy / S.scale;

    if (S.tool === 'text') {
        spawnTextInput(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH);
    } else if (S.tool === 'signature') {
        if (S.sigData) placeImage(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH, S.sigData, 'signature');
        else activateTool('signature');
    } else if (S.tool === 'stamp') {
        if (S.stampData) placeImage(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH, S.stampData, 'stamp');
        else activateTool('stamp');
    }
}

function spawnTextInput(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH) {
    const fmt    = getFmt();
    const pxSize = fmt.size * S.scale;
    const family = fontFamilyCSS(fmt.font);

    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.className   = 'text-input-el';
    inp.style.left  = cx + 'px';
    inp.style.top   = (cy - pxSize) + 'px';
    inp.style.fontSize   = pxSize + 'px';
    inp.style.fontFamily = family;
    inp.style.fontWeight = fmt.bold   ? 'bold'   : 'normal';
    inp.style.fontStyle  = fmt.italic ? 'italic' : 'normal';
    inp.style.textDecoration = fmt.underline ? 'underline' : 'none';
    inp.style.color = fmt.color;
    inp.placeholder = 'พิมพ์ข้อความ...';

    const commit = () => {
        const txt = inp.value.trim();
        inp.remove();
        if (!txt) return;
        const ann = {
            id: S.nextId++, type: 'text', pageIndex, pdfX, pdfY,
            text: txt, fontSize: fmt.size, color: fmt.color,
            bold: fmt.bold, italic: fmt.italic, underline: fmt.underline,
            fontFamily: fmt.font
        };
        addAnnotation(ann, ov, cx, cy - pxSize, pdfH);
    };

    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  commit();
        else if (e.key === 'Escape') inp.remove();
    });
    inp.addEventListener('blur', commit);
    ov.appendChild(inp);
    inp.focus();
}

function placeImage(ov, cx, cy, pageIndex, pdfX, pdfY, pdfH, imageData, subtype) {
    const stampWidthEl = document.getElementById('stamp-width');
    const stampPtWidth = parseInt(stampWidthEl ? stampWidthEl.value : 150) || 150;
    const img = new Image();
    img.src = imageData;
    img.onload = () => {
        const ratio     = img.naturalHeight / img.naturalWidth;
        const pdfWidth  = stampPtWidth;
        const pdfHeight = pdfWidth * ratio;
        const canvasW   = pdfWidth  * S.scale;
        const canvasH   = pdfHeight * S.scale;
        const imgPdfX   = pdfX - pdfWidth  / 2;
        const imgPdfY   = pdfY - pdfHeight / 2;
        const ann = { id: S.nextId++, type: 'image', subtype, pageIndex, pdfX: imgPdfX, pdfY: imgPdfY, pdfWidth, pdfHeight, imageData };
        addAnnotation(ann, ov, cx - canvasW / 2, cy - canvasH / 2, pdfH);
    };
}

function addAnnotation(ann, ov, elX, elY, pdfH) {
    S.annotations.push(ann);
    S.redoStack = [];
    renderAnnotationElement(ov, ann, elX, elY, pdfH);
    updateAnnotationList();
}

function removeAnnotation(id) {
    const ann = S.annotations.find(a => a.id === id);
    if (!ann) return;
    S.annotations = S.annotations.filter(a => a.id !== id);
    if (ann._bakedToCanvas && ann._snapshot) {
        restoreCanvasSnapshot(ann.pageIndex, ann._snapshot);
    } else {
        document.querySelectorAll(`[data-ann-id="${id}"]`).forEach(el => el.remove());
    }
    updateAnnotationList();
}

function renderAnnotationElement(ov, ann, elX, elY, pdfH) {
    let el;

    if (ann.type === 'text') {
        el = document.createElement('div');
        el.className = 'annot-text';
        el.textContent = ann.text;
        el.style.left        = elX + 'px';
        el.style.top         = elY + 'px';
        el.style.fontSize    = (ann.fontSize * S.scale) + 'px';
        el.style.color       = ann.color;
        el.style.fontFamily  = fontFamilyCSS(ann.fontFamily || 'helvetica');
        el.style.fontWeight  = ann.bold   ? 'bold'   : 'normal';
        el.style.fontStyle   = ann.italic ? 'italic' : 'normal';
        el.style.textDecoration = ann.underline ? 'underline' : 'none';

    } else if (ann.type === 'whiteout') {
        el = document.createElement('div');
        el.className    = 'annot-whiteout';
        el.style.left   = elX + 'px';
        el.style.top    = elY + 'px';
        el.style.width  = (ann.pdfWidth  * S.scale) + 'px';
        el.style.height = (ann.pdfHeight * S.scale) + 'px';

    } else if (ann.type === 'highlight') {
        el = document.createElement('div');
        el.className    = 'annot-highlight';
        el.style.left   = elX + 'px';
        el.style.top    = elY + 'px';
        el.style.width  = (ann.pdfWidth  * S.scale) + 'px';
        el.style.height = (ann.pdfHeight * S.scale) + 'px';
        el.style.background = hexToRgbaCSS(ann.color, ann.opacity);

    } else if (ann.type === 'shape') {
        el = buildShapeSvg(ann, pdfH, elX, elY);

    } else {
        el = document.createElement('img');
        el.className    = 'annot-image';
        el.src          = ann.imageData;
        el.style.left   = elX + 'px';
        el.style.top    = elY + 'px';
        el.style.width  = (ann.pdfWidth  * S.scale) + 'px';
        el.style.height = (ann.pdfHeight * S.scale) + 'px';
    }

    ann._elX  = elX;
    ann._elY  = elY;
    ann._pdfH = pdfH;

    el.dataset.annId = ann.id;
    el.title = 'คลิกขวาเพื่อลบ | ลากเพื่อย้าย';

    el.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        removeAnnotation(ann.id);
    });

    makeDraggable(el, ann, ov, pdfH);
    ov.appendChild(el);
    return el;
}

function buildShapeSvg(ann, pdfH, elX, elY) {
    const w   = ann.pdfWidth  * S.scale;
    const h   = ann.pdfHeight * S.scale;
    const bw  = ann.borderWidth || 2;
    const col = ann.color || '#ff0000';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'annot-shape');
    svg.setAttribute('overflow', 'visible');
    svg.style.position      = 'absolute';
    svg.style.pointerEvents = 'auto';
    svg.style.cursor        = 'move';
    svg.style.overflow      = 'visible';

    if (ann.subtype === 'rect') {
        svg.style.left = elX + 'px';
        svg.style.top  = elY + 'px';
        svg.setAttribute('width',  Math.max(w, 1));
        svg.setAttribute('height', Math.max(h, 1));
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x',      bw / 2);
        rect.setAttribute('y',      bw / 2);
        rect.setAttribute('width',  Math.max(w - bw, 1));
        rect.setAttribute('height', Math.max(h - bw, 1));
        rect.setAttribute('fill',         'none');
        rect.setAttribute('stroke',       col);
        rect.setAttribute('stroke-width', bw);
        svg.appendChild(rect);

    } else if (ann.subtype === 'ellipse') {
        svg.style.left = elX + 'px';
        svg.style.top  = elY + 'px';
        svg.setAttribute('width',  Math.max(w, 1));
        svg.setAttribute('height', Math.max(h, 1));
        const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        ellipse.setAttribute('cx',           w / 2);
        ellipse.setAttribute('cy',           h / 2);
        ellipse.setAttribute('rx',           Math.max(w / 2 - bw / 2, 1));
        ellipse.setAttribute('ry',           Math.max(h / 2 - bw / 2, 1));
        ellipse.setAttribute('fill',         'none');
        ellipse.setAttribute('stroke',       col);
        ellipse.setAttribute('stroke-width', bw);
        svg.appendChild(ellipse);

    } else if (ann.subtype === 'line') {
        const x1   = ann.pdfX  * S.scale;
        const y1   = (pdfH - ann.pdfY)  * S.scale;
        const x2   = ann.pdfX2 * S.scale;
        const y2   = (pdfH - ann.pdfY2) * S.scale;
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);
        const maxX = Math.max(x1, x2);
        const maxY = Math.max(y1, y2);
        const svgW = Math.max(maxX - minX, 1);
        const svgH = Math.max(maxY - minY, 1);
        svg.style.left = minX + 'px';
        svg.style.top  = minY + 'px';
        svg.setAttribute('width',  svgW);
        svg.setAttribute('height', svgH);
        ann._lineMinX = minX;
        ann._lineMinY = minY;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1',           x1 - minX);
        line.setAttribute('y1',           y1 - minY);
        line.setAttribute('x2',           x2 - minX);
        line.setAttribute('y2',           y2 - minY);
        line.setAttribute('stroke',       col);
        line.setAttribute('stroke-width', bw);
        svg.appendChild(line);
    }

    return svg;
}

function makeDraggable(el, ann, ov, pdfH) {
    el.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (ann.type === 'shape' && ann.subtype === 'line') {
            ann._lineOrigPdfX  = ann.pdfX;
            ann._lineOrigPdfY  = ann.pdfY;
            ann._lineOrigPdfX2 = ann.pdfX2;
            ann._lineOrigPdfY2 = ann.pdfY2;
        }
        S.dragging = {
            el, ann, ov, pdfH,
            startX:   e.clientX,
            startY:   e.clientY,
            origLeft: parseFloat(el.style.left),
            origTop:  parseFloat(el.style.top)
        };
    });
}

function setupDragMove() {
    document.addEventListener('mousemove', e => {
        if (S.editTextDrag) {
            const { startX, startY, ov } = S.editTextDrag;
            const rect = ov.getBoundingClientRect();
            const curX = e.clientX - rect.left;
            const curY = e.clientY - rect.top;
            const dist = Math.hypot(curX - startX, curY - startY);
            if (dist > 6) {
                S.editTextDrag.moved = true;
                if (!S.editTextDrag.preview) {
                    const p = document.createElement('div');
                    p.className = 'edittext-selection-preview';
                    ov.appendChild(p);
                    S.editTextDrag.preview = p;
                }
                const p = S.editTextDrag.preview;
                p.style.left   = Math.min(startX, curX) + 'px';
                p.style.top    = Math.min(startY, curY) + 'px';
                p.style.width  = Math.abs(curX - startX) + 'px';
                p.style.height = Math.abs(curY - startY) + 'px';
            }
        }

        if (S.drawingRect) {
            const { startX, startY, preview, ov } = S.drawingRect;
            const rect = ov.getBoundingClientRect();
            const curX = e.clientX - rect.left;
            const curY = e.clientY - rect.top;
            preview.style.left   = Math.min(startX, curX) + 'px';
            preview.style.top    = Math.min(startY, curY) + 'px';
            preview.style.width  = Math.abs(curX - startX) + 'px';
            preview.style.height = Math.abs(curY - startY) + 'px';
        }

        if (!S.dragging) return;
        const { el, ann, ov, pdfH, startX, startY, origLeft, origTop } = S.dragging;
        const dx      = e.clientX - startX;
        const dy      = e.clientY - startY;
        const newLeft = origLeft + dx;
        const newTop  = origTop  + dy;
        el.style.left = newLeft + 'px';
        el.style.top  = newTop  + 'px';

        if (ann.type === 'text') {
            const pxSize = ann.fontSize * S.scale;
            ann.pdfX = newLeft / S.scale;
            ann.pdfY = pdfH - (newTop + pxSize) / S.scale;
        } else if (ann.type === 'shape' && ann.subtype === 'line') {
            const shiftX  = dx / S.scale;
            const shiftY  = -dy / S.scale;
            ann.pdfX  = (ann._lineOrigPdfX  || ann.pdfX)  + shiftX;
            ann.pdfY  = (ann._lineOrigPdfY  || ann.pdfY)  + shiftY;
            ann.pdfX2 = (ann._lineOrigPdfX2 || ann.pdfX2) + shiftX;
            ann.pdfY2 = (ann._lineOrigPdfY2 || ann.pdfY2) + shiftY;
        } else {
            ann.pdfX = newLeft / S.scale;
            ann.pdfY = pdfH - (newTop + (ann.pdfHeight * S.scale)) / S.scale;
        }

        ann._elX = newLeft;
        ann._elY = newTop;
    });

    document.addEventListener('mouseup', e => {
        if (S.editTextDrag) {
            const { startX, startY, ov, pageIndex, preview, moved } = S.editTextDrag;
            S.editTextDrag = null;
            if (preview) preview.remove();
            if (!moved) return; // let click fire for single click
            // Drag selection
            const selLeft   = parseFloat(preview ? preview.style.left   : startX);
            const selTop    = parseFloat(preview ? preview.style.top    : startY);
            const selW      = parseFloat(preview ? preview.style.width  : 0);
            const selH      = parseFloat(preview ? preview.style.height : 0);
            if (selW < 4 || selH < 4) return;
            const items = (S.pageTextItems[pageIndex] || []).filter(item => {
                const iR = item.canvasX + item.canvasW, iB = item.canvasY + item.canvasH;
                return item.canvasX < selLeft + selW && iR > selLeft &&
                       item.canvasY < selTop  + selH && iB > selTop;
            });
            if (items.length === 0) return;
            S._suppressEditClick = true;
            setTimeout(() => { S._suppressEditClick = false; }, 0);
            if (items.length === 1) {
                const layer = ov.querySelector('.text-edit-layer');
                openTextEditInput(ov, layer, items[0], pageIndex);
            } else {
                openCombinedTextEdit(ov, items, pageIndex);
            }
        }

        if (S.drawingRect) {
            const { preview, ov, pageIndex } = S.drawingRect;
            S.drawingRect = null;
            const elLeft = parseFloat(preview.style.left);
            const elTop  = parseFloat(preview.style.top);
            const elW    = parseFloat(preview.style.width);
            const elH    = parseFloat(preview.style.height);
            preview.remove();

            if (elW < 4 || elH < 4) return;
            const pdfH = parseFloat(ov.dataset.pdfH);

            if (S.tool === 'whiteout') {
                const ann = {
                    id: S.nextId++, type: 'whiteout', pageIndex,
                    pdfX:      elLeft / S.scale,
                    pdfY:      pdfH - (elTop + elH) / S.scale,
                    pdfWidth:  elW / S.scale,
                    pdfHeight: elH / S.scale
                };
                addAnnotation(ann, ov, elLeft, elTop, pdfH);

            } else if (S.tool === 'highlight') {
                const col = document.getElementById('hl-color').value;
                const op  = parseInt(document.getElementById('hl-opacity').value) / 100;
                const ann = {
                    id: S.nextId++, type: 'highlight', pageIndex,
                    pdfX:      elLeft / S.scale,
                    pdfY:      pdfH - (elTop + elH) / S.scale,
                    pdfWidth:  elW / S.scale,
                    pdfHeight: elH / S.scale,
                    color: col, opacity: op
                };
                addAnnotation(ann, ov, elLeft, elTop, pdfH);

            } else if (S.tool === 'shape' && S.shapeSubtype !== 'line') {
                const col = document.getElementById('shape-color').value;
                const bw  = parseInt(document.getElementById('shape-border').value) || 2;
                const ann = {
                    id: S.nextId++, type: 'shape', subtype: S.shapeSubtype, pageIndex,
                    pdfX:      elLeft / S.scale,
                    pdfY:      pdfH - (elTop + elH) / S.scale,
                    pdfWidth:  elW / S.scale,
                    pdfHeight: elH / S.scale,
                    color: col, borderWidth: bw
                };
                ann._elX  = elLeft;
                ann._elY  = elTop;
                ann._pdfH = pdfH;
                addAnnotation(ann, ov, elLeft, elTop, pdfH);
            }
        }

        if (S.drawingLine) {
            const { startX, startY, endX, endY, ov, pageIndex } = S.drawingLine;
            S.drawingLine = null;
            const preview = ov.querySelector('.line-preview');
            if (preview) preview.remove();

            if (Math.abs(endX - startX) < 4 && Math.abs(endY - startY) < 4) return;

            const pdfH = parseFloat(ov.dataset.pdfH);
            const x1   = Math.min(startX, endX);
            const y1   = Math.min(startY, endY);
            const col  = document.getElementById('shape-color').value;
            const bw   = parseInt(document.getElementById('shape-border').value) || 2;
            const ann  = {
                id: S.nextId++, type: 'shape', subtype: 'line', pageIndex,
                pdfX:  startX / S.scale,
                pdfY:  pdfH - startY / S.scale,
                pdfX2: endX / S.scale,
                pdfY2: pdfH - endY / S.scale,
                color: col, borderWidth: bw
            };
            ann._pdfH = pdfH;
            addAnnotation(ann, ov, x1, y1, pdfH);
        }

        if (S.dragging) {
            const { ann } = S.dragging;
            delete ann._lineOrigPdfX;
            delete ann._lineOrigPdfY;
            delete ann._lineOrigPdfX2;
            delete ann._lineOrigPdfY2;
            S.dragging = null;
        }
    });
}

document.addEventListener('mousedown', e => {
    if (S.tool !== 'shape' || S.shapeSubtype !== 'line') return;
    const ov = e.target.closest && e.target.closest('.annotation-overlay');
    if (!ov) return;
    e.stopPropagation();
    const rect   = ov.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const preview = document.createElement('div');
    preview.className = 'annot-shape-preview line-preview';
    preview.style.left   = startX + 'px';
    preview.style.top    = startY + 'px';
    preview.style.width  = '0';
    preview.style.height = '0';
    const col = document.getElementById('shape-color').value;
    preview.style.borderTop = `2px dashed ${col}`;
    ov.appendChild(preview);
    S.drawingLine = { startX, startY, endX: startX, endY: startY, ov, pageIndex: parseInt(ov.dataset.pageIndex) };
}, true);

document.addEventListener('mousemove', e => {
    if (!S.drawingLine) return;
    const { ov } = S.drawingLine;
    const rect = ov.getBoundingClientRect();
    S.drawingLine.endX = e.clientX - rect.left;
    S.drawingLine.endY = e.clientY - rect.top;
    const preview = ov.querySelector('.line-preview');
    if (preview) {
        const { startX, startY, endX, endY } = S.drawingLine;
        const len   = Math.hypot(endX - startX, endY - startY);
        const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;
        preview.style.left            = startX + 'px';
        preview.style.top             = startY + 'px';
        preview.style.width           = len + 'px';
        preview.style.height          = '0';
        preview.style.transform       = `rotate(${angle}deg)`;
        preview.style.transformOrigin = '0 0';
    }
});

function setupUndoRedo() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.addEventListener('click', undo);
    if (btnRedo) btnRedo.addEventListener('click', redo);

    document.addEventListener('keydown', e => {
        if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
        if (e.ctrlKey && e.shiftKey && e.key === 'Z') { e.preventDefault(); redo(); }
    });
}

function undo() {
    if (S.annotations.length === 0) return;
    const ann = S.annotations.pop();
    S.redoStack.push(ann);
    if (ann._bakedToCanvas) {
        restoreCanvasSnapshot(ann.pageIndex, ann._snapshot);
    } else {
        document.querySelectorAll(`[data-ann-id="${ann.id}"]`).forEach(el => el.remove());
    }
    updateAnnotationList();
}

function redo() {
    if (S.redoStack.length === 0) return;
    const ann = S.redoStack.pop();
    S.annotations.push(ann);
    if (ann._bakedToCanvas) {
        const pdfH = S.pagePdfHeights[ann.pageIndex];
        ann._parts.forEach(part => paintAnnotationToCanvas(part, pdfH));
    } else {
        const ov = findOverlayForPage(ann.pageIndex);
        if (ov) {
            const pdfH = S.pagePdfHeights[ann.pageIndex] || parseFloat(ov.dataset.pdfH);
            const { elX, elY } = pdfCoordsToEl(ann, pdfH);
            renderAnnotationElement(ov, ann, elX, elY, pdfH);
        }
    }
    updateAnnotationList();
}

function setupZoom() {
    const btnIn  = document.getElementById('btn-zoom-in');
    const btnOut = document.getElementById('btn-zoom-out');
    if (btnIn)  btnIn.addEventListener('click',  () => changeZoom(1));
    if (btnOut) btnOut.addEventListener('click', () => changeZoom(-1));
}

async function changeZoom(delta) {
    const newIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, S.zoomIndex + delta));
    if (newIdx === S.zoomIndex) return;
    S.zoomIndex = newIdx;
    const zlEl = document.getElementById('zoom-label');
    if (zlEl) zlEl.textContent = ZOOM_LEVELS[newIdx] + '%';
    await renderPdf();
}

function setupDraw() {
    const drawClear = document.getElementById('draw-clear');
    const drawSave  = document.getElementById('draw-save');

    if (drawClear) {
        drawClear.addEventListener('click', () => {
            Object.values(S.activeDrawCanvases).forEach(dc => {
                dc.getContext('2d').clearRect(0, 0, dc.width, dc.height);
            });
        });
    }

    if (drawSave) {
        drawSave.addEventListener('click', () => {
            Object.entries(S.activeDrawCanvases).forEach(([pageIdxStr, dc]) => {
                const ctx    = dc.getContext('2d');
                const pixels = ctx.getImageData(0, 0, dc.width, dc.height).data;
                const hasContent = pixels.some(v => v !== 0);
                if (!hasContent) return;

                const pageIndex = parseInt(pageIdxStr);
                const imageData = dc.toDataURL('image/png');
                const pdfH      = S.pagePdfHeights[pageIndex] || 0;
                const ov        = findOverlayForPage(pageIndex);
                if (!ov) return;

                const ann = {
                    id: S.nextId++, type: 'image', subtype: 'draw', pageIndex,
                    pdfX: 0, pdfY: 0,
                    pdfWidth:  dc.width  / S.scale,
                    pdfHeight: dc.height / S.scale,
                    imageData
                };
                addAnnotation(ann, ov, 0, 0, pdfH);
                ctx.clearRect(0, 0, dc.width, dc.height);
            });
        });
    }

    document.addEventListener('mousedown', e => {
        if (S.tool !== 'draw') return;
        const dc = e.target.closest && e.target.closest('.draw-canvas');
        if (!dc) return;
        const ctx   = dc.getContext('2d');
        const r     = dc.getBoundingClientRect();
        const scaleX = dc.width  / r.width;
        const scaleY = dc.height / r.height;
        const col   = document.getElementById('draw-color').value;
        const lw    = parseInt(document.getElementById('draw-width').value) || 3;
        ctx.strokeStyle = col;
        ctx.lineWidth   = lw;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        ctx.moveTo((e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY);
        S._drawCtx = { ctx, dc, scaleX, scaleY, active: true };
    });

    document.addEventListener('mousemove', e => {
        if (!S._drawCtx || !S._drawCtx.active) return;
        const { ctx, dc, scaleX, scaleY } = S._drawCtx;
        const r = dc.getBoundingClientRect();
        ctx.lineTo((e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY);
        ctx.stroke();
    });

    document.addEventListener('mouseup', () => {
        if (S._drawCtx) { S._drawCtx.active = false; S._drawCtx = null; }
    });
}

function setupHighlightOpacity() {
    const slider = document.getElementById('hl-opacity');
    const label  = document.getElementById('hl-opacity-val');
    if (slider && label) {
        label.textContent = slider.value + '%';
        slider.addEventListener('input', () => { label.textContent = slider.value + '%'; });
    }
}

function updateAnnotationList() {
    const list = document.getElementById('annotation-list');
    if (!list) return;
    if (S.annotations.length === 0) {
        list.innerHTML = '<p class="empty-hint">ยังไม่มีรายการ<br>เลือกเครื่องมือด้านซ้ายเพื่อเริ่ม</p>';
        return;
    }
    const iconMap = { text: 'T', whiteout: '⬜', highlight: '🖊', image: '🖼', shape: '⬡', 'edittext-group': '✏' };
    const labelMap = ann => {
        if (ann.type === 'edittext-group') {
            const tx = ann._parts.find(p => p.type === 'text');
            return tx ? `แก้: ${tx.text.substring(0, 18)}` : 'แก้ข้อความ';
        }
        if (ann.type === 'text')      return ann.text.substring(0, 20);
        if (ann.type === 'whiteout')  return 'ปิดทับข้อความ';
        if (ann.type === 'highlight') return 'ไฮไลท์';
        if (ann.type === 'shape')     return ann.subtype === 'line' ? 'เส้น' : ann.subtype === 'ellipse' ? 'วงรี' : 'สี่เหลี่ยม';
        if (ann.subtype === 'signature') return 'ลายเซ็น';
        if (ann.subtype === 'draw')   return 'ภาพวาด';
        return 'รูปภาพ';
    };
    list.innerHTML = S.annotations.map(a => `
        <div class="annot-item">
            <span class="annot-item-icon">${iconMap[a.type] || '🖼'}</span>
            <div class="annot-item-info">
                <div class="annot-item-label">${labelMap(a)}</div>
                <div class="annot-item-meta">หน้า ${a.pageIndex + 1}</div>
            </div>
            <button class="annot-item-del" onclick="removeAnnotation(${a.id})">✕</button>
        </div>
    `).join('');
}

function setupSignaturePad() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    let drawing = false, lx = 0, ly = 0;

    const getPos = e => {
        const r   = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return {
            x: (src.clientX - r.left) * (canvas.width  / r.width),
            y: (src.clientY - r.top)  * (canvas.height / r.height)
        };
    };

    const start = e => { e.preventDefault(); drawing = true; const p = getPos(e); lx = p.x; ly = p.y; };
    const move  = e => {
        e.preventDefault();
        if (!drawing) return;
        const p = getPos(e);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke();
        lx = p.x; ly = p.y;
    };
    const end = () => { drawing = false; };

    canvas.addEventListener('mousedown',  start);
    canvas.addEventListener('mousemove',  move);
    canvas.addEventListener('mouseup',    end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end);

    const sigClear  = document.getElementById('sig-clear');
    const sigUse    = document.getElementById('sig-use');
    const sigStatus = document.getElementById('sig-status');

    if (sigClear) sigClear.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        S.sigData = null;
        if (sigStatus) sigStatus.textContent = '';
    });
    if (sigUse) sigUse.addEventListener('click', () => {
        S.sigData = canvas.toDataURL('image/png');
        if (sigStatus) sigStatus.textContent = '✅ พร้อมใช้ — คลิกบนหน้า PDF เพื่อวาง';
    });
}

function setupStampUpload() {
    const btn = document.getElementById('stamp-upload-btn');
    const fi  = document.getElementById('stamp-file');
    if (!btn || !fi) return;
    btn.addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => {
        const file = fi.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            S.stampData = ev.target.result;
            const preview = document.getElementById('stamp-preview');
            const status  = document.getElementById('stamp-status');
            if (preview) preview.innerHTML = `<img src="${S.stampData}" alt="stamp">`;
            if (status)  status.textContent = '✅ พร้อมใช้ — คลิกบนหน้า PDF เพื่อวาง';
        };
        reader.readAsDataURL(file);
    });
}

function renderFormFields() {
    const container = document.getElementById('form-fields-list');
    if (!container) return;
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

function setupMerge() {
    const modal  = document.getElementById('merge-modal');
    const close  = document.getElementById('merge-close');
    const cancel = document.getElementById('merge-cancel');
    const fi     = document.getElementById('merge-file-input');
    const dz     = document.getElementById('merge-drop');
    const doBtn  = document.getElementById('btn-do-merge');
    if (!modal) return;

    const closeModal = () => {
        modal.style.display = 'none';
        S.mergeFiles = [];
        const ml = document.getElementById('merge-list');
        if (ml) ml.innerHTML = '';
    };

    if (close)  close.addEventListener('click',  closeModal);
    if (cancel) cancel.addEventListener('click', closeModal);
    if (dz && fi) {
        dz.addEventListener('click', () => fi.click());
        fi.addEventListener('change', () => addMergeFiles(fi.files));
        dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop',      e => { e.preventDefault(); dz.classList.remove('drag-over'); addMergeFiles(e.dataTransfer.files); });
    }
    if (doBtn) doBtn.addEventListener('click', doMerge);
}

function addMergeFiles(files) {
    for (const f of files) { if (f.name.toLowerCase().endsWith('.pdf')) S.mergeFiles.push(f); }
    renderMergeList();
}

function renderMergeList() {
    const list = document.getElementById('merge-list');
    if (!list) return;
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
    const ml = document.getElementById('merge-list');
    if (ml) ml.innerHTML = '';
    const modal = document.getElementById('merge-modal');
    if (modal) modal.style.display = 'flex';
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
}

async function doMerge() {
    if (S.mergeFiles.length < 2) { alert('กรุณาเลือกอย่างน้อย 2 ไฟล์'); return; }
    showLoading('กำลังรวม PDF...');
    try {
        const fd = new FormData();
        S.mergeFiles.forEach(f => fd.append('pdfs', f));
        const res  = await fetch('/api/merge', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        triggerDownload(`/api/download/${data.outputId}`, 'merged.pdf');
        const modal = document.getElementById('merge-modal');
        if (modal) modal.style.display = 'none';
        S.mergeFiles = [];
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

function setupImg2Pdf() {
    const modal  = document.getElementById('img2pdf-modal');
    const close  = document.getElementById('img2pdf-close');
    const cancel = document.getElementById('img2pdf-cancel');
    const fi     = document.getElementById('img2pdf-file-input');
    const dz     = document.getElementById('img2pdf-drop');
    const doBtn  = document.getElementById('btn-do-img2pdf');
    if (!modal) return;

    const closeModal = () => {
        modal.style.display = 'none';
        S.img2pdfFiles = [];
        const il = document.getElementById('img2pdf-list');
        if (il) il.innerHTML = '';
    };

    if (close)  close.addEventListener('click',  closeModal);
    if (cancel) cancel.addEventListener('click', closeModal);
    if (dz && fi) {
        dz.addEventListener('click', () => fi.click());
        fi.addEventListener('change', () => addImg2PdfFiles(fi.files));
        dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop',      e => { e.preventDefault(); dz.classList.remove('drag-over'); addImg2PdfFiles(e.dataTransfer.files); });
    }
    if (doBtn) doBtn.addEventListener('click', doImg2Pdf);
}

function addImg2PdfFiles(files) {
    for (const f of files) {
        if (f.type === 'image/jpeg' || f.type === 'image/png') {
            if (S.img2pdfFiles.length < 30) S.img2pdfFiles.push(f);
        }
    }
    renderImg2PdfList();
}

function renderImg2PdfList() {
    const list = document.getElementById('img2pdf-list');
    if (!list) return;
    if (S.img2pdfFiles.length === 0) { list.innerHTML = ''; return; }
    list.innerHTML = S.img2pdfFiles.map((f, i) =>
        `<div class="merge-item">
            <span>🖼</span>
            <span class="merge-item-name">${f.name}</span>
            <button class="annot-item-del" onclick="S.img2pdfFiles.splice(${i},1);renderImg2PdfList()">✕</button>
        </div>`
    ).join('');
}

function openImg2Pdf() {
    S.img2pdfFiles = [];
    const il = document.getElementById('img2pdf-list');
    if (il) il.innerHTML = '';
    const modal = document.getElementById('img2pdf-modal');
    if (modal) modal.style.display = 'flex';
}

async function doImg2Pdf() {
    if (S.img2pdfFiles.length === 0) { alert('กรุณาเลือกรูปภาพ'); return; }
    showLoading('กำลังสร้าง PDF...');
    try {
        const fd = new FormData();
        S.img2pdfFiles.forEach(f => fd.append('images', f));
        const res  = await fetch('/api/image-to-pdf', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        triggerDownload(`/api/download/${data.outputId}`, 'images.pdf');
        const modal = document.getElementById('img2pdf-modal');
        if (modal) modal.style.display = 'none';
        S.img2pdfFiles = [];
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

function setupSplit() {
    const addRange  = document.getElementById('add-range');
    const splitRng  = document.getElementById('split-ranges');
    const doSplitBtn = document.getElementById('btn-do-split');

    if (addRange) {
        addRange.addEventListener('click', () => {
            const row = document.createElement('div');
            row.className = 'split-row';
            row.innerHTML = `<input type="text" class="range-input" placeholder="เช่น 4-6"><button class="remove-range">&#10005;</button>`;
            row.querySelector('.remove-range').addEventListener('click', () => row.remove());
            if (splitRng) splitRng.appendChild(row);
        });
    }

    if (splitRng) {
        splitRng.addEventListener('click', e => {
            if (e.target.classList.contains('remove-range')) {
                const rows = document.querySelectorAll('#split-ranges .split-row');
                if (rows.length > 1) e.target.closest('.split-row').remove();
            }
        });
    }

    if (doSplitBtn) doSplitBtn.addEventListener('click', doSplit);
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
        const res  = await fetch('/api/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: S.fileId, pageGroups: groups })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
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

function setupWatermark() {
    const opacityInput = document.getElementById('wm-opacity');
    const opacityVal   = document.getElementById('wm-opacity-val');
    if (opacityInput && opacityVal) {
        opacityVal.textContent = opacityInput.value + '%';
        opacityInput.addEventListener('input', () => { opacityVal.textContent = opacityInput.value + '%'; });
    }

    const doWmBtn = document.getElementById('btn-do-watermark');
    if (doWmBtn) doWmBtn.addEventListener('click', async () => {
        if (!S.fileId) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
        const wmText = document.getElementById('wm-text');
        const text   = wmText ? wmText.value.trim() : '';
        if (!text) { alert('กรุณาใส่ข้อความลายน้ำ'); return; }
        showLoading('กำลังใส่ลายน้ำ...');
        try {
            const res  = await fetch('/api/watermark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileId:   S.fileId,
                    text,
                    fontSize: parseInt(document.getElementById('wm-size').value)     || 60,
                    color:    document.getElementById('wm-color').value,
                    opacity:  parseInt(document.getElementById('wm-opacity').value)  / 100,
                    rotation: parseInt(document.getElementById('wm-rotation').value) || -45
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            triggerDownload(`/api/download/${data.outputId}`, 'watermarked_' + S.originalName);
        } catch (err) {
            alert('ล้มเหลว: ' + err.message);
        } finally {
            hideLoading();
        }
    });
}

function setupPageManager() {
    const doBtn = document.getElementById('btn-do-pagemgr');
    if (doBtn) doBtn.addEventListener('click', doPageManager);
}

function renderPageManager() {
    const list = document.getElementById('pagemgr-list');
    if (!list) return;
    if (!S.pageCount) { list.innerHTML = '<p class="empty-hint">ยังไม่มี PDF</p>'; return; }
    list.innerHTML = '';
    for (let i = 0; i < S.pageCount; i++) {
        const op    = S.pageOps.find(o => o.pageIndex === i && o.type === 'delete');
        const rotOp = S.pageOps.filter(o => o.pageIndex === i && o.type === 'rotate').reduce((sum, o) => sum + (o.degrees || 0), 0) % 360;
        const row   = document.createElement('div');
        row.className = 'pagemgr-row' + (op ? ' deleted' : '');
        row.dataset.pageIndex = i;
        row.innerHTML = `
            <span class="pm-page-no">หน้า ${i + 1}</span>
            <span class="pm-rot-hint">${rotOp ? `(${rotOp}°)` : ''}</span>
            <button class="pm-btn" title="หมุนซ้าย"  onclick="addPageOp(${i},'rotate',-90)">↺</button>
            <button class="pm-btn" title="หมุนขวา"   onclick="addPageOp(${i},'rotate',90)">↻</button>
            <button class="pm-btn pm-del" title="ลบหน้า" onclick="addPageOp(${i},'delete')">🗑</button>
        `;
        list.appendChild(row);
    }
}

function addPageOp(pageIndex, type, degrees) {
    if (type === 'delete') {
        const existing = S.pageOps.findIndex(o => o.pageIndex === pageIndex && o.type === 'delete');
        if (existing >= 0) {
            S.pageOps.splice(existing, 1);
        } else {
            S.pageOps.push({ type: 'delete', pageIndex });
        }
    } else {
        S.pageOps.push({ type: 'rotate', pageIndex, degrees });
    }
    renderPageManager();
}

async function doPageManager() {
    if (!S.fileId)           { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
    if (S.pageOps.length === 0) { alert('ยังไม่มีการเปลี่ยนแปลง'); return; }
    showLoading('กำลังจัดการหน้า...');
    try {
        const res  = await fetch('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: S.fileId, ops: S.pageOps })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        triggerDownload(`/api/download/${data.outputId}`, 'pages_' + S.originalName);
        S.pageOps = [];
        renderPageManager();
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

function setupCompress() {}

async function doCompress() {
    if (!S.fileId) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
    showLoading('กำลังบีบอัด PDF...');
    try {
        const res  = await fetch('/api/compress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: S.fileId })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        const origMB = (data.originalSize / 1024 / 1024).toFixed(2);
        const newMB  = (data.newSize      / 1024 / 1024).toFixed(2);
        triggerDownload(`/api/download/${data.outputId}`, 'compressed_' + S.originalName);
        showToast(`บีบอัดสำเร็จ: ${origMB} MB → ${newMB} MB`);
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
        document.querySelectorAll('.tool-btn').forEach(b => {
            if (b.dataset.tool === 'compress') b.classList.remove('active');
        });
    }
}

function setupHeaderFooter() {
    const doBtn = document.getElementById('btn-do-headfoot');
    if (!doBtn) return;
    doBtn.addEventListener('click', async () => {
        if (!S.fileId) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
        const hfHeader   = document.getElementById('hf-header');
        const hfFooter   = document.getElementById('hf-footer');
        const hfPagenum  = document.getElementById('hf-pagenum');
        const hfStartpage = document.getElementById('hf-startpage');
        const hfFontsize  = document.getElementById('hf-fontsize');
        const headerText  = hfHeader    ? hfHeader.value      : '';
        const footerText  = hfFooter    ? hfFooter.value      : '';
        const addPageNums = hfPagenum   ? hfPagenum.checked   : false;
        const startPage   = hfStartpage ? parseInt(hfStartpage.value) || 1 : 1;
        const fontSize    = hfFontsize  ? parseInt(hfFontsize.value)  || 11 : 11;

        if (!headerText && !footerText && !addPageNums) { alert('กรุณาใส่ข้อมูลอย่างน้อยหนึ่งช่อง'); return; }

        showLoading('กำลังเพิ่มหัว/ท้าย...');
        try {
            const res  = await fetch('/api/addpages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: S.fileId, headerText, footerText, addPageNumbers: addPageNums, startPage, fontSize })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            triggerDownload(`/api/download/${data.outputId}`, 'headfoot_' + S.originalName);
        } catch (err) {
            alert('ล้มเหลว: ' + err.message);
        } finally {
            hideLoading();
        }
    });
}

function setupDownload() {
    const btn = document.getElementById('btn-download');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        if (!S.fileId) return;
        showLoading('กำลังสร้างไฟล์...');
        try {
            const operations = [];
            for (const a of S.annotations) {
                if (a.type === 'edittext-group') {
                    for (const p of a._parts) {
                        if (p.type === 'text') {
                            operations.push({ type: 'text', pageIndex: p.pageIndex, pdfX: p.pdfX, pdfY: p.pdfY, text: p.text, fontSize: p.fontSize, color: p.color });
                        } else if (p.type === 'whiteout') {
                            operations.push({ type: 'whiteout', pageIndex: p.pageIndex, pdfX: p.pdfX, pdfY: p.pdfY, pdfWidth: p.pdfWidth, pdfHeight: p.pdfHeight });
                        }
                    }
                } else if (a.type === 'text') {
                    operations.push({ type: 'text', pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, text: a.text, fontSize: a.fontSize, color: a.color });
                } else if (a.type === 'whiteout') {
                    operations.push({ type: 'whiteout', pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, pdfWidth: a.pdfWidth, pdfHeight: a.pdfHeight });
                } else if (a.type === 'highlight') {
                    operations.push({ type: 'highlight', pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, pdfWidth: a.pdfWidth, pdfHeight: a.pdfHeight, color: a.color, opacity: a.opacity });
                } else if (a.type === 'shape') {
                    if (a.subtype === 'line') {
                        operations.push({ type: 'shape', subtype: 'line', pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, pdfX2: a.pdfX2, pdfY2: a.pdfY2, color: a.color, borderWidth: a.borderWidth });
                    } else {
                        operations.push({ type: 'shape', subtype: a.subtype, pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, pdfWidth: a.pdfWidth, pdfHeight: a.pdfHeight, color: a.color, borderWidth: a.borderWidth });
                    }
                } else {
                    operations.push({ type: 'image', pageIndex: a.pageIndex, pdfX: a.pdfX, pdfY: a.pdfY, pdfWidth: a.pdfWidth, pdfHeight: a.pdfHeight, imageData: a.imageData });
                }
            }

            const res  = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: S.fileId, operations, formValues: S.formValues })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            triggerDownload(`/api/download/${data.outputId}`, 'edited_' + S.originalName);
        } catch (err) {
            alert('เกิดข้อผิดพลาด: ' + err.message);
        } finally {
            hideLoading();
        }
    });
}

function setupReset() {
    const btn = document.getElementById('btn-reset');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (S.annotations.length === 0 && Object.keys(S.formValues).length === 0) return;
        if (!confirm('ล้างการแก้ไขทั้งหมดหรือไม่?')) return;
        S.annotations = [];
        S.redoStack   = [];
        S.formValues  = {};
        document.querySelectorAll('[data-ann-id]').forEach(el => el.remove());
        Object.values(S.activeDrawCanvases).forEach(dc => dc.getContext('2d').clearRect(0, 0, dc.width, dc.height));
        updateAnnotationList();
        renderFormFields();
    });
}

function setupBack() {
    const btn = document.getElementById('btn-back');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (S.annotations.length > 0 || Object.keys(S.formValues).length > 0) {
            if (!confirm('กลับไปจะสูญเสียการแก้ไข ต้องการดำเนินต่อหรือไม่?')) return;
        }
        deactivateEditTextMode();
        S.fileId      = null;
        S.pdfDoc      = null;
        S.annotations = [];
        S.redoStack   = [];
        S.pageOps     = [];
        S.pagePdfHeights     = {};
        S.activeDrawCanvases = {};
        S.pageTextItems      = {};
        const pc = document.getElementById('pages-container');
        if (pc) pc.innerHTML = '';
        showScreen('upload');
        const fi = document.getElementById('file-input');
        if (fi) fi.value = '';
    });
}

function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const scr = document.getElementById(name + '-screen');
    if (scr) scr.classList.add('active');
}

function showLoading(text) {
    const lt = document.getElementById('loading-text');
    const ld = document.getElementById('loading');
    if (lt) lt.textContent = text || 'กำลังประมวลผล...';
    if (ld) ld.style.display = 'flex';
}

function hideLoading() {
    const ld = document.getElementById('loading');
    if (ld) ld.style.display = 'none';
}

function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function hexToRgbaCSS(hex, alpha) {
    const h = (hex || '#ffff00').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function showToast(msg, duration) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { toast.style.display = 'none'; }, 400);
    }, duration || 4000);
}

// ─── Tab Sidebar ───────────────────────────────────────────────────────────

function setupTabSidebar() {
    document.querySelectorAll('.sidebar-icon[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sidebar-icon').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const sec = document.getElementById('tab-' + btn.dataset.tab);
            if (sec) sec.classList.add('active');
        });
    });
}

// ─── Compress Button ───────────────────────────────────────────────────────

function setupCompressBtn() {
    const btn = document.getElementById('btn-do-compress');
    if (btn) btn.addEventListener('click', doCompress);
}

// ─── Save Version (header button) ─────────────────────────────────────────

function setupSaveVersionHeader() {
    const btn = document.getElementById('btn-save-version');
    if (!btn) return;
    btn.addEventListener('click', () => {
        // Switch to versions tab and focus
        document.querySelectorAll('.sidebar-icon').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));
        const sideBtn = document.querySelector('.sidebar-icon[data-tab="versions"]');
        if (sideBtn) sideBtn.classList.add('active');
        const sec = document.getElementById('tab-versions');
        if (sec) sec.classList.add('active');
        const nameInput = document.getElementById('version-name-input');
        if (nameInput) nameInput.focus();
    });
}

// ─── OCR ──────────────────────────────────────────────────────────────────

let ocrWorker = null;

async function getOCRWorker(lang) {
    if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js ยังโหลดไม่เสร็จ กรุณารีเฟรชหน้า');
    if (ocrWorker) {
        await ocrWorker.terminate();
        ocrWorker = null;
    }
    const worker = await Tesseract.createWorker(lang, 1, {
        logger: m => {
            const fill = document.getElementById('ocr-progress-fill');
            const stat = document.getElementById('ocr-status');
            if (fill && m.progress !== undefined) fill.style.width = (m.progress * 100) + '%';
            if (stat && m.status) stat.textContent = m.status;
        }
    });
    ocrWorker = worker;
    return worker;
}

function getCurrentVisiblePageIndex() {
    const container = document.getElementById('pages-container');
    if (!container) return 0;
    const wrappers = container.querySelectorAll('.page-wrapper');
    const viewerRect = document.getElementById('viewer-wrap').getBoundingClientRect();
    let best = 0, bestOverlap = -1;
    wrappers.forEach(w => {
        const wr = w.getBoundingClientRect();
        const overlap = Math.min(wr.bottom, viewerRect.bottom) - Math.max(wr.top, viewerRect.top);
        if (overlap > bestOverlap) { bestOverlap = overlap; best = parseInt(w.dataset.pageIndex) || 0; }
    });
    return best;
}

function renderOCRResult(results) {
    const container = document.getElementById('ocr-results');
    if (!container) return;
    container.innerHTML = '';
    results.forEach(({ page, text }) => {
        const block = document.createElement('div');
        block.className = 'ocr-result-block';
        block.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:12px;font-weight:600;color:#94a3b8;">หน้า ${page + 1}</span>
                <button class="btn-outline btn-sm" onclick="navigator.clipboard.writeText(this.closest('.ocr-result-block').querySelector('pre').textContent);showToast('คัดลอกแล้ว')">คัดลอก</button>
            </div>
            <pre class="ocr-result-text">${text.replace(/</g, '&lt;')}</pre>
        `;
        container.appendChild(block);
    });
}

function setupOCR() {
    const btnPage = document.getElementById('btn-ocr-page');
    const btnAll  = document.getElementById('btn-ocr-all');

    if (btnPage) btnPage.addEventListener('click', async () => {
        if (!S.fileId || !S.pdfDoc) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
        const lang = document.getElementById('ocr-lang').value || 'tha';
        const pageIndex = getCurrentVisiblePageIndex();
        const canvas = getPageCanvas(pageIndex);
        if (!canvas) return;
        document.getElementById('ocr-progress-fill').style.width = '0';
        document.getElementById('ocr-status').textContent = 'กำลังเริ่ม OCR...';
        try {
            const worker = await getOCRWorker(lang);
            const { data: { text } } = await worker.recognize(canvas);
            renderOCRResult([{ page: pageIndex, text }]);
            document.getElementById('ocr-status').textContent = 'เสร็จสิ้น';
        } catch (err) {
            document.getElementById('ocr-status').textContent = 'ผิดพลาด: ' + err.message;
        }
    });

    if (btnAll) btnAll.addEventListener('click', async () => {
        if (!S.fileId || !S.pdfDoc) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
        const lang = document.getElementById('ocr-lang').value || 'tha';
        const total = S.pdfDoc.numPages;
        const results = [];
        document.getElementById('ocr-progress-fill').style.width = '0';
        document.getElementById('ocr-status').textContent = 'กำลังเริ่ม OCR...';
        try {
            const worker = await getOCRWorker(lang);
            for (let i = 0; i < total; i++) {
                document.getElementById('ocr-status').textContent = `กำลัง OCR หน้า ${i + 1}/${total}...`;
                document.getElementById('ocr-progress-fill').style.width = ((i / total) * 100) + '%';
                const canvas = getPageCanvas(i);
                if (!canvas) continue;
                const { data: { text } } = await worker.recognize(canvas);
                results.push({ page: i, text });
            }
            document.getElementById('ocr-progress-fill').style.width = '100%';
            document.getElementById('ocr-status').textContent = `เสร็จสิ้น (${total} หน้า)`;
            renderOCRResult(results);
        } catch (err) {
            document.getElementById('ocr-status').textContent = 'ผิดพลาด: ' + err.message;
        }
    });
}

// ─── Version Control ───────────────────────────────────────────────────────

async function loadVersions() {
    if (!S.fileId) return;
    try {
        const res  = await fetch(`/api/versions/${S.fileId}`);
        const data = await res.json();
        renderVersionList(data.versions || []);
    } catch (_) {}
}

function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('th-TH') + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function renderVersionList(versions) {
    const list = document.getElementById('version-list');
    if (!list) return;
    if (!versions.length) { list.innerHTML = '<p class="empty-hint">ยังไม่มี Version</p>'; return; }
    list.innerHTML = '';
    [...versions].reverse().forEach(v => {
        const el = document.createElement('div');
        el.className = 'version-item';
        el.innerHTML = `
            <div class="version-item-name">📌 ${v.name}</div>
            <div class="version-item-meta">${fmtDate(v.timestamp)} · ${fmtSize(v.size)}</div>
            ${v.description ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">${v.description}</div>` : ''}
            <div style="display:flex;gap:6px;">
                <button class="btn-outline btn-sm" onclick="downloadVersion('${v.id}','${v.name}')">⬇ โหลด</button>
                <button class="btn-outline btn-sm" onclick="restoreVersion('${v.id}')">↺ Restore</button>
                <button class="btn-outline btn-sm" style="color:#ef4444;border-color:#ef4444;" onclick="deleteVersion('${v.id}')">🗑</button>
            </div>
        `;
        list.appendChild(el);
    });
}

function downloadVersion(versionId, name) {
    triggerDownload(`/api/version-file/${versionId}`, name + '.pdf');
}

async function restoreVersion(versionId) {
    if (!confirm('Restore Version นี้? จะแทนที่เอกสารปัจจุบัน')) return;
    showLoading('กำลัง Restore...');
    try {
        const res  = await fetch(`/api/versions/${versionId}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: S.fileId })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        S.pdfDoc = null;
        S.annotations = [];
        S.redoStack = [];
        await renderPdf();
        showToast('Restore สำเร็จ');
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    } finally {
        hideLoading();
    }
}

async function deleteVersion(versionId) {
    if (!confirm('ลบ Version นี้?')) return;
    try {
        await fetch(`/api/versions/${versionId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: S.fileId })
        });
        await loadVersions();
        showToast('ลบ Version แล้ว');
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    }
}

function setupVersions() {
    const saveBtn = document.getElementById('btn-save-version-panel');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', async () => {
        if (!S.fileId) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
        const nameInput = document.getElementById('version-name-input');
        const descInput = document.getElementById('version-desc-input');
        const name = nameInput ? nameInput.value.trim() : '';
        const desc = descInput ? descInput.value.trim() : '';
        showLoading('กำลังบันทึก Version...');
        try {
            const res  = await fetch('/api/versions/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: S.fileId, versionName: name || undefined, description: desc || undefined })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            if (nameInput) nameInput.value = '';
            if (descInput) descInput.value = '';
            await loadVersions();
            showToast('บันทึก Version สำเร็จ');
        } catch (err) {
            alert('ล้มเหลว: ' + err.message);
        } finally {
            hideLoading();
        }
    });
}

// ─── Workflow ──────────────────────────────────────────────────────────────

async function loadWorkflows() {
    try {
        const res  = await fetch('/api/workflows');
        const data = await res.json();
        renderWorkflowList(data.workflows || []);
    } catch (_) {}
}

const WF_STATUS_LABEL = { active: 'กำลังดำเนินการ', completed: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ' };
const WF_STATUS_CLASS = { active: 'status-active', completed: 'status-completed', rejected: 'status-rejected' };
const STEP_ICON = { pending: '⏳', approved: '✅', rejected: '❌' };

function renderWorkflowList(workflows) {
    const list = document.getElementById('workflow-list');
    if (!list) return;
    if (!workflows.length) { list.innerHTML = '<p class="empty-hint">ยังไม่มี Workflow</p>'; return; }
    list.innerHTML = '';
    workflows.forEach(wf => {
        const el = document.createElement('div');
        el.className = 'workflow-item';
        const stepsHtml = wf.steps.map((s, i) => `
            <div class="workflow-step">
                <span class="step-status step-${s.status}">${STEP_ICON[s.status] || '⏳'}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;color:#e2e8f0;">${s.name}${s.role ? ` <span style="color:#94a3b8">(${s.role})</span>` : ''}</div>
                    ${s.comment ? `<div style="font-size:11px;color:#94a3b8;">"${s.comment}"</div>` : ''}
                </div>
                ${s.status === 'pending' && wf.status === 'active' ? `
                <div style="display:flex;gap:4px;">
                    <button class="btn-sm" style="background:#065f46;color:#a7f3d0;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;" onclick="wfAction('${wf.id}',${i},'approved')">อนุมัติ</button>
                    <button class="btn-sm" style="background:#7f1d1d;color:#fca5a5;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;" onclick="wfActionReject('${wf.id}',${i})">ปฏิเสธ</button>
                </div>` : ''}
            </div>
        `).join('');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                <div style="font-size:12px;font-weight:600;color:#f1f5f9;">${wf.title}</div>
                <span class="workflow-status-badge ${WF_STATUS_CLASS[wf.status] || 'status-active'}">${WF_STATUS_LABEL[wf.status] || wf.status}</span>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">${fmtDate(wf.createdAt)}</div>
            <div class="workflow-steps-list">${stepsHtml}</div>
            <div style="margin-top:8px;">
                <button class="btn-outline btn-sm" style="color:#ef4444;border-color:#ef4444;" onclick="deleteWorkflow('${wf.id}')">🗑 ลบ</button>
            </div>
        `;
        list.appendChild(el);
    });
}

async function wfAction(wfId, stepIndex, action, comment) {
    try {
        const res  = await fetch(`/api/workflow/${wfId}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stepIndex, action, comment: comment || '' })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        await loadWorkflows();
        showToast(action === 'approved' ? '✅ อนุมัติแล้ว' : '❌ ปฏิเสธแล้ว');
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    }
}

async function wfActionReject(wfId, stepIndex) {
    const comment = prompt('เหตุผลที่ปฏิเสธ (ไม่บังคับ):');
    if (comment === null) return;
    await wfAction(wfId, stepIndex, 'rejected', comment);
}

async function deleteWorkflow(wfId) {
    if (!confirm('ลบ Workflow นี้?')) return;
    try {
        await fetch(`/api/workflow/${wfId}`, { method: 'DELETE' });
        await loadWorkflows();
        showToast('ลบ Workflow แล้ว');
    } catch (err) {
        alert('ล้มเหลว: ' + err.message);
    }
}

function setupWorkflow() {
    const createBtn  = document.getElementById('btn-create-workflow');
    const cancelBtn  = document.getElementById('btn-cancel-workflow');
    const addStepBtn = document.getElementById('btn-add-step');
    const submitBtn  = document.getElementById('btn-submit-workflow');
    const form       = document.getElementById('workflow-create-form');
    const stepsContainer = document.getElementById('workflow-steps-container');

    if (createBtn) createBtn.addEventListener('click', () => {
        if (form) {
            form.style.display = form.style.display === 'none' ? 'block' : 'none';
            if (form.style.display === 'block' && stepsContainer && !stepsContainer.children.length) {
                addWorkflowStep();
            }
        }
    });

    if (cancelBtn) cancelBtn.addEventListener('click', () => {
        if (form) form.style.display = 'none';
        if (stepsContainer) stepsContainer.innerHTML = '';
    });

    if (addStepBtn) addStepBtn.addEventListener('click', addWorkflowStep);

    if (submitBtn) submitBtn.addEventListener('click', async () => {
        if (!S.fileId) { alert('กรุณาอัปโหลด PDF ก่อน'); return; }
        const titleInput = document.getElementById('workflow-title-input');
        const title = titleInput ? titleInput.value.trim() : 'Approval Workflow';
        const stepRows = stepsContainer ? stepsContainer.querySelectorAll('.wf-step-row') : [];
        const steps = [];
        stepRows.forEach(row => {
            const name = row.querySelector('.wf-step-name').value.trim();
            const role = row.querySelector('.wf-step-role').value.trim();
            if (name) steps.push({ name, role });
        });
        if (!steps.length) { alert('กรุณาเพิ่มขั้นตอนอย่างน้อย 1 ขั้น'); return; }
        showLoading('กำลังสร้าง Workflow...');
        try {
            const res  = await fetch('/api/workflow/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: S.fileId, title, steps })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            if (form) form.style.display = 'none';
            if (stepsContainer) stepsContainer.innerHTML = '';
            if (titleInput) titleInput.value = '';
            await loadWorkflows();
            showToast('สร้าง Workflow สำเร็จ');
        } catch (err) {
            alert('ล้มเหลว: ' + err.message);
        } finally {
            hideLoading();
        }
    });

    // Load all workflows on init
    loadWorkflows();
}

function addWorkflowStep() {
    const container = document.getElementById('workflow-steps-container');
    if (!container) return;
    const idx  = container.children.length + 1;
    const row  = document.createElement('div');
    row.className = 'wf-step-row';
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;';
    row.innerHTML = `
        <input class="wf-step-name" type="text" placeholder="ชื่อผู้อนุมัติ ${idx}" style="flex:2;min-width:0;">
        <input class="wf-step-role" type="text" placeholder="ตำแหน่ง" style="flex:1;min-width:0;">
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;flex-shrink:0;">✕</button>
    `;
    container.appendChild(row);
}
