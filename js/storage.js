/* ============================================================
   storage.js — IndexedDB wrapper for annotations + PDF metadata
   Exposes global: Storage
   ============================================================ */
const Storage = (() => {
  const DB_NAME = 'pdfAnnotationsDB';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('annotations')) {
          const ann = db.createObjectStore('annotations', { keyPath: 'id' });
          ann.createIndex('by_pdf', 'pdfId', { unique: false });
          ann.createIndex('by_pdf_page', ['pdfId', 'page'], { unique: false });
        }
        if (!db.objectStoreNames.contains('pdfs')) {
          db.createObjectStore('pdfs', { keyPath: 'pdfId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function store(name, mode) {
    return openDB().then(db => db.transaction(name, mode).objectStore(name));
  }

  function p(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- Annotations CRUD ---------- */
  async function addAnnotation(ann) {
    const s = await store('annotations', 'readwrite');
    return p(s.add(ann));
  }
  async function updateAnnotation(ann) {
    const s = await store('annotations', 'readwrite');
    return p(s.put(ann));
  }
  async function deleteAnnotation(id) {
    const s = await store('annotations', 'readwrite');
    return p(s.delete(id));
  }
  async function getAnnotationsByPdf(pdfId) {
    const s = await store('annotations', 'readonly');
    return p(s.index('by_pdf').getAll(IDBKeyRange.only(pdfId)));
  }
  async function getAnnotationsByPage(pdfId, page) {
    const s = await store('annotations', 'readonly');
    return p(s.index('by_pdf_page').getAll(IDBKeyRange.only([pdfId, page])));
  }

  /* ---------- PDF metadata ---------- */
  async function savePdfMeta(meta) {
    const s = await store('pdfs', 'readwrite');
    return p(s.put(meta));
  }
  async function getPdfMeta(pdfId) {
    const s = await store('pdfs', 'readonly');
    return p(s.get(pdfId));
  }

  /* ---------- Stable PDF id via SHA-256 (with file:// fallback) ---------- */
  async function hashFile(file) {
    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        const buf = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', buf);
        return 'sha256:' + [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {
      console.warn('crypto.subtle unavailable, using fallback id', e);
    }
    // Fallback: deterministic id from name + size + modified (no crypto needed)
    return 'file:' + (file.name || 'unknown') + ':' + file.size + ':' + (file.lastModified || 0);
  }

  return {
    openDB,
    addAnnotation, updateAnnotation, deleteAnnotation,
    getAnnotationsByPdf, getAnnotationsByPage,
    savePdfMeta, getPdfMeta,
    hashFile,
  };
})();
