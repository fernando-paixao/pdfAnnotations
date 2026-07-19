---
I want to build a browser Javascript solution where the user can load PDF and make marks on selected text and annotations (properties: textSelected, page, annotationText (not required))

In my stack solution I want to use PDF.js

Requirements:
    This project should run on browser Javascript.
    Read PDFs locally
    Work offline
    No external API
    No server-side PDF conversion
    User can highlight text
    User can create annotations
    Store annotations separately
--- Output
Plan Summary
Stack: PDF.js v3.11.174 (local UMD build) + vanilla JS (no build step) + IndexedDB — fully offline, no server, no external API.

Key design choices:

PDF identity: SHA-256 hash of the file → stable pdfId, so annotations always reattach to the correct PDF across sessions.
Highlight re-rendering: Store normalized rects (fractions of page size) + page number, so highlights re-draw at the exact spot at any zoom level.
Per-page DOM: canvas (PDF) + highlight-layer (overlays) + text-layer (transparent text for native browser selection).
Storage: IndexedDB with annotations store (indexed by pdfId and [pdfId, page]) + a pdfs metadata store.
Data model (matches your spec, extended for re-rendering):

{ id, pdfId, page, textSelected, rects[], annotationText|null, color, createdAt, updatedAt }
Module breakdown:

js/storage.js — IndexedDB wrapper
js/pdf-viewer.js — PDF.js rendering, text layer, zoom/nav
js/highlighter.js — selection capture + overlay draw/redraw
js/annotations-ui.js — side panel, edit/delete, export/import
js/app.js — bootstrap + wiring
9-step todo list covering download → HTML/CSS → storage → viewer → highlighter → UI → bootstrap → testing.

A couple of notes flagged in the plan:

Opening via file:// works (PDF.js falls back to main-thread worker if blocked), but a simple local server (e.g. npx serve) gives best performance.
Pages render lazily on scroll for large PDFs.
---