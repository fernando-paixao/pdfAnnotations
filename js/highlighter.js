/* ============================================================
   highlighter.js — text selection -> highlight overlay,
   re-draw saved highlights, click-to-edit popover.
   Exposes global: Highlighter
   ============================================================ */
const Highlighter = (() => {
  const HIGHLIGHT_COLOR = '#ffd400';
  let highlightBtn = null;
  let editorPopover = null;
  let editorText = null;
  let editorSave = null;
  let editorDelete = null;
  let viewerEl = null;

  // page -> Map(annotationId -> annotation)
  const byPage = new Map();
  // id -> annotation (for quick lookup)
  const byId = new Map();
  let currentNamespaceId = null;
  let activeAnnotationId = null; // annotation being edited in popover

  const callbacks = {
    createAnnotation: null,  // async (data) -> ann
    updateAnnotation: null,  // async (ann)
    deleteAnnotation: null,  // async (id)
    annotationChanged: null, // ()
    onAnnotationClicked: null, // (id) — fired when a highlight rect is clicked
  };

  function init(viewer, btn, popover) {
    viewerEl = viewer;
    highlightBtn = btn;
    editorPopover = popover;
    editorText = popover.querySelector('#editorText');
    editorSave = popover.querySelector('#editorSave');
    editorDelete = popover.querySelector('#editorDelete');

    // Show highlight button on text selection
    document.addEventListener('mouseup', () => setTimeout(updateSelectionButton, 10));
    document.addEventListener('touchend', () => setTimeout(updateSelectionButton, 10));
    document.addEventListener('selectionchange', () => {
      if (!highlightBtn.hidden) updateSelectionButton();
    });

    highlightBtn.addEventListener('mousedown', (e) => e.preventDefault());
    highlightBtn.addEventListener('click', onHighlightClick);

    editorSave.addEventListener('click', onEditorSave);
    editorDelete.addEventListener('click', onEditorDelete);

    // Close popover when clicking outside
    document.addEventListener('mousedown', (e) => {
      if (editorPopover.hidden) return;
      if (editorPopover.contains(e.target)) return;
      if (e.target.classList && e.target.classList.contains('highlight-rect')) return;
      closeEditor();
    });

    // Close button when clicking elsewhere
    document.addEventListener('mousedown', (e) => {
      if (!highlightBtn.hidden && e.target !== highlightBtn && !isSelectionActive()) {
        highlightBtn.hidden = true;
      }
    });
  }

  function setNamespaceId(id) { currentNamespaceId = id; }
  // Legacy alias
  function setPdfId(id) { currentNamespaceId = id; }

  function setAnnotations(anns) {
    byPage.clear();
    byId.clear();
    anns.forEach((a) => addInternal(a));
  }

  function addInternal(ann) {
    byId.set(ann.id, ann);
    if (!byPage.has(ann.page)) byPage.set(ann.page, new Map());
    byPage.get(ann.page).set(ann.id, ann);
  }

  function removeInternal(id) {
    const ann = byId.get(id);
    if (!ann) return;
    byId.delete(id);
    const m = byPage.get(ann.page);
    if (m) m.delete(id);
  }

  /* ---------- Selection -> highlight button ---------- */
  function isSelectionActive() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const text = sel.toString().trim();
    if (!text) return false;
    return getPageOfSelection(sel) !== null;
  }

  function getPageOfSelection(sel) {
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const wrapper = node.closest ? node.closest('.page-wrapper') : null;
    if (!wrapper) return null;
    return Number(wrapper.dataset.pageNumber);
  }

  function updateSelectionButton() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) {
      highlightBtn.hidden = true;
      return;
    }
    const page = getPageOfSelection(sel);
    if (page === null) { highlightBtn.hidden = true; return; }
    // Position button above the selection
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    highlightBtn.style.left = (rect.left + rect.width / 2 - 50) + 'px';
    highlightBtn.style.top = (rect.top - 38) + 'px';
    highlightBtn.hidden = false;
  }

  /* ---------- Create highlight from current selection ---------- */
  async function onHighlightClick() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const page = getPageOfSelection(sel);
    if (page === null) return;

    const wrapper = PDFViewer.getPageWrapper(page);
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const range = sel.getRangeAt(0);

    // Capture each line rect, normalized to the page (0..1)
    const rects = [];
    const seen = new Set();
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const localX = r.left - wrapperRect.left;
      const localY = r.top - wrapperRect.top;
      const nx = localX / wrapperRect.width;
      const ny = localY / wrapperRect.height;
      const nw = r.width / wrapperRect.width;
      const nh = r.height / wrapperRect.height;
      if (nx < 0 || ny < 0 || nx > 1 || ny > 1) continue;
      const key = nx.toFixed(3) + ',' + ny.toFixed(3) + ',' + nw.toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      rects.push({
        x: clamp(nx, 0, 1), y: clamp(ny, 0, 1),
        width: clamp(nw, 0, 1), height: clamp(nh, 0, 1),
      });
    }
    if (rects.length === 0) { highlightBtn.hidden = true; return; }

    const textSelected = sel.toString().trim();
    sel.removeAllRanges();
    highlightBtn.hidden = true;

    const data = {
      namespaceId: currentNamespaceId,
      page,
      textSelected,
      rects,
      annotationText: null,
      color: HIGHLIGHT_COLOR,
    };

    if (callbacks.createAnnotation) {
      const ann = await callbacks.createAnnotation(data);
      if (ann) {
        addInternal(ann);
        drawAnnotation(ann);
        if (callbacks.annotationChanged) callbacks.annotationChanged();
        // Open editor immediately so user can add a note
        openEditorFor(ann.id);
      }
    }
  }

  /* ---------- Drawing ---------- */
  function drawAnnotation(ann) {
    // Ensure annotation is tracked in internal maps (fixes AI-created annotations
    // that are drawn via onAnnotationCreated without going through addInternal)
    if (!byId.has(ann.id)) addInternal(ann);
    const wrapper = PDFViewer.getPageWrapper(ann.page);
    if (!wrapper) return;
    const layer = wrapper.querySelector('.highlight-layer');
    if (!layer) return;
    // Remove existing rect(s) for this annotation
    layer.querySelectorAll(`[data-ann-id="${ann.id}"]`).forEach((el) => el.remove());
    ann.rects.forEach((r, idx) => {
      const div = document.createElement('div');
      div.className = 'highlight-rect';
      if (ann.annotationText) div.classList.add('has-note');
      div.dataset.annId = ann.id;
      div.dataset.rectIdx = idx;
      div.style.left = (r.x * 100) + '%';
      div.style.top = (r.y * 100) + '%';
      div.style.width = (r.width * 100) + '%';
      div.style.height = (r.height * 100) + '%';
      div.title = ann.annotationText || ann.textSelected.slice(0, 80);
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditorFor(ann.id, e.clientX, e.clientY);
      });
      layer.appendChild(div);
    });
  }

  function redrawPage(pageNumber) {
    const m = byPage.get(pageNumber);
    if (!m) return;
    m.forEach((ann) => drawAnnotation(ann));
  }

  function refreshAnnotation(ann) {
    removeInternal(ann);
    addInternal(ann);
    drawAnnotation(ann);
  }

  function removeAnnotationDraw(id) {
    const ann = byId.get(id);
    if (ann) {
      const wrapper = PDFViewer.getPageWrapper(ann.page);
      if (wrapper) {
        wrapper.querySelectorAll('.highlight-layer [data-ann-id="' + id + '"]')
          .forEach((el) => el.remove());
      }
    }
    removeInternal(id);
  }

  function flashAnnotation(id) {
    const ann = byId.get(id);
    if (!ann) return;
    const wrapper = PDFViewer.getPageWrapper(ann.page);
    if (!wrapper) return;
    const rects = wrapper.querySelectorAll('.highlight-layer [data-ann-id="' + id + '"]');
    rects.forEach((el) => {
      el.classList.remove('flash');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('flash');
    });
  }

  /* ---------- Editor popover ---------- */
  function openEditorFor(id, clientX, clientY) {
    const ann = byId.get(id);
    if (!ann) return;
    activeAnnotationId = id;
    editorText.value = ann.annotationText || '';
    editorPopover.hidden = false;
    // Notify listeners (e.g. scroll annotation list to this item)
    if (callbacks.onAnnotationClicked) callbacks.onAnnotationClicked(id);
    // Position near click or near the highlight
    let x = clientX, y = clientY;
    if (x == null || y == null) {
      const wrapper = PDFViewer.getPageWrapper(ann.page);
      const rects = wrapper.querySelectorAll('.highlight-layer [data-ann-id="' + id + '"]');
      if (rects.length) {
        const r = rects[0].getBoundingClientRect();
        x = r.left; y = r.bottom + 6;
      } else { x = 100; y = 100; }
    }
    const pw = editorPopover.offsetWidth || 280;
    const ph = editorPopover.offsetHeight || 160;
    x = Math.min(x, window.innerWidth - pw - 10);
    y = Math.min(y, window.innerHeight - ph - 10);
    editorPopover.style.left = Math.max(10, x) + 'px';
    editorPopover.style.top = Math.max(10, y) + 'px';
    setTimeout(() => editorText.focus(), 0);
  }

  function closeEditor() {
    editorPopover.hidden = true;
    activeAnnotationId = null;
  }

  async function onEditorSave() {
    if (activeAnnotationId == null) return;
    const ann = byId.get(activeAnnotationId);
    if (!ann) { closeEditor(); return; }
    ann.annotationText = editorText.value.trim() || null;
    ann.updatedAt = Date.now();
    closeEditor();
    if (callbacks.updateAnnotation) await callbacks.updateAnnotation(ann);
    refreshAnnotation(ann);
    if (callbacks.annotationChanged) callbacks.annotationChanged();
  }

  async function onEditorDelete() {
    if (activeAnnotationId == null) return;
    const id = activeAnnotationId;
    closeEditor();
    removeAnnotationDraw(id);
    if (callbacks.deleteAnnotation) await callbacks.deleteAnnotation(id);
    if (callbacks.annotationChanged) callbacks.annotationChanged();
  }

  function clear() {
    byPage.clear();
    byId.clear();
    closeEditor();
    highlightBtn.hidden = true;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  return {
    init, setNamespaceId, setPdfId, setAnnotations, redrawPage, drawAnnotation,
    refreshAnnotation, removeAnnotationDraw, flashAnnotation, clear,
    callbacks,
  };
})();
