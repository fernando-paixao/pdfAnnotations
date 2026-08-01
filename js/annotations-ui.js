/* ============================================================
   annotations-ui.js — side panel list of annotations.
   Exposes global: AnnotationsUI
   ============================================================ */
const AnnotationsUI = (() => {
  let listEl = null;
  let countEl = null;
  let searchEl = null;
  let emptyEl = null;
  let allAnnotations = [];
  let filter = '';

  const callbacks = {
    onJump: null,   // (id)
    onDelete: null, // (id)
  };

  function init(list, count, search, empty) {
    listEl = list;
    countEl = count;
    searchEl = search;
    emptyEl = empty;
    searchEl.addEventListener('input', () => {
      filter = searchEl.value.trim().toLowerCase();
      renderList();
    });
  }

  function render(annotations) {
    allAnnotations = annotations.slice().sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      // Same page: sort by text position (character offset in page text)
      if (a.textStart != null && b.textStart != null) return a.textStart - b.textStart;
      // Fallback for legacy annotations without textStart: use vertical position
      const ay = a.rects && a.rects[0] ? a.rects[0].y : 0;
      const by = b.rects && b.rects[0] ? b.rects[0].y : 0;
      if (ay !== by) return ay - by;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    countEl.textContent = allAnnotations.length;
    searchEl.hidden = allAnnotations.length === 0;
    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    const items = allAnnotations.filter((a) => {
      if (!filter) return true;
      return (a.textSelected || '').toLowerCase().includes(filter) ||
             (a.annotationText || '').toLowerCase().includes(filter);
    });

    emptyEl.style.display = allAnnotations.length === 0 ? 'block' : 'none';
    if (allAnnotations.length > 0 && items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-annotations';
      li.textContent = I18N.t('panel.noMatches');
      listEl.appendChild(li);
      return;
    }

    items.forEach((ann) => {
      const li = document.createElement('li');
      li.className = 'annotation-item';
      li.dataset.annId = ann.id;

      // Tooltip with the full selected text on hover
      li.title = ann.textSelected || '';

      const meta = document.createElement('div');
      meta.className = 'meta';
      const pageTag = document.createElement('span');
      pageTag.className = 'page-tag';
      pageTag.textContent = 'p.' + ann.page;
      const date = document.createElement('span');
      date.textContent = formatDate(ann.updatedAt || ann.createdAt);
      meta.appendChild(pageTag);
      meta.appendChild(date);

      const sel = document.createElement('div');
      sel.className = 'selected-text';
      sel.textContent = ann.textSelected;

      li.appendChild(meta);
      li.appendChild(sel);

      if (ann.annotationText) {
        const note = document.createElement('div');
        note.className = 'note-text';
        note.textContent = '📝 ' + ann.annotationText;
        li.appendChild(note);
      }

      // Action buttons row
      const actions = document.createElement('div');
      actions.className = 'annotation-actions';

      const copy = document.createElement('button');
      copy.className = 'copy-btn';
      copy.title = I18N.t('panel.copyText');
      copy.textContent = '📋';
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        var text = ann.textSelected || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            copy.textContent = '✓';
            copy.classList.add('copied');
            setTimeout(() => { copy.textContent = '📋'; copy.classList.remove('copied'); }, 1500);
          }).catch(() => {});
        } else {
          // Fallback for older browsers
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e2) {}
          ta.remove();
          copy.textContent = '✓';
          copy.classList.add('copied');
          setTimeout(() => { copy.textContent = '📋'; copy.classList.remove('copied'); }, 1500);
        }
      });
      actions.appendChild(copy);

      // Google Search button
      const googleSearch = document.createElement('button');
      googleSearch.className = 'copy-btn';
      googleSearch.title = I18N.t('panel.googleSearch');
      googleSearch.textContent = '🔍';
      googleSearch.addEventListener('click', (e) => {
        e.stopPropagation();
        const q = encodeURIComponent(ann.textSelected || '');
        window.open('https://www.google.com/search?q=' + q, '_blank', 'noopener');
      });
      actions.appendChild(googleSearch);

      // Google Images button
      const googleImages = document.createElement('button');
      googleImages.className = 'copy-btn';
      googleImages.title = I18N.t('panel.googleImages');
      googleImages.textContent = '🖼️';
      googleImages.addEventListener('click', (e) => {
        e.stopPropagation();
        const q = encodeURIComponent(ann.textSelected || '');
        window.open('https://www.google.com/search?tbm=isch&q=' + q, '_blank', 'noopener');
      });
      actions.appendChild(googleImages);

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = I18N.t('editor.delete');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (callbacks.onDelete) callbacks.onDelete(ann.id);
      });
      actions.appendChild(del);

      li.appendChild(actions);

      li.addEventListener('click', () => {
        if (callbacks.onJump) callbacks.onJump(ann.id);
      });

      listEl.appendChild(li);
    });
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToAnnotation(id) {
    const item = listEl.querySelector('[data-ann-id="' + id + '"]');
    if (item) {
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Briefly flash the item to draw attention
      item.classList.add('flash-item');
      setTimeout(() => item.classList.remove('flash-item'), 1000);
    }
  }

  return { init, render, scrollToAnnotation, callbacks };
})();
