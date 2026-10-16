/* ============================================================
   storage.js — IndexedDB wrapper for annotations + namespaces
   Exposes global: Storage
   ============================================================ */
const Storage = (() => {
  const DB_NAME = 'pdfAnnotationsDB';
  const DB_VERSION = 2;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;

        // --- Annotations store ---
        if (!db.objectStoreNames.contains('annotations')) {
          const ann = db.createObjectStore('annotations', { keyPath: 'id' });
          ann.createIndex('by_pdf', 'pdfId', { unique: false });
          ann.createIndex('by_pdf_page', ['pdfId', 'page'], { unique: false });
          ann.createIndex('by_namespace', 'namespaceId', { unique: false });
          ann.createIndex('by_namespace_page', ['namespaceId', 'page'], { unique: false });
        } else {
          // Upgrade from v1: add namespace indexes
          const ann = tx.objectStore('annotations');
          if (!ann.indexNames.contains('by_namespace')) {
            ann.createIndex('by_namespace', 'namespaceId', { unique: false });
          }
          if (!ann.indexNames.contains('by_namespace_page')) {
            ann.createIndex('by_namespace_page', ['namespaceId', 'page'], { unique: false });
          }
        }

        // --- Namespaces store ---
        if (!db.objectStoreNames.contains('namespaces')) {
          const ns = db.createObjectStore('namespaces', { keyPath: 'id' });
          ns.createIndex('by_pdf', 'pdfId', { unique: false });
        }

        // --- PDFs metadata store (kept for backward compat) ---
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

  /* ---------- Namespaces CRUD ---------- */
  async function createNamespace(ns) {
    const s = await store('namespaces', 'readwrite');
    return p(s.add(ns));
  }
  async function updateNamespace(ns) {
    const s = await store('namespaces', 'readwrite');
    return p(s.put(ns));
  }
  async function deleteNamespace(id) {
    const s = await store('namespaces', 'readwrite');
    return p(s.delete(id));
  }
  async function getNamespace(id) {
    const s = await store('namespaces', 'readonly');
    return p(s.get(id));
  }
  async function getNamespacesByPdf(pdfId) {
    const s = await store('namespaces', 'readonly');
    return p(s.index('by_pdf').getAll(IDBKeyRange.only(pdfId)));
  }

  /**
   * Delete a namespace AND all its annotations.
   */
  async function deleteNamespaceAndAnnotations(namespaceId) {
    const db = await openDB();
    const tx = db.transaction(['namespaces', 'annotations'], 'readwrite');
    // Delete namespace
    tx.objectStore('namespaces').delete(namespaceId);
    // Delete all annotations in this namespace
    const annStore = tx.objectStore('annotations');
    const idx = annStore.index('by_namespace');
    return new Promise((resolve, reject) => {
      const req = idx.openCursor(IDBKeyRange.only(namespaceId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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
  async function getAnnotationsByNamespace(namespaceId) {
    const s = await store('annotations', 'readonly');
    return p(s.index('by_namespace').getAll(IDBKeyRange.only(namespaceId)));
  }
  async function getAnnotationsByNamespacePage(namespaceId, page) {
    const s = await store('annotations', 'readonly');
    return p(s.index('by_namespace_page').getAll(IDBKeyRange.only([namespaceId, page])));
  }
  // Legacy methods (kept for migration / backward compat)
  async function getAnnotationsByPdf(pdfId) {
    const s = await store('annotations', 'readonly');
    return p(s.index('by_pdf').getAll(IDBKeyRange.only(pdfId)));
  }
  async function getAnnotationsByPage(pdfId, page) {
    const s = await store('annotations', 'readonly');
    return p(s.index('by_pdf_page').getAll(IDBKeyRange.only([pdfId, page])));
  }

  /**
   * Migrate old annotations (with pdfId but no namespaceId) into a namespace.
   * Creates a "Migrated" namespace if needed and assigns namespaceId to each.
   * Returns the namespace created/used, or null if nothing to migrate.
   */
  async function migrateOldAnnotations(pdfId, pdfName) {
    const old = await getAnnotationsByPdf(pdfId);
    const needsMigration = old.filter((a) => !a.namespaceId);
    if (needsMigration.length === 0) return null;

    // Create a namespace for the old annotations
    const ns = {
      id: 'ns_' + uuid(),
      name: 'default',
      pdfId,
      pdfName: pdfName || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await createNamespace(ns);

    // Assign namespaceId to each old annotation
    for (const ann of needsMigration) {
      ann.namespaceId = ns.id;
      ann.updatedAt = Date.now();
      await updateAnnotation(ann);
    }
    return ns;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
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

  /* ---------- Bulk reads (used by Backup) ---------- */
  async function getAllAnnotations() {
    const s = await store('annotations', 'readonly');
    return p(s.getAll());
  }
  async function getAllNamespaces() {
    const s = await store('namespaces', 'readonly');
    return p(s.getAll());
  }
  async function getAllPdfMeta() {
    const s = await store('pdfs', 'readonly');
    return p(s.getAll());
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
    // Namespaces
    createNamespace, updateNamespace, deleteNamespace, getNamespace,
    getNamespacesByPdf, deleteNamespaceAndAnnotations, migrateOldAnnotations,
    // Annotations
    addAnnotation, updateAnnotation, deleteAnnotation,
    getAnnotationsByNamespace, getAnnotationsByNamespacePage,
    getAnnotationsByPdf, getAnnotationsByPage,
    // PDF metadata
    savePdfMeta, getPdfMeta,
    // Bulk reads
    getAllAnnotations, getAllNamespaces, getAllPdfMeta,
    hashFile,
  };
})();
