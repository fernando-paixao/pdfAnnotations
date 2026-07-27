/* ============================================================
   app.js — bootstrap & wiring
   ============================================================ */
(function () {
  'use strict';

  let currentPdfId = null;
  let currentFileName = '';
  let currentAnnotations = [];
  let currentPage = 1;
  let currentNamespaceId = null;
  let currentNamespaces = [];

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
  const namespaceBar = $('namespaceBar');
  const namespaceSelect = $('namespaceSelect');
  const nsCreateBtn = $('nsCreate');
  const nsRenameBtn = $('nsRename');
  const nsDeleteBtn = $('nsDelete');
  const langSelect = $('langSelect');
  const debugTextBtn = $('debugTextBtn');

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
    applyFontScaleToPage(pageNumber);
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
    const ann = { ...data, id: uuid(), namespaceId: currentNamespaceId, createdAt: now, updatedAt: now };
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
  Highlighter.callbacks.onAnnotationClicked = (id) => {
    AnnotationsUI.scrollToAnnotation(id);
  };

  // ---------- Text layer font-size fix ----------
  /** Overrides each text-layer span's font-size to use a fixed px value
   *  (base * current scale) instead of PDF.js's calc(var(--scale-factor) * Xpx).
   *  Called from onPageRendered — the only place where the spans already exist. */
  function applyFontScaleToPage(pageNumber) {
    const wrapper = PDFViewer.getPageWrapper(pageNumber);
    if (!wrapper) return;
    const spans = wrapper.querySelectorAll('.textLayer span');
    spans.forEach((span) => {
      // Capture original base font the first time we see this span
      if (!span.dataset.baseFont) {
        const fs = span.style.fontSize || '';
        const m = fs.match(/([\d.]+)\s*px/);
        if (m) span.dataset.baseFont = m[1];
      }
      if (span.dataset.baseFont) {
        const base = parseFloat(span.dataset.baseFont);
        const scaled = (base * PDFViewer.getScale()).toFixed(2);
        span.style.fontSize = scaled + 'px';
      }
    });
  }

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
    showToast(I18N.t('msg.annotationDeleted'));
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
    const ann = { ...data, id: uuid(), namespaceId: currentNamespaceId, createdAt: now, updatedAt: now };
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
    AutoAnnotate.setNamespaceId(currentNamespaceId);
    AutoAnnotate.run(opts).catch((err) => {
      // Safety net: ensure the UI recovers even if run() rejects unexpectedly
      console.error('Auto-annotate run() failed', err);
      AIPanel.setAutoStatus('⚠️ ' + (err && err.message ? err.message : err));
      AIPanel.setAutoDone();
    });
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
    AIPanel.setAutoStatus(I18N.t('auto.done') + ' ' + created + ' ' + I18N.t('auto.created') + ' ' + skipped + ' ' + I18N.t('auto.unmatched') + ' ' + total + ' ' + I18N.t('auto.total'));
    AIPanel.setAutoDone();
    refreshUI();
    showToast(I18N.t('msg.aiCreated') + ' ' + created + ' ' + I18N.t('msg.annotation_s'));
  };
  AutoAnnotate.callbacks.onDebug = (category, message, data) => {
    AIPanel.debugLog(category, message, data);
  };

  // ---------- Namespace management ----------
  async function selectNamespace(nsId) {
    currentNamespaceId = nsId;
    Highlighter.setNamespaceId(nsId);
    const anns = await Storage.getAnnotationsByNamespace(nsId);
    currentAnnotations = anns.slice();
    Highlighter.clear();
    Highlighter.setAnnotations(currentAnnotations);
    refreshUI();
    redrawVisiblePages();
    updateNamespaceSelector();
    showToast(anns.length + ' ' + I18N.t('msg.inNamespace') + ' "' + (currentNamespaces.find(n => n.id === nsId) || {}).name + '"');
  }

  async function createNamespace(name) {
    const nsName = (name || '').trim() || I18N.t('ns.newNamespace');
    const ns = {
      id: 'ns_' + uuid(),
      name: nsName,
      pdfId: currentPdfId,
      pdfName: currentFileName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await Storage.createNamespace(ns);
    currentNamespaces.push(ns);
    await selectNamespace(ns.id);
  }

  async function renameNamespace(nsId) {
    const ns = currentNamespaces.find(n => n.id === nsId);
    if (!ns) return;
    const newName = prompt(I18N.t('ns.renamePrompt'), ns.name);
    if (newName === null) return; // cancelled
    const trimmed = newName.trim();
    if (!trimmed || trimmed === ns.name) return;
    ns.name = trimmed;
    ns.updatedAt = Date.now();
    await Storage.updateNamespace(ns);
    updateNamespaceSelector();
    showToast(I18N.t('msg.namespaceRenamed') + ' "' + trimmed + '"');
  }

  async function deleteNamespace(nsId) {
    const ns = currentNamespaces.find(n => n.id === nsId);
    if (!ns) return;
    if (currentNamespaces.length <= 1) {
      showToast(I18N.t('msg.cantDeleteLast'));
      return;
    }
    if (!confirm(I18N.t('ns.deleteConfirm') + ' "' + ns.name + '" ' + I18N.t('ns.andAllAnnotations'))) return;
    await Storage.deleteNamespaceAndAnnotations(nsId);
    currentNamespaces = currentNamespaces.filter(n => n.id !== nsId);
    if (currentNamespaceId === nsId) {
      await selectNamespace(currentNamespaces[0].id);
    } else {
      updateNamespaceSelector();
    }
    showToast(I18N.t('msg.namespaceDeleted'));
  }

  function updateNamespaceSelector() {
    namespaceSelect.innerHTML = '';
    currentNamespaces.forEach((ns) => {
      const opt = document.createElement('option');
      opt.value = ns.id;
      opt.textContent = ns.name;
      if (ns.id === currentNamespaceId) opt.selected = true;
      namespaceSelect.appendChild(opt);
    });
  }

  // ---------- Load PDF ----------
  async function loadPdfFile(file) {
    if (!file) return;
    try {
      showToast(I18N.t('msg.loading'));
      currentFileName = file.name;

      // 1) Stable PDF id
      const pdfId = await Storage.hashFile(file);
      currentPdfId = pdfId;

      // 2) Migrate old annotations (v1 format with pdfId but no namespaceId)
      const migratedNs = await Storage.migrateOldAnnotations(pdfId, file.name);

      // 3) Load namespaces for this PDF
      currentNamespaces = await Storage.getNamespacesByPdf(pdfId);

      // If no namespaces exist, create a default one
      if (currentNamespaces.length === 0) {
        const defaultNs = {
          id: 'ns_' + uuid(),
          name: 'default',
          pdfId,
          pdfName: file.name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await Storage.createNamespace(defaultNs);
        currentNamespaces.push(defaultNs);
      }

      // 4) Select namespace — prefer migrated one, else first
      const selectNs = migratedNs || currentNamespaces[0];
      await selectNamespace(selectNs.id);

      Search.reset();

      // 5) Render the PDF
      const buffer = await file.arrayBuffer();
      emptyState.style.display = 'none';
      await PDFViewer.loadArrayBuffer(buffer);

      // 6) UI state
      pdfName.textContent = file.name;
      navGroup.hidden = false;
      zoomGroup.hidden = false;
      dataGroup.hidden = false;
      searchGroup.hidden = false;
      namespaceBar.hidden = false;
      searchBox.hidden = false;
      debugTextBtn.hidden = false;
      zoomLevel.textContent = Math.round(PDFViewer.getScale() * 100) + '%';
      await Storage.savePdfMeta({
        pdfId, fileName: file.name, numPages: PDFViewer.getNumPages(), lastOpened: Date.now(),
      });
    } catch (err) {
      console.error(err);
      showToast(I18N.t('msg.loadFailed') + ' ' + (err && err.message ? err.message : err));
    }
  }

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadPdfFile(f);
    fileInput.value = ''; // allow re-picking same file
  });

  // ---------- Namespace UI events ----------
  namespaceSelect.addEventListener('change', () => {
    if (namespaceSelect.value) selectNamespace(namespaceSelect.value);
  });
  nsCreateBtn.addEventListener('click', () => {
    const name = prompt(I18N.t('ns.newName'), '');
    if (name !== null) createNamespace(name);
  });
  nsRenameBtn.addEventListener('click', () => {
    if (currentNamespaceId) renameNamespace(currentNamespaceId);
  });
  nsDeleteBtn.addEventListener('click', () => {
    if (currentNamespaceId) deleteNamespace(currentNamespaceId);
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

  // ---------- Debug: toggle text layer visibility ----------
  debugTextBtn.addEventListener('click', () => {
    const isActive = document.body.classList.toggle('debug-text');
    debugTextBtn.classList.toggle('active', isActive);
    // Redraw annotations so tooltips show/hide rect coordinates
    Highlighter.redrawAll();
  });

  // Keyboard shortcuts when viewer focused
  viewer.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '=') { e.preventDefault(); PDFViewer.zoomIn(); }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); PDFViewer.zoomOut(); }
  });

  // ---------- Export / Import ----------
  $('exportBtn').addEventListener('click', () => {
    if (!currentNamespaceId) return;
    const ns = currentNamespaces.find(n => n.id === currentNamespaceId);
    const payload = {
      namespaceId: currentNamespaceId,
      namespaceName: ns ? ns.name : '',
      fileName: currentFileName,
      exportedAt: Date.now(),
      annotations: currentAnnotations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nsName = ns ? ns.name : 'annotations';
    a.download = 'annotations-' + nsName.replace(/[^a-z0-9_-]/gi, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(I18N.t('msg.exported') + ' ' + currentAnnotations.length + ' ' + I18N.t('msg.annotation_s'));
  });

  importInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    importInput.value = '';
    if (!f || !currentNamespaceId) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.annotations || []);
      let added = 0;
      for (const a of list) {
        if (!a || !a.rects || !a.page) continue;
        const ann = {
          id: a.id || uuid(),
          namespaceId: currentNamespaceId,
          page: a.page,
          textSelected: a.textSelected || '',
          rects: a.rects,
          annotationText: a.annotationText || null,
          color: a.color || '#ffd400',
          textStart: a.textStart != null ? a.textStart : null,
          textEnd: a.textEnd != null ? a.textEnd : null,
          createdAt: a.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        await Storage.updateAnnotation(ann); // upsert
        added++;
      }
      currentAnnotations = await Storage.getAnnotationsByNamespace(currentNamespaceId);
      Highlighter.setAnnotations(currentAnnotations);
      refreshUI();
      redrawVisiblePages();
      showToast(I18N.t('msg.imported') + ' ' + added + ' ' + I18N.t('msg.annotation_s'));
    } catch (err) {
      console.error(err);
      showToast(I18N.t('msg.importFailed') + ' ' + (err && err.message ? err.message : err));
    }
  });

  function redrawVisiblePages() {
    const n = PDFViewer.getNumPages();
    for (let i = 1; i <= n; i++) Highlighter.redrawPage(i);
  }

  // ---------- Language selector ----------
  if (langSelect) {
    langSelect.value = I18N.getLang();
    langSelect.addEventListener('change', () => {
      I18N.setLang(langSelect.value);
      I18N.applyTranslations();
      // Update dynamic UI elements that were built with t() calls
      refreshUI();
    });
  }

  // Apply translations on initial load
  I18N.applyTranslations();

  // ---------- Init DB early ----------
  Storage.openDB().catch((e) => {
    console.error('IndexedDB open failed', e);
    showToast(I18N.t('msg.storageUnavailable'));
  });
})();
