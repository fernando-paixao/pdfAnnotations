# PDF Annotations

A 100% client-side browser app to load local PDFs, highlight text, add annotations,
search the full document, and use a local Ollama AI to summarize or auto-annotate.

**No server. No external API. Works offline.**

## Quick Start

### Option A — Local server (recommended)
```bash
# From the project folder, any static server works:
python -m http.server 8123
# then open http://localhost:8123
```

### Option B — Open the file directly
Open `index.html` in your browser. PDF.js falls back to a main-thread worker (slower).

## Features

### Highlight & Annotate
1. Click **Open PDF** and pick a local `.pdf` file.
2. Select text → a **Highlight** button appears → click it.
3. A note editor opens — add an optional note and **Save**.
4. Highlights are stored in **IndexedDB** and re-drawn at the exact location when you reopen the same PDF.

### Find in PDF (full-text search)
- Type in the search box (or press **Ctrl/Cmd+F**).
- **Enter** = next match, **Shift+Enter** = previous, **Esc** = clear.

### AI Assistant (local Ollama)
Two AI features that call a **local Ollama** instance directly from the browser:

#### 1. Prompt Panel
- Click the **AI** button in the toolbar to open the panel.
- Configure: host (default `http://localhost:11434`), model, max tokens, context window.
- Write a prompt template using **`$text`** as the placeholder for PDF context.
- Choose the **context scope**:
  - `Selected text` — the current text selection
  - `Entire current page` — all text on the visible page
  - `Multiple pages` — current page + N pages
  - `Current highlight → next highlight` — from the last clicked highlight (its text
    included) up to — not including — the next one, continuing across pages. Set
    **Number of highlights ahead** to cross several highlights in one send, or leave
    it empty to run until the end of the document (handy for summarizing a book in parts).
- Click **Send** — the response streams into the panel.

#### 2. Auto-Annotate
- In the AI panel, open the **Auto-Annotate** section.
- Set **Desired annotations** (leave empty to let the AI decide).
- Toggle **Include notes** (on = AI returns a short note per passage; off = snippets only).
- Click **Annotate** — the AI identifies important passages, the app matches them to the
  page text, and creates highlight annotations automatically (green tint).

### Full Backup & Restore
- Click **Backup** in the toolbar to save **all** namespaces, annotations, and PDF
  metadata — across every PDF — as a single `.zip` file you can store anywhere
  (uncompressed ZIP, no external libraries involved).
- Click **Restore** and pick a backup `.zip` (or a plain `.json` export) to bring the
  data back. Restoring is idempotent — re-importing the same backup is safe.
- A non-blocking reminder appears on app load if the last backup is more than **7 days**
  old; making a successful backup silences it for another week ("Later" dismisses it
  for the current session only).

## ⚠️ Ollama CORS Setup (required for browser access)

Ollama only allows requests from `127.0.0.1` by default. A browser page needs explicit
permission. Start Ollama with the `OLLAMA_ORIGINS` environment variable:

**Windows (cmd):**
```cmd
set OLLAMA_ORIGINS=*
ollama serve
```

**Windows (PowerShell):**
```powershell
$env:OLLAMA_ORIGINS="*"
ollama serve
```

**Linux / macOS:**
```bash
OLLAMA_ORIGINS=* ollama serve
```

If you see a CORS error in the AI panel, this is the fix.

## Architecture

| File | Responsibility |
|---|---|
| [`index.html`](index.html) | App shell: toolbar, viewer, side panel, AI panel |
| [`css/styles.css`](css/styles.css) | All styling |
| [`js/storage.js`](js/storage.js) | IndexedDB wrapper (annotations + PDF metadata, SHA-256 file id) |
| [`js/backup.js`](js/backup.js) | Full backup as a zip (no libraries), restore, 7-day reminder |
| [`js/pdf-viewer.js`](js/pdf-viewer.js) | PDF.js rendering (canvas + text layer), lazy load, zoom, navigation |
| [`js/highlighter.js`](js/highlighter.js) | Text selection → highlight overlay, click-to-edit popover |
| [`js/text-geometry.js`](js/text-geometry.js) | Shared text indexing + text-range → rect conversion |
| [`js/search.js`](js/search.js) | Full-PDF text search with match navigation |
| [`js/ollama.js`](js/ollama.js) | Fetch-based Ollama API client (streaming, cancel) |
| [`js/ai-panel.js`](js/ai-panel.js) | AI panel UI: settings, prompt template, response, auto-annotate |
| [`js/auto-annotate.js`](js/auto-annotate.js) | AI-driven automatic annotation creation |
| [`js/annotations-ui.js`](js/annotations-ui.js) | Side panel annotation list |
| [`js/app.js`](js/app.js) | Bootstrap & wiring |

## Data Model

```js
// Annotation (stored in IndexedDB)
{
  id:             "uuid",
  pdfId:          "sha256:...",        // stable per file
  page:           1,                   // 1-based
  textSelected:   "highlighted text",
  rects:          [{ x, y, width, height }],  // normalized 0..1
  annotationText: "optional note" | null,
  color:          "#ffd400",
  createdAt:      1690000000000,
  updatedAt:      1690000000000
}
```

## Tech
- **PDF.js v3.11.174** (local UMD build in `lib/`)
- **IndexedDB** for annotation storage
- **Ollama** `/api/chat` + `/v1/models` REST API (local)
- No build step, no dependencies, no server
