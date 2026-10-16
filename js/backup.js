/* ============================================================
   backup.js — full-data backup as a dependency-free ZIP,
   restore from that zip (or plain JSON), and a 7-day reminder.
   ZIP uses the STORE method (no compression), so no libraries
   are needed to write or read it.
   Exposes global: Backup
   ============================================================ */
const Backup = (() => {
  const LAST_BACKUP_KEY = 'pdf-ann-last-backup-at';
  const REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const PAYLOAD_VERSION = 1;

  /* ---------- CRC32 (for the ZIP STORE format) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- Minimal ZIP writer (STORE only) ---------- */
  function buildZip(entries) {
    const now = new Date();
    const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) |
      ((Math.floor(now.getSeconds() / 2)) & 0x1f);
    const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) |
      (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

    const chunks = [];
    const central = [];
    let offset = 0;

    entries.forEach((entry) => {
      const nameBytes = new TextEncoder().encode(entry.name);
      const crc = crc32(entry.data);
      const size = entry.data.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // local file header signature
      lv.setUint16(4, 20, true);           // version needed
      lv.setUint16(6, 0, true);            // flags
      lv.setUint16(8, 0, true);            // method: STORE
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);        // compressed size
      lv.setUint32(22, size, true);        // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);           // extra field length
      local.set(nameBytes, 30);
      chunks.push(local, entry.data);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);   // central directory signature
      cv.setUint16(4, 20, true);           // version made by
      cv.setUint16(6, 20, true);           // version needed
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);           // method: STORE
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);           // extra length
      cv.setUint16(32, 0, true);           // comment length
      cv.setUint16(34, 0, true);           // disk number start
      cv.setUint16(36, 0, true);           // internal attrs
      cv.setUint32(38, 0, true);           // external attrs
      cv.setUint32(42, offset, true);      // local header offset
      cen.set(nameBytes, 46);
      central.push(cen);

      offset += local.length + size;
    });

    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);     // EOCD signature
    ev.setUint16(4, 0, true);              // disk number
    ev.setUint16(6, 0, true);              // central dir start disk
    ev.setUint16(8, entries.length, true); // entries on this disk
    ev.setUint16(10, entries.length, true);// total entries
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);        // central dir offset
    ev.setUint16(20, 0, true);             // comment length

    return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
  }

  /* ---------- Minimal ZIP reader (STORE only, our own zips) ---------- */
  function readZipEntryText(bytes) {
    // Locate the End Of Central Directory record (scan the last ~64KB)
    let eocd = -1;
    const minPos = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a valid backup zip (no zip directory found)');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entryCount = dv.getUint16(eocd + 10, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();

    let pos = cdOffset;
    let candidate = null;
    for (let e = 0; e < entryCount; e++) {
      if (pos + 46 > bytes.length || dv.getUint32(pos, true) !== 0x02014b50) {
        throw new Error('Not a valid backup zip (corrupt central directory)');
      }
      const method = dv.getUint16(pos + 10, true);
      const compSize = dv.getUint32(pos + 20, true);
      const nameLen = dv.getUint16(pos + 28, true);
      const extraLen = dv.getUint16(pos + 30, true);
      const commentLen = dv.getUint16(pos + 32, true);
      const localOffset = dv.getUint32(pos + 42, true);
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      if (!candidate && name.toLowerCase().endsWith('.json')) {
        candidate = { name, method, compSize, localOffset };
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    if (!candidate) throw new Error('No backup data (.json) found inside the zip');
    if (candidate.method !== 0) {
      throw new Error('This zip uses compression — only backups created by this app (uncompressed) are supported');
    }

    // Read the local header to find where the data starts
    const lo = candidate.localOffset;
    if (lo + 30 > bytes.length || dv.getUint32(lo, true) !== 0x04034b50) {
      throw new Error('Not a valid backup zip (corrupt local header)');
    }
    const lNameLen = dv.getUint16(lo + 26, true);
    const lExtraLen = dv.getUint16(lo + 28, true);
    const dataStart = lo + 30 + lNameLen + lExtraLen;
    if (dataStart + candidate.compSize > bytes.length) {
      throw new Error('Not a valid backup zip (truncated data)');
    }
    return decoder.decode(bytes.subarray(dataStart, dataStart + candidate.compSize));
  }

  /* ---------- Payload helpers ---------- */
  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid backup file: expected a JSON object');
    }
    if (typeof payload.version !== 'number') {
      throw new Error('Invalid backup file: missing "version" field (not created by this app?)');
    }
    ['namespaces', 'annotations', 'pdfs'].forEach((k) => {
      if (!Array.isArray(payload[k])) {
        throw new Error('Invalid backup file: "' + k + '" is not an array');
      }
    });
  }

  function backupFileName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return 'pdf-annotations-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) +
      '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  }

  async function createBackupPayload() {
    const namespaces = await Storage.getAllNamespaces();
    const annotations = await Storage.getAllAnnotations();
    const pdfs = await Storage.getAllPdfMeta();
    return { version: PAYLOAD_VERSION, exportedAt: Date.now(), namespaces, annotations, pdfs };
  }

  /**
   * Build the backup zip as a Blob (single .json entry, STORE method).
   */
  async function createBackupBlob() {
    const payload = await createBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    const data = new TextEncoder().encode(json);
    return buildZip([{ name: backupFileName(), data }]);
  }

  /**
   * Save a full backup. Prefers showSaveFilePicker (Chrome/Edge — the user
   * picks any folder); falls back to a download-anchor blob URL.
   * User-cancel (AbortError) is a silent no-op. The "last backup" timestamp
   * is only updated when the file is actually saved.
   * @returns {Promise<boolean>} true only when saved
   */
  async function saveBackup() {
    let blob;
    try {
      blob = await createBackupBlob();
    } catch (err) {
      console.error('Backup creation failed', err);
      return false;
    }
    const suggested = backupFileName().replace(/\.json$/, '') + '.zip';

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: 'ZIP backup', accept: { 'application/zip': ['.zip'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        markBackedUp();
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return false; // user cancelled
        console.error('showSaveFilePicker failed, using download fallback', err);
        // fall through to the download fallback
      }
    }

    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggested;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      markBackedUp();
      return true;
    } catch (err) {
      console.error('Backup download failed', err);
      return false;
    }
  }

  /**
   * Parse a backup from a File. Accepts a .zip (created by this app) or a
   * plain .json payload. Throws with a clear message for foreign zips.
   * @returns {Promise<object>} validated payload
   */
  async function parseBackupFile(file) {
    const name = (file.name || '').toLowerCase();
    let text;
    if (name.endsWith('.zip')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      text = readZipEntryText(bytes);
    } else {
      text = await file.text();
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw new Error('Backup file contains invalid JSON');
    }
    validatePayload(payload);
    return payload;
  }

  /**
   * Restore a payload by upserting every record by id (idempotent —
   * safe to re-import the same backup).
   * @returns {Promise<{namespaces:number, annotations:number, pdfs:number}>} counts
   */
  async function restore(payload) {
    validatePayload(payload);
    const counts = { namespaces: 0, annotations: 0, pdfs: 0 };
    for (const ns of payload.namespaces) {
      if (!ns || !ns.id) continue;
      await Storage.updateNamespace(ns);
      counts.namespaces++;
    }
    for (const a of payload.annotations) {
      if (!a || !a.id || !a.rects || typeof a.page !== 'number') continue;
      await Storage.updateAnnotation(a);
      counts.annotations++;
    }
    for (const m of payload.pdfs) {
      if (!m || !m.pdfId) continue;
      await Storage.savePdfMeta(m);
      counts.pdfs++;
    }
    return counts;
  }

  /* ---------- 7-day reminder state ---------- */
  function markBackedUp() {
    try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  function getLastBackupAt() {
    try {
      const v = parseInt(localStorage.getItem(LAST_BACKUP_KEY), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) { return 0; }
  }

  /** True when a reminder should be shown (never backed up, or > 7 days ago). */
  function isReminderDue() {
    const last = getLastBackupAt();
    if (!last) return true;
    return Date.now() - last > REMINDER_INTERVAL_MS;
  }

  return {
    createBackupBlob,
    saveBackup,
    parseBackupFile,
    restore,
    markBackedUp,
    getLastBackupAt,
    isReminderDue,
  };
})();
