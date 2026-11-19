use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

const MAX_NOTE_BYTES: u64 = 8 * 1024 * 1024;
const DEMO: &[(&str, &str)] = &[
    (
        "_index.md",
        include_str!("../../demo/Buches/Proofs in Linear Algebra/_index.md"),
    ),
    (
        "concepts/Vector spaces.md",
        include_str!("../../demo/Buches/Proofs in Linear Algebra/concepts/Vector spaces.md"),
    ),
    (
        "concepts/Vector spaces/Subspaces.md",
        include_str!(
            "../../demo/Buches/Proofs in Linear Algebra/concepts/Vector spaces/Subspaces.md"
        ),
    ),
    (
        "concepts/Vector spaces/Direct sums.md",
        include_str!(
            "../../demo/Buches/Proofs in Linear Algebra/concepts/Vector spaces/Direct sums.md"
        ),
    ),
    (
        "concepts/Linear maps.md",
        include_str!("../../demo/Buches/Proofs in Linear Algebra/concepts/Linear maps.md"),
    ),
    (
        "concepts/Linear maps/Quotients.md",
        include_str!(
            "../../demo/Buches/Proofs in Linear Algebra/concepts/Linear maps/Quotients.md"
        ),
    ),
];

/// Built-in tour of the extension system. Seeded once into every library
/// (including already-initialized ones) via the `.showcase-seeded` marker,
/// so deleting the book keeps it deleted.
const SHOWCASE: &[(&str, &str)] = &[
    (
        "_index.md",
        include_str!("../../demo/Buches/The Interactive Extension Showcase/_index.md"),
    ),
    (
        "concepts/Diagrams with Mermaid.md",
        include_str!(
            "../../demo/Buches/The Interactive Extension Showcase/concepts/Diagrams with Mermaid.md"
        ),
    ),
    (
        "concepts/Exploring Functions.md",
        include_str!(
            "../../demo/Buches/The Interactive Extension Showcase/concepts/Exploring Functions.md"
        ),
    ),
    (
        "concepts/Watching Algorithms Run.md",
        include_str!(
            "../../demo/Buches/The Interactive Extension Showcase/concepts/Watching Algorithms Run.md"
        ),
    ),
    (
        "concepts/Coding Practice.md",
        include_str!(
            "../../demo/Buches/The Interactive Extension Showcase/concepts/Coding Practice.md"
        ),
    ),
    (
        "concepts/Ordering Proofs.md",
        include_str!(
            "../../demo/Buches/The Interactive Extension Showcase/concepts/Ordering Proofs.md"
        ),
    ),
    (
        "concepts/Querying Data.md",
        include_str!(
            "../../demo/Buches/The Interactive Extension Showcase/concepts/Querying Data.md"
        ),
    ),
    (
        "concepts/Authoring with Extensions.md",
        include_str!(
            "../../demo/Buches/The Interactive Extension Showcase/concepts/Authoring with Extensions.md"
        ),
    ),
];

#[derive(Serialize)]
pub struct Entry {
    pub path: String,
    pub source: Option<String>,
}

#[derive(Default, Serialize)]
pub struct ImportReport {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Deserialize, Serialize)]
pub struct BookDraft {
    pub title: String,
    #[serde(flatten)]
    pub content: BookContent,
}

#[derive(Deserialize, Serialize)]
pub struct BookContent {
    introduction: String,
    chapters: Vec<ChapterDraft>,
}

#[derive(Deserialize, Serialize)]
struct ChapterDraft {
    title: String,
    markdown: String,
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn supported(path: &Path) -> bool {
    matches!(
        extension(path).as_str(),
        "md" | "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "gif"
            | "avif"
            | "svg"
            | "mp3"
            | "wav"
            | "ogg"
            | "m4a"
            | "webm"
            | "aac"
            | "flac"
    )
}

fn relative_path(path: &Path) -> io::Result<String> {
    path.iter()
        .map(|part| {
            part.to_str()
                .ok_or_else(|| invalid("File names must be valid Unicode."))
        })
        .collect::<io::Result<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

fn note_path(root: &Path, key: &str) -> io::Result<PathBuf> {
    let path = Path::new(key);
    if !key.starts_with("Buches/") || key.split('/').count() < 3 || key.contains(['\\', ':'])
        || extension(path) != "md" || !path.components().all(|part| {
            matches!(part, Component::Normal(name) if !name.to_string_lossy().starts_with('.'))
        }) || key.split('/').any(|part| part.is_empty() || part.starts_with('.')) {
        return Err(invalid("Only Markdown files inside the Bücher library can be changed."));
    }
    let mut absolute = root.to_path_buf();
    for part in path {
        absolute.push(part);
        match fs::symlink_metadata(&absolute) {
            Ok(meta) if meta.is_symlink() => {
                return Err(invalid("Symbolic links are outside the library."))
            }
            Ok(_) => {}
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
    }
    Ok(absolute)
}

fn read_note(path: &Path) -> io::Result<String> {
    if fs::metadata(path)?.len() > MAX_NOTE_BYTES {
        return Err(invalid(format!(
            "Markdown file is larger than 8 MiB: {}",
            path.display()
        )));
    }
    fs::read_to_string(path)
}

pub fn save(root: &Path, key: &str, text: &str, expected: Option<&str>) -> io::Result<()> {
    let path = note_path(root, key)?;
    if text.len() as u64 > MAX_NOTE_BYTES {
        return Err(invalid("Markdown files must be smaller than 8 MiB."));
    }
    if let Some(expected) = expected {
        if read_note(&path)? != expected {
            return Err(invalid(
                "The file changed on disk. Reopen it before editing.",
            ));
        }
    }
    let parent = path.parent().unwrap();
    fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(text.as_bytes())?;
    temporary.as_file().sync_all()?;
    if expected.is_some() {
        temporary.persist(path)?;
    } else {
        temporary.persist_noclobber(path).map_err(|err| {
            if err.error.kind() == io::ErrorKind::AlreadyExists {
                invalid("A file with that name already exists.")
            } else {
                err.error
            }
        })?;
    }
    Ok(())
}

pub fn discard_solution(root: &Path, key: &str, expected: &str) -> io::Result<()> {
    let parts = key.split('/').collect::<Vec<_>>();
    if parts.len() != 4 || parts[2] != "_solutions" {
        return Err(invalid("Only new solution notes can be discarded."));
    }
    let path = note_path(root, key)?;
    if read_note(&path)? != expected {
        return Err(invalid("The solution changed on disk."));
    }
    fs::remove_file(path)
}

fn visit(folder: &Path, action: &mut impl FnMut(&Path) -> io::Result<()>) -> io::Result<()> {
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_dir() {
            visit(&entry.path(), action)?;
        } else if kind.is_file() && supported(&entry.path()) {
            action(&entry.path())?;
        }
    }
    Ok(())
}

fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn book_folders(source: &Path) -> io::Result<Vec<PathBuf>> {
    if regular(&source.join("_index.md")) {
        return Ok(vec![source.to_path_buf()]);
    }
    let collection = source.join("Buches");
    let source = if fs::symlink_metadata(&collection).is_ok_and(|meta| meta.is_dir()) {
        &collection
    } else {
        source
    };
    let mut books = Vec::new();
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        if entry.file_type()?.is_dir()
            && !entry.file_name().to_string_lossy().starts_with('.')
            && regular(&entry.path().join("_index.md"))
        {
            books.push(entry.path());
        }
    }
    books.sort();
    Ok(books)
}

pub fn import(root: &Path, source: &Path) -> io::Result<ImportReport> {
    let folders = book_folders(source)?;
    if folders.is_empty() {
        return Err(invalid(
            "No books found. Choose a book with _index.md, the Buches folder, or its vault.",
        ));
    }
    let collection = root.join("Buches");
    fs::create_dir_all(&collection)?;
    let mut report = ImportReport::default();
    let staging = tempfile::tempdir_in(&collection)?;
    for folder in folders {
        let name = folder
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.starts_with('.') && !name.contains(['\\', ':']))
            .ok_or_else(|| invalid("The selected book has an invalid folder name."))?;
        if collection.join(name).try_exists()? {
            report.skipped.push(name.to_owned());
            continue;
        }
        let staged_book = staging.path().join(name);
        visit(&folder, &mut |file| {
            let relative = file
                .strip_prefix(&folder)
                .map_err(|err| invalid(err.to_string()))?;
            if extension(file) == "md" {
                read_note(file)?;
                note_path(root, &format!("Buches/{name}/{}", relative_path(relative)?))?;
            }
            let target = staged_book.join(relative);
            fs::create_dir_all(target.parent().unwrap())?;
            fs::copy(file, target)?;
            Ok(())
        })?;
        report.imported.push(name.to_owned());
    }
    for name in &report.imported {
        fs::rename(staging.path().join(name), collection.join(name))?;
    }
    Ok(report)
}

pub fn validate_draft(draft: &BookDraft) -> io::Result<()> {
    let title = &draft.title;
    let stem = title
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
    if title.is_empty()
        || title.trim() != title
        || title.starts_with('.')
        || title.ends_with('.')
        || title.contains([
            '\\', '/', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']',
        ])
        || title.chars().any(char::is_control)
        || reserved
    {
        return Err(invalid(
            "Enter a book title that can be used as a library folder name.",
        ));
    }
    if draft.content.chapters.is_empty() {
        return Err(invalid("A book draft must have at least one chapter."));
    }
    if draft.content.chapters.iter().any(|chapter| {
        chapter.title.trim().is_empty() || chapter.title.chars().any(char::is_control)
    }) {
        return Err(invalid("Each chapter needs a single-line title."));
    }
    Ok(())
}

/// Stage a complete Markdown book before making it visible in the app library.
pub fn publish_draft(root: &Path, draft: &BookDraft) -> io::Result<String> {
    validate_draft(draft)?;
    let index_key = format!("Buches/{}/_index.md", draft.title);
    let index_path = note_path(root, &index_key)?;
    let destination = index_path.parent().unwrap();
    if destination.try_exists()? {
        return Err(invalid("A book with that folder name already exists."));
    }
    let collection = root.join("Buches");
    fs::create_dir_all(&collection)?;
    let staging = tempfile::tempdir_in(&collection)?;
    let index = format!(
        "---\ntitle: {}\ntype: buch\n---\n\n{}",
        serde_json::json!(draft.title),
        draft.content.introduction
    );
    write_draft_note(&staging.path().join("_index.md"), &index)?;
    let concepts = staging.path().join("concepts");
    fs::create_dir(&concepts)?;
    for (index, chapter) in draft.content.chapters.iter().enumerate() {
        let order = index + 1;
        let text = format!(
            "---\nname: {}\norder: {order}\ndepends_on: []\n---\n\n{}",
            serde_json::json!(chapter.title),
            chapter.markdown
        );
        write_draft_note(&concepts.join(format!("chapter-{order}.md")), &text)?;
    }
    fs::rename(staging.path(), destination)?;
    Ok(index_key)
}

fn write_draft_note(path: &Path, text: &str) -> io::Result<()> {
    if text.len() as u64 > MAX_NOTE_BYTES {
        return Err(invalid("Markdown files must be smaller than 8 MiB."));
    }
    fs::write(path, text)
}

pub fn load(root: &Path) -> io::Result<Vec<Entry>> {
    let collection = root.join("Buches");
    fs::create_dir_all(&collection)?;
    let initialized = root.join(".initialized");
    if !initialized.try_exists()? {
        let name = "Proofs in Linear Algebra";
        if !collection.join(name).try_exists()? {
            let staging = tempfile::tempdir_in(&collection)?;
            for (relative, source) in DEMO {
                let file = staging.path().join(relative);
                fs::create_dir_all(file.parent().unwrap())?;
                fs::write(file, source)?;
            }
            fs::rename(staging.path(), collection.join(name))?;
        }
        fs::write(initialized, "")?;
    }
    let showcase_seeded = root.join(".showcase-seeded");
    if !showcase_seeded.try_exists()? {
        let name = "The Interactive Extension Showcase";
        if !collection.join(name).try_exists()? {
            let staging = tempfile::tempdir_in(&collection)?;
            for (relative, source) in SHOWCASE {
                let file = staging.path().join(relative);
                fs::create_dir_all(file.parent().unwrap())?;
                fs::write(file, source)?;
            }
            fs::rename(staging.path(), collection.join(name))?;
        }
        fs::write(showcase_seeded, "")?;
    }
    let mut entries = Vec::new();
    visit(&collection, &mut |path| {
        let relative = path
            .strip_prefix(root)
            .map_err(|err| invalid(err.to_string()))?;
        let source = if extension(path) == "md" {
            Some(read_note(path)?)
        } else {
            None
        };
        entries.push(Entry {
            path: relative_path(relative)?,
            source,
        });
        Ok(())
    })?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_book_and_updates_only_the_app_copy() {
        let source = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let book = source.path().join("Buches/Study");
        fs::create_dir_all(book.join("concepts")).unwrap();
        fs::write(book.join("_index.md"), "# Study").unwrap();
        fs::write(book.join("concepts/First.md"), "Old content").unwrap();
        assert_eq!(
            import(root.path(), source.path()).unwrap().imported,
            ["Study"]
        );
        let key = "Buches/Study/concepts/First.md";
        assert!(save(root.path(), key, "New content", Some("stale")).is_err());
        save(root.path(), key, "New content", Some("Old content")).unwrap();
        assert!(save(root.path(), key, "Overwrite", None).is_err());
        assert!(save(root.path(), "Buches/Study/../../escape.md", "", None).is_err());
        assert_eq!(
            fs::read_to_string(book.join("concepts/First.md")).unwrap(),
            "Old content"
        );
        assert_eq!(
            import(root.path(), source.path()).unwrap().skipped,
            ["Study"]
        );
        assert!(load(root.path())
            .unwrap()
            .iter()
            .any(|entry| entry.path == key && entry.source.as_deref() == Some("New content")));
    }

    #[test]
    fn seeds_the_showcase_once_and_respects_deletion() {
        let root = tempfile::tempdir().unwrap();
        let entries = load(root.path()).unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.path == "Buches/The Interactive Extension Showcase/_index.md"));
        fs::remove_dir_all(root.path().join("Buches/The Interactive Extension Showcase")).unwrap();
        let entries = load(root.path()).unwrap();
        assert!(!entries
            .iter()
            .any(|entry| entry.path.starts_with("Buches/The Interactive Extension Showcase/")));
    }

    #[test]
    fn publishes_only_complete_new_book_drafts() {
        let root = tempfile::tempdir().unwrap();
        let mut draft = BookDraft {
            title: "Draft".into(),
            content: BookContent {
                introduction: "Introduction".into(),
                chapters: vec![
                    ChapterDraft {
                        title: "First".into(),
                        markdown: "Proof.".into(),
                    },
                    ChapterDraft {
                        title: "Second".into(),
                        markdown: "x".repeat(MAX_NOTE_BYTES as usize),
                    },
                ],
            },
        };
        assert!(publish_draft(root.path(), &draft).is_err());
        assert!(!root.path().join("Buches/Draft").exists());
        draft.content.chapters[1].markdown = "Example.".into();
        let key = publish_draft(root.path(), &draft).unwrap();
        assert_eq!(key, "Buches/Draft/_index.md");
        let chapter = root.path().join("Buches/Draft/concepts/chapter-2.md");
        assert!(fs::read_to_string(&chapter).unwrap().contains("order: 2"));
        draft.content.chapters[1].markdown = "Overwrite.".into();
        assert!(publish_draft(root.path(), &draft).is_err());
        assert!(fs::read_to_string(chapter).unwrap().ends_with("Example."));
        draft.title = "../Elsewhere".into();
        assert!(publish_draft(root.path(), &draft).is_err());
    }
}
