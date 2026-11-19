# Bücher Desktop

Bücher is a standalone Tauri reader for the Markdown books used by [Bücher for Obsidian](https://github.com/mateusdcc/obsidian-buches/tree/41b05447d3af9205cbb2137b24385d2cd614ad4b). It opens with the original sample book, *Proofs in Linear Algebra*.

## Read or import a book

Use **Import books** in the Library sidebar and select a book folder containing `_index.md`, a `Buches` collection, or the vault containing that collection. Bücher copies compatible books into its application data directory. A book with the same folder name is skipped. Supported local images and flashcard audio must be inside the book folder.

Open a chapter from the tree, then use the arrow at the bottom to advance and record the chapter as read. The toolbar opens exercises, flashcards, and quick notes, and the pencil edits the current Markdown file. Use **⌘K** on macOS or **Ctrl+K** elsewhere to search the library.

Drag the dividers at the library and reader tool panels to resize them, or focus a divider and press the arrow keys. Bücher saves both widths across launches.

Progress, flashcard scheduling, notes, and solution attempts stay in the same Markdown format as the original plugin. On macOS the books live in `~/Library/Application Support/com.mateusdcc.bucher/Buches`. Back up or copy that folder to move the library. References resolve within the imported library. The desktop port uses KaTeX for LaTeX and shows Typst proofs as editable source.

Choose **Write a solution**, **New attempt**, or **Edit** to write directly in the reader. The block you are editing shows its Markdown source, while surrounding blocks render as you write. **Insert Typst** adds a fenced equation. Supported Typst equations render in the reader and other Typst code stays editable as source.

Under **Settings → AI**, choose a local Ollama model or connect ChatGPT in your browser and choose a ChatGPT model. Select **ChatGPT** as the AI provider to use your eligible ChatGPT plan or available credits for explanations, solutions, reviews, patches, and Markdown imports. Bücher sends the relevant text for each ChatGPT request to OpenAI. **Manage usage** opens the usage and app limits page. See the [AI command guide](docs/local-ai.md).

## Interactive extensions

Books can embed interactive blocks: Mermaid diagrams, live function plots, step-by-step algorithm players, coding exercises with hidden unit tests, Parsons ordering puzzles, and SQL practice. The built-in book **The Interactive Extension Showcase** tours all six; it is seeded into your library once on first launch after updating.

Open **Settings → Extensions** to toggle extensions and inspect the AI authoring skill each one exposes. Enabled skills are injected into *Import with AI* and *Propose a patch*, so generated books can use the blocks too. Exercise blocks mark themselves solved when you pass them, and all block state persists in the book's `_progress.md`. See the [extension guide](docs/extensions.md) and [architecture notes](EXTENSIONS_ARCHITECTURE.md).

## Develop

Install Node.js, Rust 1.89 or later, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
npm ci
npm run tauri -- dev
npm test
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml --locked
node scripts/check-extensions-ui.mjs
```

Build a local macOS app bundle with ad-hoc signing:

```sh
APPLE_SIGNING_IDENTITY=- npm run tauri -- build --bundles app
```

The bundle is written to `src-tauri/target/release/bundle/macos/Bücher.app`.
