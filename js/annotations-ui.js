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
    allAnnotations = annotations.slice().sort((a, b) =>
      a.page - b.page || a.createdAt - b.createdAt);
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
      li.textContent = 'No matches.';
      listEl.appendChild(li);
      return;
    }

    items.forEach((ann) => {
      const li = document.createElement('li');
      li.className = 'annotation-item';
      li.dataset.annId = ann.id;

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

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = 'Delete';
      del.style.marginTop = '8px';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (callbacks.onDelete) callbacks.onDelete(ann.id);
      });
      li.appendChild(del);

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

  return { init, render, callbacks };
})();
