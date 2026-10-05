pub mod scanner;
mod watcher;

use std::path::PathBuf;

use scanner::ScanResult;
use tauri::{Manager, State};
use watcher::WatcherState;

/// Scans a project folder and returns its files plus the import wires between them.
/// Runs on a blocking thread so the UI stays responsive on large repositories.
/// The first scan of a folder also starts watching it for changes.
#[tauri::command]
async fn scan_repository(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    path: String,
    watch: bool,
) -> Result<ScanResult, String> {
    let root = PathBuf::from(path);
    let cache_dir = app.path().app_cache_dir().ok();
    let scanned = {
        let root = root.clone();
        tauri::async_runtime::spawn_blocking(move || scanner::scan(&root, cache_dir.as_deref()))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    };
    // A folder that cannot be watched is still worth showing, so this failure is not fatal.
    if watch {
        if let Err(e) = watcher::watch(&app, &state, &root) {
            eprintln!("cannot watch {}: {e}", root.display());
        }
    }
    Ok(scanned)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![scan_repository])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
