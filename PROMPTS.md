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
Now I want a resource to call local Ollama AI service:

The prompt will be an textarea template text with placeholder using $ notation: $text
This $text will be replaced by the PDF context, options: selectedText, entirePage(s) (user will decide the amount since the actual page)

Other feature will be create annotations automatically on the selected page(s) since the actual page, the prompt to AI will be to find the more important parts of that page content creating annotations. Options: howManyDesiredAnnotations (nullable)
--- Future
Other placeholder will be $annotation (w)
--- Plan
I've written the Ollama integration plan to plans/ollama-integration-plan.md. Here's the summary:

Plan Summary
Two AI features, calling local Ollama directly from the browser via fetch (same API as your Tauri app, minus the Rust CORS bypass):

Feature 1: AI Prompt Panel
Collapsible drawer with Ollama settings (host, model + fetch-models dropdown, maxTokens, numCtx, reasoning, streaming) — persisted in localStorage.
Prompt template textarea with $text placeholder.
Context scope selector: selectedText / entirePage / entirePages (current page + N pages).
Streams the response into a response area (with dimmed thinking section).
Feature 2: Auto-Annotate
AI analyzes page content and returns strict JSON of important passages.
User options: howManyDesiredAnnotations (nullable — AI decides if empty) and includeNotes (checkbox — snippets only vs snippets + notes).
Each AI snippet is fuzzy-matched back to the page text → converted to normalized rects → creates highlight annotations with notes as annotationText.
New modules
js/ollama.js — fetch-based client (listModels, streaming chat via ReadableStream, AbortController cancel)
js/ai-panel.js — panel UI, settings, context gathering, $text substitution
js/auto-annotate.js — JSON prompt, fuzzy matching, auto-create annotations
js/text-geometry.js — shared text→rect helper (refactored from Search)
⚠️ Key requirement: CORS
Since there's no Rust backend, Ollama must be started with OLLAMA_ORIGINS=* (documented in README + shown as an error hint in the UI if the connection fails).

9-step todo list covering: ollama client → HTML → CSS → AI panel → text-geometry refactor → auto-annotate → wiring → README → testing.
---
Can you add on the AI response an option to see the result output in other formats viewer: textViewer (actual), markdownViewer
---
On debug output I'm getting:
REQ 22:13:59.953 Page 59: POST http://localai:11001/api/chat | model=qwen3.5:2b | promptLen=2284

I would like to have the entire content of the request body too
---
Can you add a feature optional advanced features:

- System prompt: Sent as a role: system message before the user prompt when using /api/chat.
- 
--- Future
Can you add queue actions to AI, as they has some time to be answered by Ollama service the user.
And add a sound to be played while each action queued is completed.
---