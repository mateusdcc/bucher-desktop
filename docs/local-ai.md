# Local AI commands

Start Ollama with an installed text model at `127.0.0.1:11434`. Use `ai_list_models` to get the exact names Bücher can use. Requests go to the loopback Ollama server, and Bücher filters out cloud models. Ollama also offers a server-wide local-only mode. [Ollama local FAQ](https://docs.ollama.com/faq)

Open **Settings → AI**, expand **Ollama**, and choose a local model. Ask about the chapter from the reader toolbar or use the explain button beside a definition or exercise. The explanation appears above the passage. Generate a solution within the exercise and review it in the right panel beside the proof. Choose **Import with AI** from the sidebar to prepare a book draft in the reader workspace.

The reader calls the native Tauri commands below through `invoke` from `@tauri-apps/api/core`. Omit a field marked optional or pass `null`.

| Command | Arguments | Result |
| --- | --- | --- |
| `ai_list_models` | None | Installed local text model names |
| `ai_ollama_status` | None | Installation, connection, and model list |
| `ai_explain` | `model`, `question`, `context` | Markdown explanation |
| `ai_generate_solution` | `model`, `exercise`, optional `context` and `instructions` | Worked solution in Markdown and LaTeX |
| `ai_review_solution` | `model`, `exercise`, `attempt`, optional `rubric` | Markdown feedback and criterion scores when a rubric is supplied |
| `ai_propose_patch` | `model`, `markdown`, `instructions` | `{ original, replacement }` |
| `ai_prepare_import` | `model`, `title`, `markdown` | `{ title, introduction, chapters: [{ title, markdown }] }` |
| `ai_import_book` | `draft` from `ai_prepare_import`, with any user edits | Library-relative path to the new book's `_index.md` |

All model inputs are strings. Pass the relevant book or exercise excerpt as context. For large documents, process sections separately so the chosen model can fit the source and response in its context window.

### Review a patch

**Propose a patch** opens a panel beside the chapter so you can read while writing your instructions. Review the added and removed Markdown, expand folded lines for context, and choose **Apply patch** or **Discard**.

Pass the Markdown body of an introduction, chapter, or selected excerpt to `ai_propose_patch`. Keep its offsets and the full original file in the caller. After reviewing the replacement, splice it into that snapshot and invoke `save_markdown` with the library-relative `path`, the revised `text`, and the full snapshot as `expected`. The existing save command rejects edits if the file changed while the model was running.

### Import Markdown

Pass the target book title and Markdown to `ai_prepare_import`. Review the draft against the source and edit the introduction or chapter entries as needed. Call `ai_import_book` to publish the complete book, then call `load_library` to refresh the reader. Import takes Markdown text as input and publishes a flat list of chapters in the returned order. Use the regular folder import for existing Bücher books with attachments and nested chapters.

### Check the commands with sample responses

```sh
node scripts/check-local-ai.mjs
```

The test uses a short-lived local fixture with sample study responses. It checks the Ollama request format, previews a patch, and publishes an imported draft to a temporary library without loading a model.

Run `node scripts/check-ai-ui.mjs` to exercise the reader with sample responses in Chromium. The script uses Playwright Chromium when installed and falls back to Google Chrome.
