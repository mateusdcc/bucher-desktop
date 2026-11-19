#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod chatgpt;
mod library;

use library::{Entry, ImportReport};
use std::{io, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

static FILES: Mutex<()> = Mutex::new(());

pub(crate) fn with_library<T>(
    app: &AppHandle,
    operation: impl FnOnce(PathBuf) -> io::Result<T>,
) -> Result<T, String> {
    let _guard = FILES.lock().map_err(|err| err.to_string())?;
    let root = app.path().app_data_dir().map_err(|err| err.to_string())?;
    operation(root).map_err(|err| err.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Library {
    base_path: PathBuf,
    entries: Vec<Entry>,
}

/// Return UTF-8 Markdown and available attachment paths from the app library.
#[tauri::command]
async fn load_library(app: AppHandle) -> Result<Library, String> {
    with_library(&app, |base_path| {
        let entries = library::load(&base_path)?;
        Ok(Library { base_path, entries })
    })
}

/// Select a book, a Bücher collection or a vault, then copy compatible books into the library.
#[tauri::command]
async fn import_books(app: AppHandle) -> Result<Option<ImportReport>, String> {
    let folder = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_title("Import Bücher books")
                .blocking_pick_folder()
        }
    })
    .await
    .map_err(|err| err.to_string())?;
    let Some(folder) = folder else {
        return Ok(None);
    };
    let source = folder.into_path().map_err(|err| err.to_string())?;
    with_library(&app, |root| library::import(&root, &source)).map(Some)
}

/// Atomically create or replace a Markdown file. Replacements require the original contents.
#[tauri::command]
async fn save_markdown(
    app: AppHandle,
    path: String,
    text: String,
    expected: Option<String>,
) -> Result<(), String> {
    with_library(&app, |root| {
        library::save(&root, &path, &text, expected.as_deref())
    })
}

/// Roll back a newly created solution note if its contents still match.
#[tauri::command]
async fn discard_solution(app: AppHandle, path: String, expected: String) -> Result<(), String> {
    with_library(&app, |root| {
        library::discard_solution(&root, &path, &expected)
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_library,
            import_books,
            save_markdown,
            discard_solution,
            chatgpt::chatgpt_login,
            chatgpt::chatgpt_status,
            chatgpt::chatgpt_logout,
            chatgpt::chatgpt_models,
            chatgpt::chatgpt_usage,
            ai::ai_list_models,
            ai::ai_ollama_status,
            ai::ai_explain,
            ai::ai_generate_solution,
            ai::ai_review_solution,
            ai::ai_propose_patch,
            ai::ai_prepare_import,
            ai::ai_import_book
        ])
        .run(tauri::generate_context!())
        .expect("Bücher could not start");
}
