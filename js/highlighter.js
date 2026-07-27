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
  let editorExpandLeft = null;
  let editorExpandRight = null;
  let editorShrinkLeft = null;
  let editorShrinkRight = null;
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
    editorExpandLeft = popover.querySelector('#editorExpandLeft');
    editorExpandRight = popover.querySelector('#editorExpandRight');
    editorShrinkLeft = popover.querySelector('#editorShrinkLeft');
    editorShrinkRight = popover.querySelector('#editorShrinkRight');

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
    editorExpandLeft.addEventListener('click', () => onAdjustSelection('expand', 'left'));
    editorExpandRight.addEventListener('click', () => onAdjustSelection('expand', 'right'));
    editorShrinkLeft.addEventListener('click', () => onAdjustSelection('shrink', 'left'));
    editorShrinkRight.addEventListener('click', () => onAdjustSelection('shrink', 'right'));

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

    // Compute character offsets in the page's full-text index.
    // This lets expand-selection locate the EXACT occurrence later,
    // instead of always finding the first match.
    let textStart = null, textEnd = null;
    try {
      const tc = await PDFViewer.getTextContent(page);
      if (tc) {
        const textIdx = TextGeometry.buildIndex(tc);
        const spanMap = PDFViewer.getSpanMap(page);
        const charRange = TextGeometry.selectionToCharRange(textIdx, spanMap, range);
        if (charRange) {
          textStart = charRange.start;
          textEnd = charRange.end;
        }
      }
    } catch (e) { /* non-critical — expand will fall back to findSnippetRange */ }

    sel.removeAllRanges();
    highlightBtn.hidden = true;

    const data = {
      namespaceId: currentNamespaceId,
      page,
      textSelected,
      rects,
      annotationText: null,
      color: HIGHLIGHT_COLOR,
      textStart,
      textEnd,
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
      const cr = r;
      const div = document.createElement('div');
      div.className = 'highlight-rect';
      if (ann.annotationText) div.classList.add('has-note');
      div.dataset.annId = ann.id;
      div.dataset.rectIdx = idx;
      div.style.left = (cr.x * 100) + '%';
      div.style.top = (cr.y * 100) + '%';
      div.style.width = (cr.width * 100) + '%';
      div.style.height = (cr.height * 100) + '%';
      const baseTitle = ann.annotationText || ann.textSelected.slice(0, 80);
      if (document.body.classList.contains('debug-text')) {
        div.title = `[${r.x.toFixed(3)},${r.y.toFixed(3)} ${r.width.toFixed(3)}×${r.height.toFixed(3)}] → [${cr.x.toFixed(3)},${cr.y.toFixed(3)} ${cr.width.toFixed(3)}×${cr.height.toFixed(3)}] ${baseTitle}`;
      } else {
        div.title = baseTitle;
      }
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditorFor(ann.id, e.clientX, e.clientY);
      });
      layer.appendChild(div);
    });
  }

  function redrawPage(pageNumber) {
    const wrapper = PDFViewer.getPageWrapper(pageNumber);
    if (!wrapper) return;
    const layer = wrapper.querySelector('.highlight-layer');
    if (!layer) return;
    // Clear ALL existing rects first (removes annotations from previous namespace)
    layer.innerHTML = '';
    // Draw current annotations for this page
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

  /* ---------- Adjust selection (expand or shrink by one word) ---------- */
  async function onAdjustSelection(action, direction) {
    if (activeAnnotationId == null) return;
    const ann = byId.get(activeAnnotationId);
    if (!ann) return;

    // Build page text index
    const tc = await PDFViewer.getTextContent(ann.page);
    if (!tc) return;
    const idx = TextGeometry.buildIndex(tc);

    const snippet = ann.textSelected || '';
    if (!snippet.trim()) return;

    // Use stored char offsets when available (pinpoints the exact occurrence).
    // Fall back to findSnippetRange for legacy annotations without offsets.
    let start, end;
    if (ann.textStart != null && ann.textEnd != null) {
      start = ann.textStart;
      end = ann.textEnd;
    } else {
      const range = TextGeometry.findSnippetRange(idx, snippet);
      if (!range) return;
      start = range.start;
      end = range.end;
    }

    let newStart = start;
    let newEnd = end;

    if (action === 'expand') {
      if (direction === 'left') {
        // Move start left: skip whitespace, then include the previous word
        let s = newStart;
        while (s > 0 && /\s/.test(idx.full[s - 1])) s--;
        while (s > 0 && !/\s/.test(idx.full[s - 1])) s--;
        if (s < newStart) newStart = s;
      } else {
        // Move end right: skip whitespace, then include the next word
        let e = newEnd;
        while (e < idx.full.length && /\s/.test(idx.full[e])) e++;
        while (e < idx.full.length && !/\s/.test(idx.full[e])) e++;
        if (e > newEnd) newEnd = e;
      }
    } else { // shrink
      if (direction === 'left') {
        // Move start right: remove the first word of the current selection
        let s = newStart;
        while (s < newEnd && /\s/.test(idx.full[s])) s++;       // skip leading whitespace
        while (s < newEnd && !/\s/.test(idx.full[s])) s++;      // skip the word
        while (s < newEnd && /\s/.test(idx.full[s])) s++;       // skip trailing whitespace
        // Only apply if at least one word remains
        if (s > newStart && s < newEnd) newStart = s;
      } else {
        // Move end left: remove the last word of the current selection
        let e = newEnd;
        while (e > newStart && /\s/.test(idx.full[e - 1])) e--; // skip trailing whitespace
        while (e > newStart && !/\s/.test(idx.full[e - 1])) e--; // skip the word
        while (e > newStart && /\s/.test(idx.full[e - 1])) e--; // skip leading whitespace
        // Only apply if at least one word remains
        if (e < newEnd && e > newStart) newEnd = e;
      }
    }

    // Nothing changed (already at boundary or can't shrink further)
    if (newStart === start && newEnd === end) return;

    // Extract the new text
    const newText = idx.full.slice(newStart, newEnd).trim();
    if (!newText || newText === ann.textSelected) return;

    // Recalculate rects for the adjusted range
    const baseVp = PDFViewer.getBaseViewport(ann.page);
    if (!baseVp) return;
    const vp = baseVp.clone({ scale: PDFViewer.getScale() });
    const spanMap = PDFViewer.getSpanMap(ann.page);
    const newRects = TextGeometry.rangeToRects(idx, newStart, newEnd, vp, spanMap);
    if (!newRects.length) return;

    // Update annotation (including stored offsets for next adjust)
    ann.textSelected = newText;
    ann.rects = newRects;
    ann.textStart = newStart;
    ann.textEnd = newEnd;
    ann.updatedAt = Date.now();

    // Persist and redraw
    if (callbacks.updateAnnotation) await callbacks.updateAnnotation(ann);
    refreshAnnotation(ann);
    if (callbacks.annotationChanged) callbacks.annotationChanged();
  }

  function redrawAll() {
    const n = PDFViewer.getNumPages();
    for (let i = 1; i <= n; i++) redrawPage(i);
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
    redrawAll,
    callbacks,
  };
})();
