# AI Slide Builder

A slide editor with an AI assistant. Build a deck by hand (text, images, charts, shapes) or ask the assistant to create and edit slides for you. Everything is saved in your browser; the only network call is the AI request.

## Getting started

```bash
npm install
cp .env.example .env.local   # then set LLM_API_KEY
npm run dev
```

Open http://localhost:3000.

### AI configuration (`.env.local`)

The assistant works with any OpenAI-compatible endpoint whose model supports `response_format: json_schema` with `strict: true`, for example xAI (Grok) or Groq:

```bash
# xAI (Grok) – key from console.x.ai, starts with "xai-"
LLM_BASE_URL=https://api.x.ai/v1
LLM_API_KEY=
LLM_MODEL=grok-4.7

# or Groq – key from console.groq.com/keys, starts with "gsk_"
# LLM_BASE_URL=https://api.groq.com/openai/v1
# LLM_MODEL=openai/gpt-oss-120b
```

If `LLM_BASE_URL` / `LLM_MODEL` are left out, Groq and `openai/gpt-oss-120b` are used. The key is only read on the server (`app/api/ai/route.ts`) and never reaches the browser. Without a key the editor still works; the chat explains how to configure it.

Keep the real key in `.env.local` only: it is git-ignored, while `.env.example` is committed. Variables exported in your shell (e.g. `LLM_API_KEY` in `~/.zshrc`) take precedence over `.env.local`. After editing `.env.local`, restart `npm run dev`.

When the provider rejects a request, the chat shows the provider's own error message (for example an invalid key, or a key that isn't allowed to use the model).

## Features

- **Slides sidebar** – thumbnails, drag to reorder, duplicate / move / delete from the `⋯` menu, arrow keys to move between slides, Delete to remove the focused slide.
- **Toolbar** – insert text, images (PNG, JPEG, WebP, GIF up to 10 MB), bar / line / area / pie charts, and shapes (rectangle, rounded rectangle, ellipse, triangle, arrow, line). With an element selected it shows that element's formatting (font, size, bold/italic/underline, alignment, colors, borders, chart type, chart data, legend, alt text) plus arrange / duplicate / delete. With nothing selected it edits the slide background.
- **Canvas** – click to select, drag to move, handles to resize (Shift keeps proportions; images always do), double-click text to edit in place, double-click a chart to edit its data.
- **Empty state** – add a blank slide or start from a template.
- **AI assistant** – suggested prompts, Enter to send, Stop while it's working, Retry on errors. The assistant can create whole decks, add / delete / reorder slides, and change text, layout, colors and charts. Each AI response is a single undo step.
- **Header** – presentation title (filled in when you apply a template, editable any time), save status, undo / redo, templates, export, present.
- **Templates** – Pitch Deck, Project Update, Quarterly Review, Product Launch. All copy is placeholder text in `[brackets]`; chart values are labelled as placeholders.
- **Present** – full screen from the current slide. →/Space/Enter/click for next, ← for previous, Home/End, Esc to exit.
- **Export** – PowerPoint (`.pptx`, editable text, shapes, images and native charts) and PDF (one page per slide, rendered exactly as on screen; text in the PDF is an image, not selectable).

### Keyboard shortcuts (on the canvas)

| Keys                                | Action                         |
| ----------------------------------- | ------------------------------ |
| ⌘/Ctrl Z, ⇧⌘/Ctrl Shift Z, Ctrl Y   | Undo / redo                    |
| Delete / Backspace                  | Delete selected element        |
| Arrow keys (Shift = 10 px)          | Nudge selected element         |
| ⌘/Ctrl D                            | Duplicate selected element     |
| ⌘/Ctrl C, ⌘/Ctrl V                  | Copy / paste element           |
| Enter                               | Edit selected text box         |
| Esc                                 | Stop editing / deselect        |

## How data is stored

- One presentation, autosaved to IndexedDB in your browser (`ai-slide-builder` database) about 0.4 s after each change, and immediately when the tab is hidden. The chat history is saved the same way.
- If the saved data can't be read, the app keeps a backup copy, recovers every slide and element it can, and tells you what was dropped.
- If the same presentation is open in two tabs, the other tab shows a banner offering to reload.
- If the browser blocks storage (some private modes) or storage is full, the header shows "Can't save" / "Not saved" and a message explains why.
- What is sent to the AI: your messages and the deck's text, positions, colors and chart data. Images are never sent (only their alt text).

## Limits

200 slides per deck, 100 elements per slide, 24 categories and 8 series per chart, 100 undo steps, 2,000 characters per chat message. Slides are 16:9 (1280 × 720 px, exported as 13.33 × 7.5 in).

## Scripts

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Development server                   |
| `npm run build` / `start` | Production build / server          |
| `npm test`              | Run all tests once (Vitest)          |
| `npm run test:coverage` | Tests with a coverage report         |
| `npm run check`         | Type check, lint and test            |

## Project structure

```
app/
  page.tsx                 renders the client-only editor
  api/ai/route.ts          server proxy to the LLM (keeps the key secret)
components/
  Editor.tsx               layout: header, sidebar, toolbar + canvas, chat
  editor/                  Header, SlideSidebar, Toolbar, Canvas, EmptyState,
                           TemplateGallery, ChartDataEditor, PresentMode
  chat/ChatPanel.tsx       AI assistant panel
  slide/                   read-only slide rendering (thumbnails, present, export)
  ui/                      Modal, MenuButton, ColorInput, Toasts
  hooks/                   persistence, keyboard shortcuts, element size
  export/captureSlide.tsx  renders a slide to an image for PDF export
lib/
  schema.ts                deck / slide / element types (zod)
  store/                   editor (undo/redo), chat and toast stores (zustand)
  ai/                      response schema, prompt, apply operations, client, server
  export/                  PPTX and PDF exporters
  persistence.ts           IndexedDB load/save, recovery, cross-tab sync
  templates.ts, factory.ts, sanitize.ts, geometry.ts, chart.ts, image.ts …
```

Tests live next to the code they cover (`*.test.ts(x)`).
