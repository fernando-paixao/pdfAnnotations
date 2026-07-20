/* ============================================================
   app.js — bootstrap & wiring
   ============================================================ */
(function () {
  'use strict';

  let currentPdfId = null;
  let currentFileName = '';
  let currentAnnotations = [];
  let currentPage = 1;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const fileInput = $('fileInput');
  const importInput = $('importInput');
  const pdfName = $('pdfName');
  const emptyState = $('emptyState');
  const pagesContainer = $('pagesContainer');
  const viewer = $('viewer');
  const navGroup = $('navGroup');
  const zoomGroup = $('zoomGroup');
  const dataGroup = $('dataGroup');
  const pageInput = $('pageInput');
  const pageCount = $('pageCount');
  const zoomLevel = $('zoomLevel');
  const searchBox = $('searchBox');
  const searchGroup = $('searchGroup');
  const pdfSearch = $('pdfSearch');
  const searchCount = $('searchCount');
  const toastEl = $('toast');

  // ---------- Helpers ----------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
  }

  function findById(id) { return currentAnnotations.find((a) => a.id === id); }

  function refreshUI() {
    AnnotationsUI.render(currentAnnotations);
  }

  // ---------- Wire modules ----------
  PDFViewer.init(viewer, pagesContainer);

  PDFViewer.callbacks.onPageRendered = (pageNumber) => {
    Highlighter.redrawPage(pageNumber);
    Search.redrawPage(pageNumber);
  };
  PDFViewer.callbacks.onVisiblePageChange = (n) => {
    currentPage = n;
    if (document.activeElement !== pageInput) pageInput.value = n;
  };
  PDFViewer.callbacks.onScaleChange = (s) => {
    zoomLevel.textContent = Math.round(s * 100) + '%';
  };
  PDFViewer.callbacks.onLoaded = (n) => {
    pageCount.textContent = n;
    pageInput.max = n;
    pageInput.value = 1;
    currentPage = 1;
  };

  Highlighter.init(viewer, $('highlightBtn'), $('editorPopover'));
  Highlighter.callbacks.createAnnotation = async (data) => {
    const now = Date.now();
    const ann = { ...data, id: uuid(), createdAt: now, updatedAt: now };
    await Storage.addAnnotation(ann);
    currentAnnotations.push(ann);
    return ann;
  };
  Highlighter.callbacks.updateAnnotation = async (ann) => {
    await Storage.updateAnnotation(ann);
    const i = currentAnnotations.findIndex((a) => a.id === ann.id);
    if (i >= 0) currentAnnotations[i] = { ...ann };
  };
  Highlighter.callbacks.deleteAnnotation = async (id) => {
    await Storage.deleteAnnotation(id);
    currentAnnotations = currentAnnotations.filter((a) => a.id !== id);
  };
  Highlighter.callbacks.annotationChanged = () => refreshUI();

  AnnotationsUI.init($('annotationList'), $('annotationCount'), searchBox, $('emptyAnnotations'));
  AnnotationsUI.callbacks.onJump = (id) => {
    const ann = findById(id);
    if (!ann) return;
    PDFViewer.goToPage(ann.page);
    setTimeout(() => Highlighter.flashAnnotation(id), 350);
  };
  AnnotationsUI.callbacks.onDelete = async (id) => {
    Highlighter.removeAnnotationDraw(id);
    await Storage.deleteAnnotation(id);
    currentAnnotations = currentAnnotations.filter((a) => a.id !== id);
    refreshUI();
    showToast('Annotation deleted');
  };

  // ---------- Search (Find in PDF) ----------
  Search.init(pdfSearch, searchCount, $('searchPrev'), $('searchNext'), $('searchClear'));

  // Ctrl+F focuses the search box
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      if (!searchGroup.hidden) {
        e.preventDefault();
        pdfSearch.focus();
        pdfSearch.select();
      }
    }
  });

  // ---------- Shared annotation creation helper ----------
  async function createAnnotationRecord(data) {
    const now = Date.now();
    const ann = { ...data, id: uuid(), createdAt: now, updatedAt: now };
    await Storage.addAnnotation(ann);
    currentAnnotations.push(ann);
    return ann;
  }

  // ---------- Page text helper (for AI context) ----------
  async function getPageText(pageNumber) {
    const tc = await PDFViewer.getTextContent(pageNumber);
    if (!tc) return '';
    const idx = TextGeometry.buildIndex(tc);
    return idx.full;
  }

  // ---------- AI Panel ----------
  const aiPanel = $('aiPanel');
  const aiBackdrop = $('aiBackdrop');
  const aiToggle = $('aiToggle');
  AIPanel.init(aiPanel, aiToggle);

  AIPanel.callbacks.getCurrentPage = () => currentPage;
  AIPanel.callbacks.getSelectedText = () => {
    const sel = window.getSelection();
    return sel ? sel.toString().trim() : '';
  };
  AIPanel.callbacks.getPageText = getPageText;
  AIPanel.callbacks.onAutoAnnotate = (opts) => {
    if (opts.abort) { AutoAnnotate.abort(); return; }
    AutoAnnotate.setPdfId(currentPdfId);
    AutoAnnotate.run(opts);
  };

  // Backdrop click closes the panel
  aiBackdrop.addEventListener('click', () => {
    aiPanel.classList.remove('open');
    aiToggle.classList.remove('active');
    document.body.classList.remove('ai-open');
  });
  // Update backdrop when panel toggles
  const aiToggleObserver = new MutationObserver(() => {
    const open = aiPanel.classList.contains('open');
    document.body.classList.toggle('ai-open', open);
    aiBackdrop.style.pointerEvents = open ? 'auto' : 'none';
    aiBackdrop.style.opacity = open ? '1' : '0';
  });
  aiToggleObserver.observe(aiPanel, { attributes: true, attributeFilter: ['class'] });

  // ---------- Auto-Annotate ----------
  AutoAnnotate.callbacks.getSettings = () => AIPanel.getSettings();
  AutoAnnotate.callbacks.createAnnotation = createAnnotationRecord;
  AutoAnnotate.callbacks.onAnnotationCreated = (ann) => {
    Highlighter.drawAnnotation(ann);
  };
  AutoAnnotate.callbacks.onProgress = (msg) => AIPanel.setAutoStatus(msg);
  AutoAnnotate.callbacks.onError = (msg) => AIPanel.setAutoStatus('⚠️ ' + msg);
  AutoAnnotate.callbacks.onComplete = ({ created, skipped, total }) => {
    AIPanel.setAutoStatus('Done: ' + created + ' created, ' + skipped + ' unmatched (of ' + total + ').');
    AIPanel.setAutoDone();
    refreshUI();
    showToast('AI created ' + created + ' annotation(s)');
  };

  // ---------- Load PDF ----------
  async function loadPdfFile(file) {
    if (!file) return;
    try {
      showToast('Loading PDF…');
      currentFileName = file.name;

      // 1) Stable id + load existing annotations BEFORE rendering pages
      const pdfId = await Storage.hashFile(file);
      currentPdfId = pdfId;
      const existing = await Storage.getAnnotationsByPdf(pdfId);
      currentAnnotations = existing.slice();

      Highlighter.clear();
      Highlighter.setPdfId(pdfId);
      Highlighter.setAnnotations(currentAnnotations);
      Search.reset();
      refreshUI();

      // 2) Render the PDF
      const buffer = await file.arrayBuffer();
      emptyState.style.display = 'none';
      await PDFViewer.loadArrayBuffer(buffer);

      // 3) UI state
      pdfName.textContent = file.name;
      navGroup.hidden = false;
      zoomGroup.hidden = false;
      dataGroup.hidden = false;
      searchGroup.hidden = false;
      zoomLevel.textContent = Math.round(PDFViewer.getScale() * 100) + '%';
      await Storage.savePdfMeta({
        pdfId, fileName: file.name, numPages: PDFViewer.getNumPages(), lastOpened: Date.now(),
      });
      showToast(existing.length + ' annotation(s) loaded');
    } catch (err) {
      console.error(err);
      showToast('Failed to load PDF: ' + (err && err.message ? err.message : err));
    }
  }

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadPdfFile(f);
    fileInput.value = ''; // allow re-picking same file
  });

  // ---------- Toolbar ----------
  $('prevPage').addEventListener('click', () => PDFViewer.goToPage(currentPage - 1));
  $('nextPage').addEventListener('click', () => PDFViewer.goToPage(currentPage + 1));
  pageInput.addEventListener('change', () => {
    const n = parseInt(pageInput.value, 10);
    if (!isNaN(n)) PDFViewer.goToPage(n);
  });

  $('zoomIn').addEventListener('click', () => PDFViewer.zoomIn());
  $('zoomOut').addEventListener('click', () => PDFViewer.zoomOut());

  // Keyboard shortcuts when viewer focused
  viewer.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '=') { e.preventDefault(); PDFViewer.zoomIn(); }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); PDFViewer.zoomOut(); }
  });

  // ---------- Export / Import ----------
  $('exportBtn').addEventListener('click', () => {
    if (!currentPdfId) return;
    const payload = {
      pdfId: currentPdfId,
      fileName: currentFileName,
      exportedAt: Date.now(),
      annotations: currentAnnotations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'annotations-' + (currentFileName.replace(/\.pdf$/i, '') || currentPdfId.slice(0, 8)) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported ' + currentAnnotations.length + ' annotation(s)');
  });

  importInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    importInput.value = '';
    if (!f || !currentPdfId) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.annotations || []);
      let added = 0;
      for (const a of list) {
        if (!a || !a.rects || !a.page) continue;
        const ann = {
          id: a.id || uuid(),
          pdfId: currentPdfId,
          page: a.page,
          textSelected: a.textSelected || '',
          rects: a.rects,
          annotationText: a.annotationText || null,
          color: a.color || '#ffd400',
          createdAt: a.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        await Storage.updateAnnotation(ann); // upsert
        added++;
      }
      currentAnnotations = await Storage.getAnnotationsByPdf(currentPdfId);
      Highlighter.setAnnotations(currentAnnotations);
      refreshUI();
      redrawVisiblePages();
      showToast('Imported ' + added + ' annotation(s)');
    } catch (err) {
      console.error(err);
      showToast('Import failed: ' + (err && err.message ? err.message : err));
    }
  });

  function redrawVisiblePages() {
    const n = PDFViewer.getNumPages();
    for (let i = 1; i <= n; i++) Highlighter.redrawPage(i);
  }

  // ---------- Init DB early ----------
  Storage.openDB().catch((e) => {
    console.error('IndexedDB open failed', e);
    showToast('Storage unavailable (IndexedDB blocked)');
  });
})();
