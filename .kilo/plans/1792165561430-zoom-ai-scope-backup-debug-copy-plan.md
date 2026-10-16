# Plan: Zoom blank-page fix · AI scope "highlight → next highlight" · Full backup (zip) with 7-day reminder · Debug response copy button

## Goal
Four independent improvements to the client-side PDF annotations app (plain browser JS, no build step, no dependencies):

1. **Zoom blank-page fix** — after changing zoom, pages sometimes stay white until navigating away/back.
2. **New AI context scope** — send `$text` = from the *last clicked highlight* up to (not including) the *next highlight*, continuing across pages when there is no next highlight on the same page.
3. **Trustworthy backup** — full-data backup as a **zip** the user saves anywhere on disk, a **restore** from that zip, and a **reminder every 7 days** that stops once a backup is made (timestamp persisted).
4. **Copy Debug AI response** — a button next to each AI response entry in the Debug log that copies the response text to the clipboard.

## Resolved decisions (user-confirmed)
- Anchor highlight = **last clicked highlight** (clicked in the PDF or in the Annotations side panel). If none clicked since load, fall back to entire current page text.
- No next highlight after the anchor → **continue into following pages** until the next highlight (or end of document).
- Debug copy = **a button near each response entry** in the Debug log copying that response's text (not the whole log).

## Out of scope
- Silent/scheduled backups to arbitrary disk paths (browsers forbid writing without a save dialog).
- Compressed ZIP (use ZIP STORE method — uncompressed but valid zip, zero dependencies).
- IndexedDB schema changes (backup uses `getAll()`, no DB version bump).
- Automated tests (user tests manually, per AGENTS.md).

---

## Task 1 — Zoom blank-page fix (`js/pdf-viewer.js`)

**Root cause:** `setScale()` (js/pdf-viewer.js:201) blanks every canvas (`canvas.width = 0`, clears layers) immediately, then re-renders async. Superseded in-flight `page.render()` tasks are abandoned, never cancelled; a second `page.render()` on the same canvas while the first is active fails ("same canvas during multiple render() operations"), the catch swallows it, and the page stays white.

Changes:
1. Track the active render task per page (`const activeRenderTasks = new Map()`).
2. In `renderPage()` (js/pdf-viewer.js:112): before starting a new render for a page, if a previous task exists → `task.cancel()` and `await task.promise` (swallow `RenderingCancelledException`). Store the new `renderTask` in the map; delete the entry when it settles. On stale-generation exits (`myGen !== currentGen`), cancel the task before returning.
3. In `setScale()`: stop zeroing canvases and clearing `.textLayer`/`.highlight-layer` (lines 214–217). Instead set `canvas.style.width/height` to the new size so the old bitmap shows as a scaled preview until replaced. Text/highlight layers are already cleared inside `renderPage()`/`onPageRendered` at re-render time.
4. Self-healing pass: after the existing `requestAnimationFrame` re-render loop + `goToPage(visiblePage)` in `setScale()`, add a debounced post-scroll check (e.g. ~250 ms timeout, reset on scroll) that calls `renderPage(i)` for any page intersecting the viewport whose `renderedGen[i] !== currentGen`.
5. In `renderPage()`'s catch: if the error mentions canvas-in-use / render conflict, schedule one retry via `setTimeout(() => renderPage(pageNumber), 0)`.

## Task 2 — AI context scope "Current highlight → next highlight"

Files: `index.html`, `js/i18n.js`, `js/ai-panel.js`, `js/app.js`.

1. **`index.html`** (`#aiContextScope`, line ~178): add option `value="untilNextHighlight"` with `data-i18n="ai.scope.untilNextHighlight"`.
2. **`js/i18n.js`**: add keys (en + pt-BR):
   - `ai.scope.untilNextHighlight`: "Current highlight → next highlight" / "Highlight atual → próximo highlight"
   - `ai.status.noAnchorHighlight`: hint shown when no highlight was clicked (falls back to page text).
3. **`js/app.js`**:
   - Track `lastClickedAnnotationId`: set it in `Highlighter.callbacks.onAnnotationClicked` (app.js:110) and in `AnnotationsUI.callbacks.onJump` (app.js:138). Clear on PDF load / namespace switch.
   - Implement new `AIPanel.callbacks.getHighlightSpan = async (ann) => ({ text, pages, label })`:
     - Resolve anchor offsets: `ann.textStart/textEnd`; if null (legacy), `TextGeometry.findSnippetRange(TextGeometry.buildIndex(await PDFViewer.getTextContent(ann.page)), ann.textSelected)`; if still unresolvable → return null (caller falls back).
     - Build ordered candidates from `currentAnnotations` with resolved `(page, start)` (same fallback per annotation; skip unresolvable ones). Next highlight = first candidate lexicographically after `(anchorPage, anchorEnd)`.
     - Slice text: anchor page `idx.full.slice(anchorEnd, hasNext ? nextStart : end)`; intermediate pages full text; final page `slice(0, nextStart)`. Use `getPageText()`-style indexing per page (`TextGeometry.buildIndex(await PDFViewer.getTextContent(p))`).
     - Assemble like the existing multi-page scope: `parts.push('--- Page ' + p + ' ---\n' + slice)`, `pages = [{page, text: slice}]`, `text = parts.join('\n\n')`. Label e.g. `"Highlights p.3→7"`.
4. **`js/ai-panel.js` `gatherContext()`** (js/ai-panel.js:257): handle `untilNextHighlight` — call `callbacks.getHighlightSpan(anchor)`; on success return `{ text, pages }` (queue label from `label`); on failure/no anchor set status hint `ai.status.noAnchorHighlight` and fall through to entire-page logic.
   - Note: Auto-Annotate with this scope gets `pages: []`-like behavior only if span is single-page; simplest correct approach — `getHighlightSpan` always returns a populated `pages` array, so Auto-Annotate/mindmap iterate those page slices naturally (existing `onAutoRun`/`buildMindmapIterations` handle `pages` already).

## Task 3 — Full backup (zip) + restore + 7-day reminder

Files: new `js/backup.js` (expose global `Backup`), `js/storage.js`, `index.html`, `js/app.js`, `css/styles.css`, `js/i18n.js`, `README.md` (architecture table row + feature blurb).

1. **`js/storage.js`**: add `getAllAnnotations()`, `getAllNamespaces()`, `getAllPdfMeta()` (plain `getAll()` on each store; no schema change).
2. **`js/backup.js`** (vanilla, ~200 lines):
   - `createBackupBlob()`: gather `{ version: 1, exportedAt, namespaces, annotations, pdfs }` via Storage getters → `JSON.stringify(payload, null, 2)` → single ZIP entry `pdf-annotations-backup-<YYYY-MM-DD-HHmm>.json` (STORE method: CRC32 table + local file header + central directory + EOCD; standard minimal zip writer, no compression).
   - `saveBackup()`: prefer `window.showSaveFilePicker` (Chrome/Edge — lets user pick any disk folder; `suggestedName: *.zip`, `application/zip`); fallback to `<a download>` blob URL. Treat user-cancel (`AbortError`) as no-op. Return `true` only when saved.
   - `parseBackupFile(file)`: accept `.json` directly, or `.zip` — minimal ZIP reader (locate EOCD → central directory → read STORE entries; find the `*.json` entry). Return parsed payload; validate `version` and array fields.
   - `restore(payload)`: upsert by `id` — namespaces via `updateNamespace`, annotations via `updateAnnotation`, pdfs via `savePdfMeta` (idempotent, safe to re-import). Return counts.
3. **Reminder state**: `localStorage` key `pdf-ann-last-backup-at` (ms timestamp). `Backup` also exposes `markBackedUp()` / `isReminderDue()`.
4. **`index.html` + `js/app.js`**:
   - Add a **Backup** button to the `#dataGroup` toolbar group (visible with a loaded PDF; also fine to always show next to Export/Import) and an `<input type="file" id="restoreInput" accept=".zip,.json" hidden>` + **Restore** button.
   - On app load (after `Storage.openDB()` resolves): if any annotations/namespaces exist AND `now - lastBackupAt > 7 days` → show a small non-blocking banner/modal (reuse settings-modal styling pattern): "N days since your last backup" + **[Backup now]** (runs `saveBackup()`, sets timestamp on success, toast) and **[Later]** (dismiss; asks again next app load). Never re-ask within the session after dismissal.
   - After successful **Restore**: reload namespaces/annotations for `currentPdfId` (re-run namespace selection + `redrawVisiblePages()`), toast counts.
5. **`css/styles.css`**: banner styles + small toolbar button (mirror existing `.file-btn`/`.settings-modal` patterns).
6. **`js/i18n.js`**: keys for backup button, restore, reminder title/body/buttons, success/failure toasts (en + pt-BR).
7. **`index.html`**: add `<script src="js/backup.js">` after `storage.js` (load order matters — keep before `app.js`).

## Task 4 — Copy button for Debug AI responses

Files: `js/ai-panel.js`, `css/styles.css`, `js/i18n.js`.

1. In `debugLog()` (js/ai-panel.js:832): when `category === 'RESP'` and `data` is a string, append a small copy button (`.debug-copy-btn`, title `ai.debugCopy`) to the entry.
2. Click handler: copy `data` via `navigator.clipboard.writeText` with the existing `execCommand('copy')` fallback (copy the same helper out of `copyResponse()` into a shared `copyTextToClipboard(text, btn)` with the ✓ feedback). Brief ✓ state on success.
3. `css/styles.css`: compact icon-button style aligned right in `.debug-entry`.
4. `js/i18n.js`: `ai.debugCopy`: "Copy response" / "Copiar resposta".

---

## Validation (user performs manually)
1. **Zoom**: open a PDF, hammer zoom +/- (incl. rapid clicks and Ctrl +/=), scroll after zoom → no white pages; old content scales as preview until re-render.
2. **Scope**: click a highlight, set scope "Current highlight → next highlight", Send → check Debug `BODY` prompt contains exactly the span (anchor end → next highlight start); repeat with anchor being the last highlight (spans following pages); with no highlight clicked (falls back to page + hint).
3. **Backup**: Backup → pick location, open zip (contains one JSON with all namespaces/annotations); clear site data → Restore zip → highlights reappear; re-import same zip (idempotent). Set `pdf-ann-last-backup-at` to 8 days ago + reload → reminder shows; Backup now → reminder won't reappear for 7 days; Later → stays dismissed this session.
4. **Debug copy**: run a prompt, expand Debug → copy button on RESP entry copies response text (verify also from `file://` where the execCommand fallback path runs).

## Risks
- `renderTask.cancel()` must be awaited before re-rendering the same canvas (handle `RenderingCancelledException`).
- ZIP reader supports only STORE-method zips (our own) + plain JSON; foreign zips → clear error toast.
- Legacy annotations without `textStart/textEnd` rely on `findSnippetRange` and may mislocate → span boundaries approximate for those only.
- Clipboard on non-secure contexts needs the `execCommand` fallback (pattern already in `copyResponse()`).
