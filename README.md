# AI Slide Builder

A slide editor with an AI assistant. Build decks by hand (text, images, tables, charts, shapes) or ask the assistant to create and edit slides for you. Every presentation and its chat history are saved in your browser. The only network call is the AI request.

## Getting started

```bash
npm install
cp .env.example .env.local   # then set LLM_API_KEY
npm run dev
```

Open http://localhost:3000.

### AI configuration (`.env.local`)

The assistant works with any OpenAI-compatible endpoint whose model supports `response_format: json_schema` with `strict: true`. Two examples are xAI (Grok) and Groq:

```bash
# xAI (Grok): key from console.x.ai, starts with "xai-"
LLM_BASE_URL=https://api.x.ai/v1
LLM_API_KEY=
LLM_MODEL=grok-4.7

# or Groq: key from console.groq.com/keys, starts with "gsk_"
# LLM_BASE_URL=https://api.groq.com/openai/v1
# LLM_MODEL=openai/gpt-oss-120b
```

If you leave out `LLM_BASE_URL` and `LLM_MODEL`, the app uses Groq with `openai/gpt-oss-120b`.

- **Where the key lives:** only the server reads it (`app/api/ai/route.ts`); it never reaches the browser. Keep it in `.env.local`, which git ignores. `.env.example` is committed, so don't put the key there.
- **Without a key:** the editor still works, and the chat explains how to set one up.
- **Precedence:** a variable exported in your shell (for example `LLM_API_KEY` in `~/.zshrc`) overrides `.env.local`.
- **After editing `.env.local`:** restart `npm run dev`.

When the provider rejects a request, the chat shows the provider's own error message, such as an invalid key or a key that can't use the model. If the key looks like it belongs to the other provider, the chat says so.

## Features

### Presentations dashboard

- The home screen lists every presentation saved in this browser, newest first. Each card shows a thumbnail of the first slide, the slide count and when it was last edited.
- **New presentation** creates an empty deck and opens it.
- Each card's `⋯` menu has **Rename**, **Duplicate** (creates "Copy of …" with a fresh, empty AI chat) and **Delete**. Delete asks for confirmation and also removes that deck's chat history.
- Each presentation has its own URL (`#/deck/<id>`): a refresh reopens it, and the browser's Back button returns to the dashboard.
- In the editor, the grid button at top left goes back to all presentations. The `⋯` menu next to the save status offers **New presentation**, **Duplicate presentation** (opens the copy) and **Delete presentation**.

### Slides

- The sidebar shows thumbnails; drag them to reorder. Arrow keys move between slides and Delete removes the focused slide.
- Each slide's `⋯` menu has **New slide above**, **New slide below**, Duplicate, Copy, Paste, Move up/down and Delete, so you can add a slide at any position. **New slide** at the bottom of the sidebar inserts after the current slide.
- Paste from a slide's menu puts copied slides right after that slide; copied elements go onto that slide.

### Toolbar

- **Insert:** text, images (PNG, JPEG, WebP or GIF, up to 10 MB), tables, charts and shapes.
  - Charts: bar, line, area, pie, doughnut and scatter.
  - Shapes: rectangle, rounded rectangle, ellipse, triangle, arrow and line.
- **One element selected:** the toolbar shows that element's formatting.
  - **Text:** font, size, bold, italic, underline, alignment and color.
  - **Shapes:** fill, border and line.
  - **Images:** **Replace** (keeps the width, drops any crop), **Crop** and alt text.
  - **Charts:** type, **Edit data**, **Legend** and **Data labels**. Bar charts also get **Stacked**, and bar and line charts get **Dual axis** (the last series becomes a line on a second axis on the right). Stacked and Dual axis need at least two series.
  - **Tables:** **Edit table**, **Header row**, font, size, text color, header fill, border color and **No borders**.
- **Any selection (one or many elements):** Lock/Unlock, Group/Ungroup, Arrange (front/back), Duplicate and Delete. The `⋯` menu has Copy, Cut and Paste.
- **Nothing selected:** the toolbar edits the slide background and offers Paste.

### Canvas

- **Selecting:**
  - Click to select an element. Shift-, Ctrl- or ⌘-click adds it to or removes it from the selection.
  - Drag on an empty area to select with a box. An element is selected only when it is fully inside the box, and a group only when all of its members are. Shift adds to the existing selection.
- **Moving and resizing:**
  - Drag to move. Several selected elements move together and keep their spacing.
  - Use the handles to resize. Shift keeps proportions, and images always keep them. With several elements selected, the corner handles scale them all together.
- **Groups:** clicking any member selects the whole group. Copies of a group stay grouped. PowerPoint export doesn't keep groups.
- **Locked elements** show a lock badge.
  - You can't move, resize, nudge, cut or delete them, and the AI can't change them at all.
  - You can still edit their text and formatting by hand.
  - A slide that contains a locked element can't be deleted by the AI.
- **Double-click** a text box to edit it in place, a chart to edit its data, a table to edit its cells, or an image to crop it.
- **Speaker notes:** a collapsible panel under the canvas holds the notes for the current slide.

### Editors

- **Chart data:**
  - Edit labels, series and values. Numbers like `1,200`, `$45` and `12%` are accepted.
  - **Paste data** takes cells copied from Excel, Numbers or Google Sheets, or CSV text. The first column becomes the labels and the other columns the series; a first row of names becomes the series names.
  - Cells that aren't numbers are highlighted, and saving waits until they're fixed.
  - Scatter charts use the first column as X values, so those must be numbers too.
- **Table:**
  - Edit cells and add or remove rows and columns.
  - Pasting spreadsheet cells into any cell fills the table from there, growing it as needed.
  - Tables hold up to 30 rows, 10 columns and 500 characters per cell. If a paste goes over these limits, you're told what was left out.
- **Crop:**
  - Drag the box or its corners; arrow keys move the box. **Reset** shows the whole image again.
  - Like PowerPoint, the picture keeps its scale and position, and only the cropped edges disappear.
  - The original image is kept, so a crop can always be undone or changed.

### Copy and paste

- ⌘/Ctrl C, X and V work on the selected elements, or on a slide when its thumbnail has focus. Copies work across slides and presentations, and across tabs when the copy fits in the browser's local storage (copies with large images stay in the current tab).
- Pasting from other apps:
  - **Spreadsheet cells** (tab-separated text) become a table.
  - **Other text** becomes a text box.
  - **An image** becomes an image element.
- Copied text, tables and charts also land on the system clipboard as plain text, so you can paste them into other apps. Tables and chart data paste as spreadsheet cells.
- Typing in a field, or copying selected page text, keeps the browser's normal copy and paste.

### AI assistant

- Suggested prompts, Enter to send, Stop while it's working, Retry on errors.
- The assistant can create whole decks, add, delete and reorder slides, and change text, layout, colors, charts, tables and speaker notes. Each AI response is a single undo step.
- While a request runs, the slide shows a dashed "AI is editing…" outline.
- Afterwards, the elements and slide thumbnails the AI changed flash briefly. The reply lists what changed and anything that was skipped, for example a locked element.
- Each presentation keeps its own chat history (the newest 200 messages), restored when you reopen it.

### Header

Presentation title (filled in when you apply a template, editable any time), save status, the presentation `⋯` menu, undo / redo, templates, export and present.

### Templates

Pitch Deck, Project Update, Quarterly Review and Product Launch. All copy is placeholder text in `[brackets]`, and chart values are labelled as placeholders.

### Present

- Full screen, starting from the current slide.
- Speaker notes show below the slide. Press **N** or use the notes button to hide or show them.
- →, Space, Enter or a click goes to the next slide; ← goes back. Home/End jump to the first or last slide, and Esc exits.

### Export

- **PowerPoint (`.pptx`):** text, shapes and tables stay editable, and charts are native. Exports include doughnut, scatter, stacked, dual-axis and data-label charts, cropped images and speaker notes.
- **PDF:** one page per slide, rendered exactly as on screen. The text is part of an image, so it can't be selected.
- **Web page (`.html`):** one self-contained file with all slides one below another. It scales to the window, prints one slide per page, and needs no internet connection. Speaker notes aren't included.

### Keyboard shortcuts (editor)

| Keys                                | Action                                              |
| ----------------------------------- | --------------------------------------------------- |
| ⌘/Ctrl Z, ⇧⌘/Ctrl Shift Z, Ctrl Y   | Undo / redo                                         |
| ⌘/Ctrl A                            | Select all elements on the slide                    |
| ⌘/Ctrl C, X, V                      | Copy, cut, paste (elements, or the focused slide)   |
| ⌘/Ctrl D                            | Duplicate the selection                             |
| ⌘/Ctrl G, ⇧⌘/Ctrl Shift G           | Group / ungroup                                     |
| Arrow keys (Shift = 10 px)          | Nudge the selection 1 px (or 10 px)                 |
| Delete / Backspace                  | Delete the selection (locked elements stay)         |
| Enter                               | Edit the selected text box                          |
| Esc                                 | Stop editing / deselect                             |
| N (while presenting)                | Show / hide speaker notes                           |

## How data is stored

- **Where:** every presentation and its chat history are stored in IndexedDB in your browser (database `ai-slide-builder`), with a small index of presentations for the dashboard. Changes are autosaved about 0.4 s after each edit, and immediately when the tab is hidden or you leave the editor.
- **Older single-deck data:** a presentation saved by an earlier single-deck version is moved into the dashboard automatically.
- **Unreadable data:** the app keeps a backup copy, recovers every slide and element it can, and tells you what was dropped.
- **Several tabs:**
  - If the same presentation is open in two tabs, the other tab shows a banner offering to reload.
  - If a presentation is deleted in another tab, this tab returns to the dashboard.
  - The dashboard refreshes when another tab creates, changes or deletes a presentation.
- **Storage blocked or full:** if the browser blocks storage (some private modes) or storage is full, the app says so. The dashboard shows a banner, the header shows "Can't save in this browser" or "Not saved", and a message explains why.
- **What is sent to the AI:** your messages and the deck's text, positions, colors, chart and table data, notes, lock and group markers. Images are never sent, only their alt text.
- **Long conversations:** the most recent turns are sent word for word, within a token budget. Older turns are condensed into a short summary of what you asked and what changed, without extra AI calls. Very large decks are abbreviated, but the current slide is always sent in full. The chat shows a note when older messages are being summarized.

## Limits

| Item | Limit |
| --- | --- |
| Slides per deck | 200 |
| Elements per slide | 100 |
| Chart categories / series | 24 / 8 |
| Table rows / columns / characters per cell | 30 / 10 / 500 |
| Speaker notes per slide | 5,000 characters |
| Undo steps | 100 |
| Chat message length | 2,000 characters |
| Saved chat messages per presentation | 200 |

Slides are 16:9: 1280 × 720 px, exported as 13.33 × 7.5 in.

## Scripts

| Command                   | Description                          |
| ------------------------- | ------------------------------------ |
| `npm run dev`             | Development server                   |
| `npm run build` / `start` | Production build / server            |
| `npm test`                | Run all tests once (Vitest)          |
| `npm run test:coverage`   | Tests with a coverage report         |
| `npm run check`           | Type check, lint and test            |

## Project structure

```
app/
  page.tsx                 renders the client-only app
  api/ai/route.ts          server proxy to the LLM (keeps the key secret)
components/
  App.tsx                  hash routing: dashboard or editor
  Editor.tsx               editor layout: header, sidebar, toolbar + canvas + notes, chat
  dashboard/Dashboard.tsx  list of saved presentations
  editor/                  Header, SlideSidebar, Toolbar, Canvas, NotesPanel, EmptyState,
                           TemplateGallery, ChartDataEditor, TableEditor, CropEditor, PresentMode
  chat/ChatPanel.tsx       AI assistant panel
  slide/                   read-only slide rendering (thumbnails, present, export): text,
                           shapes, images (with crop), charts, tables
  ui/                      Modal, MenuButton, ColorInput, Toasts
  hooks/                   deck session (load/autosave/sync), hash route, clipboard,
                           keyboard shortcuts, element size
  export/captureSlide.tsx  renders a slide to an image (PDF) or static HTML (web page)
lib/
  schema.ts                deck / slide / element types (zod)
  store/                   editor (selection, groups, locks, undo/redo), chat, clipboard, toasts
  ai/                      response schema, prompt, context budget, apply operations, client, server
  export/                  PPTX, PDF and HTML exporters
  persistence.ts           IndexedDB decks + index, chats, recovery, migration, cross-tab sync
  clipboard.ts, tabular.ts copy/paste text, spreadsheet (TSV/CSV) parsing
  templates.ts, factory.ts, sanitize.ts, geometry.ts, chart.ts, image.ts …
```

Tests live next to the code they cover (`*.test.ts(x)`).
