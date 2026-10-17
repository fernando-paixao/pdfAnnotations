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
  let lastClickedAnnotationId = null; // anchor for the "highlight → next highlight" AI scope

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
  const settingsBtn = $('settingsBtn');
  const settingsModal = $('settingsModal');
  const settingsClose = $('settingsClose');
  const debugTextToggle = $('debugTextToggle');
  const ccImagesToggle = $('ccImagesToggle');
  const translateLangInput = $('translateLangInput');
  const markdownNotesToggle = $('markdownNotesToggle');

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
    lastClickedAnnotationId = id;
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
    lastClickedAnnotationId = id;
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

  // ---------- AI scope: current highlight → next highlight ----------
  /** Resolve an annotation's char range (page + [start,end)) in that page's
   *  full-text index. Uses stored textStart/textEnd when present, falling back
   *  to findSnippetRange for legacy annotations. Returns null when unresolvable. */
  async function resolveAnnotationRange(ann) {
    if (!ann || typeof ann.page !== 'number') return null;
    const tc = await PDFViewer.getTextContent(ann.page);
    if (!tc) return null;
    const idx = TextGeometry.buildIndex(tc);
    if (ann.textStart != null && ann.textEnd != null &&
        ann.textStart >= 0 && ann.textEnd <= idx.full.length) {
      return { page: ann.page, start: ann.textStart, end: ann.textEnd, idx };
    }
    if (ann.textSelected && ann.textSelected.trim()) {
      const range = TextGeometry.findSnippetRange(idx, ann.textSelected);
      if (range) return { page: ann.page, start: range.start, end: range.end, idx };
    }
    return null;
  }

  AIPanel.callbacks.getLastClickedAnnotation = () => {
    if (lastClickedAnnotationId == null) return null;
    return findById(lastClickedAnnotationId) || null;
  };

  /**
   * Slice the document text from a resolved range's START (inclusive) up to —
   * but not including — the boundary range. With no boundary, runs to the end
   * of the document. Returns { text, pages }.
   */
  async function sliceSpan(fromRange, boundary) {
    const total = PDFViewer.getNumPages();
    const pages = [];
    const parts = [];
    const pushSlice = (p, text) => {
      pages.push({ page: p, text });
      parts.push('--- Page ' + p + ' ---\n' + text);
    };

    // Start page: from the range's START (includes the highlighted text) to
    // the boundary highlight (or page end)
    pushSlice(fromRange.page, fromRange.idx.full.slice(
      fromRange.start, boundary && boundary.page === fromRange.page ? boundary.start : undefined
    ));

    // Intermediate pages (full text) between the start page and the boundary
    // (or, with no boundary, through the end of the document)
    const lastLoopPage = boundary ? boundary.page : total + 1;
    for (let p = fromRange.page + 1; p < lastLoopPage; p++) {
      pushSlice(p, await getPageText(p));
    }

    // Final page: up to the boundary highlight's start (highlight excluded)
    if (boundary && boundary.page > fromRange.page) {
      pushSlice(boundary.page, boundary.idx.full.slice(0, boundary.start));
    }

    return { text: parts.join('\n\n'), pages };
  }

  /** Resolve every annotation in the namespace to candidate ranges sorted by
   *  (page, start). Unresolvable (legacy/corrupt) annotations are skipped. */
  async function collectHighlightCandidates() {
    const candidates = [];
    for (const a of currentAnnotations) {
      const r = await resolveAnnotationRange(a);
      if (r) candidates.push({ ann: a, page: r.page, start: r.start, end: r.end, idx: r.idx });
    }
    candidates.sort((x, y) => (x.page - y.page) || (x.start - y.start));
    return candidates;
  }

  /** First candidate lexicographically at/after (cursor.page, cursor.end)
   *  that is not in `used`, or null when the chain has ended. */
  function nextBoundary(candidates, cursor, used) {
    for (const c of candidates) {
      if (used.has(c.ann.id)) continue;
      if (c.page > cursor.page || (c.page === cursor.page && c.start >= cursor.end)) {
        return c;
      }
    }
    return null;
  }

  /**
   * Build the text span starting at the anchor highlight (inclusive) up to —
   * but not including — the boundary highlight. "Number of highlights ahead"
   * advances the boundary several highlights further; an empty value runs to
   * the end of the document. Returns { text, pages, label } or null (caller
   * falls back to the entire-page scope).
   */
  AIPanel.callbacks.getHighlightSpan = async (anchor) => {
    const anchorRange = await resolveAnnotationRange(anchor);
    if (!anchorRange) return null;

    const candidates = await collectHighlightCandidates();

    // How many next-highlight boundaries to advance (empty/invalid = to the end)
    let maxSteps = null;
    const rawCount = String(
      AIPanel.getSettings ? (AIPanel.getSettings().highlightCount || '') : ''
    ).trim();
    if (rawCount !== '') {
      const n = parseInt(rawCount, 10);
      if (!isNaN(n) && n > 0) maxSteps = n;
    }

    // Walk highlight → next highlight until the Nth boundary (or the last one)
    const used = new Set([anchor.id]);
    let cursor = { page: anchorRange.page, end: anchorRange.end };
    let boundary = null;
    let steps = 0;
    while (maxSteps === null || steps < maxSteps) {
      const cand = nextBoundary(candidates, cursor, used);
      if (!cand) break;
      boundary = cand;
      used.add(cand.ann.id);
      cursor = { page: cand.page, end: cand.end };
      steps++;
    }

    const { text, pages } = await sliceSpan(anchorRange, boundary);
    const total = PDFViewer.getNumPages();
    const label = boundary
      ? 'Highlights p.' + anchorRange.page + '→' + boundary.page
      : 'Highlights p.' + anchorRange.page + '→' + total;
    return { text, pages, label, anchorId: anchor.id };
  };

  /**
   * Split the highlight chain starting at the anchor into contiguous segments:
   * segment i = [boundary i-1 … boundary i), each boundary highlight excluded
   * from its segment and included as the start of the next; the last segment
   * runs to the end of the document. Used when "Number of highlights ahead" is
   * empty so each segment can be enqueued as its own AI action.
   * Returns { segments: [{ text, pages, label }] } or null when the anchor is
   * unresolvable. Zero boundaries after the anchor ⇒ a single segment.
   */
  AIPanel.callbacks.getHighlightSegments = async (anchor) => {
    const anchorRange = await resolveAnnotationRange(anchor);
    if (!anchorRange) return null;

    const candidates = await collectHighlightCandidates();

    // Walk highlight → next highlight collecting ALL boundaries after the
    // anchor (the used-id set guarantees termination)
    const used = new Set([anchor.id]);
    const starts = [anchorRange];
    let cursor = { page: anchorRange.page, end: anchorRange.end };
    for (;;) {
      const cand = nextBoundary(candidates, cursor, used);
      if (!cand) break;
      starts.push(cand);
      used.add(cand.ann.id);
      cursor = { page: cand.page, end: cand.end };
    }

    const total = PDFViewer.getNumPages();
    const segments = [];
    for (let i = 0; i < starts.length; i++) {
      const boundary = i + 1 < starts.length ? starts[i + 1] : null;
      const { text, pages } = await sliceSpan(starts[i], boundary);
      const endPage = boundary ? boundary.page : total;
      segments.push({
        text,
        pages,
        label: 'Highlights p.' + starts[i].page + '→' + endPage +
          ' (' + (i + 1) + '/' + starts.length + ')',
        anchorId: i === 0 ? anchor.id : starts[i].ann.id,
      });
    }
    return { segments };
  };

  /**
   * Store `note` as an annotation's note text. With opts.skipIfExists the
   * existing note is preserved. Returns 'added', 'exists' (existing note
   * kept), or null when the annotation no longer exists.
   */
  AIPanel.callbacks.addNoteToAnnotation = async (id, note, opts) => {
    const ann = findById(id);
    if (!ann) return null;
    if (opts && opts.skipIfExists && ann.annotationText && ann.annotationText.trim()) return 'exists';
    ann.annotationText = note;
    ann.updatedAt = Date.now();
    await Storage.updateAnnotation(ann);
    Highlighter.refreshAnnotation(ann);
    refreshUI();
    return 'added';
  };

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
    lastClickedAnnotationId = null;
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
      lastClickedAnnotationId = null;

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
      settingsBtn.hidden = false;
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

  // ---------- Settings modal ----------
  // CC images setting: persisted in localStorage, exposed globally
  window.getCcImagesEnabled = function () {
    return localStorage.getItem('ccImagesEnabled') === '1';
  };

  // Google Translate target language: persisted in localStorage, exposed globally
  window.getTranslateLang = function () {
    return (localStorage.getItem('translateLang') || '').trim();
  };

  // Markdown notes setting: persisted in localStorage, exposed globally
  window.getMarkdownNotes = function () {
    return localStorage.getItem('markdownNotes') === '1';
  };

  // Restore saved settings on load
  ccImagesToggle.checked = window.getCcImagesEnabled();
  translateLangInput.value = window.getTranslateLang();
  markdownNotesToggle.checked = window.getMarkdownNotes();

  settingsBtn.addEventListener('click', () => {
    settingsModal.hidden = false;
  });
  settingsClose.addEventListener('click', () => {
    settingsModal.hidden = true;
  });
  // Close modal when clicking the backdrop
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.hidden = true;
  });

  // Debug text layer toggle
  debugTextToggle.addEventListener('change', () => {
    const isActive = debugTextToggle.checked;
    document.body.classList.toggle('debug-text', isActive);
    settingsBtn.classList.toggle('active', isActive);
    Highlighter.redrawAll();
  });

  // CC images toggle
  ccImagesToggle.addEventListener('change', () => {
    localStorage.setItem('ccImagesEnabled', ccImagesToggle.checked ? '1' : '0');
  });

  // Google Translate target language
  translateLangInput.addEventListener('change', () => {
    localStorage.setItem('translateLang', translateLangInput.value.trim());
  });

  // Markdown notes toggle
  markdownNotesToggle.addEventListener('change', () => {
    localStorage.setItem('markdownNotes', markdownNotesToggle.checked ? '1' : '0');
    refreshUI();
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

  // ---------- Backup / Restore (full-data zip) ----------
  const backupBtn = $('backupBtn');
  const restoreBtn = $('restoreBtn');
  const restoreInput = $('restoreInput');
  const backupReminder = $('backupReminder');

  async function runBackup() {
    backupBtn.disabled = true;
    try {
      const ok = await Backup.saveBackup();
      if (ok) showToast(I18N.t('msg.backupSaved'));
    } catch (err) {
      console.error(err);
      showToast(I18N.t('msg.backupFailed') + ' ' + (err && err.message ? err.message : err));
    } finally {
      backupBtn.disabled = false;
    }
  }

  backupBtn.addEventListener('click', runBackup);

  restoreBtn.addEventListener('click', () => restoreInput.click());

  restoreInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    restoreInput.value = '';
    if (!f) return;
    try {
      const payload = await Backup.parseBackupFile(f);
      const counts = await Backup.restore(payload);
      // Reload state for the current PDF (namespace selection re-reads annotations)
      if (currentPdfId) {
        currentNamespaces = await Storage.getNamespacesByPdf(currentPdfId);
        if (currentNamespaces.length > 0) {
          const target = currentNamespaces.some((n) => n.id === currentNamespaceId)
            ? currentNamespaceId
            : currentNamespaces[0].id;
          await selectNamespace(target);
        } else {
          currentAnnotations = [];
          Highlighter.setAnnotations(currentAnnotations);
          refreshUI();
          redrawVisiblePages();
        }
      }
      showToast(I18N.t('msg.restored') + ' ' + counts.annotations + ' ' + I18N.t('msg.annotation_s'));
    } catch (err) {
      console.error(err);
      showToast(I18N.t('msg.restoreFailed') + ' ' + (err && err.message ? err.message : err));
    }
  });

  // ---------- 7-day backup reminder ----------
  let backupReminderDismissed = false; // "Later" dismisses for this session only

  function showBackupReminder() {
    if (backupReminderDismissed || backupReminder.hidden === false) return;
    const last = Backup.getLastBackupAt();
    const bodyEl = $('backupReminderBody');
    if (last) {
      const days = Math.floor((Date.now() - last) / (24 * 60 * 60 * 1000));
      bodyEl.textContent = I18N.t('backup.reminderBodyDays').replace('{n}', String(days));
    } else {
      bodyEl.textContent = I18N.t('backup.reminderBody');
    }
    backupReminder.hidden = false;
  }

  function dismissBackupReminder() {
    backupReminder.hidden = true;
    backupReminderDismissed = true;
  }

  $('backupNowBtn').addEventListener('click', () => {
    backupReminder.hidden = true;
    runBackup();
  });
  $('backupLaterBtn').addEventListener('click', dismissBackupReminder);
  $('backupReminderClose').addEventListener('click', dismissBackupReminder);
  backupReminder.addEventListener('click', (e) => {
    if (e.target === backupReminder) dismissBackupReminder();
  });

  async function checkBackupReminder() {
    try {
      await Storage.openDB();
      const [anns, nss] = await Promise.all([Storage.getAllAnnotations(), Storage.getAllNamespaces()]);
      if (anns.length === 0 && nss.length === 0) return;
      if (!Backup.isReminderDue()) return;
      showBackupReminder();
    } catch (err) {
      // Storage unavailable — no reminder
    }
  }
  checkBackupReminder();

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
