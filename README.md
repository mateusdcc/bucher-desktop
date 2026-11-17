# Bücher Desktop

Bücher is a standalone Tauri reader for the Markdown books used by [Bücher for Obsidian](https://github.com/mateusdcc/obsidian-buches/tree/41b05447d3af9205cbb2137b24385d2cd614ad4b). It opens with the original sample book, *Proofs in Linear Algebra*.

## Read or import a book

Use **Import books** in the Library sidebar and select a book folder containing `_index.md`, a `Buches` collection, or the vault containing that collection. Bücher copies compatible books into its application data directory. A book with the same folder name is skipped. Supported local images and flashcard audio must be inside the book folder.

Open a chapter from the tree, then use the arrow at the bottom to advance and record the chapter as read. The toolbar opens exercises, flashcards, and quick notes, and the pencil edits the current Markdown file. Use **⌘K** on macOS or **Ctrl+K** elsewhere to search the library.

Progress, flashcard scheduling, notes, and solution attempts stay in the same Markdown format as the original plugin. On macOS the books live in `~/Library/Application Support/com.mateusdcc.bucher/Buches`. Back up or copy that folder to move the library. References resolve within the imported library. The desktop port uses KaTeX for LaTeX and shows Typst proofs as editable source.

The [local AI command guide](docs/local-ai.md) covers the native Ollama API for explanations, solution drafts, proof review, patch proposals, and Markdown book import.

## Develop

Install Node.js, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
npm ci
npm run tauri -- dev
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Build a local macOS app bundle with ad-hoc signing:

```sh
APPLE_SIGNING_IDENTITY=- npm run tauri -- build --bundles app
```

The bundle is written to `src-tauri/target/release/bundle/macos/Bücher.app`.
