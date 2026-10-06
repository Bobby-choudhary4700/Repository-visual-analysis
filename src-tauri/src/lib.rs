mod export;
mod project;
pub mod scanner;
mod watcher;

use std::path::PathBuf;

use project::ProjectState;
use scanner::ScanResult;
use serde::Serialize;
use tauri::{Manager, State};
use watcher::WatcherState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResponse {
    #[serde(flatten)]
    scan: ScanResult,
    /// Whether the open project is being watched, so the UI only claims live updates it has.
    watching: bool,
}

/// Scans a project folder and returns its files plus the import wires between them.
/// Runs on a blocking thread so the UI stays responsive on large repositories.
/// With `watch`, the folder also becomes the open project and is watched for changes.
#[tauri::command]
async fn scan_repository(
    app: tauri::AppHandle,
    watcher_state: State<'_, WatcherState>,
    project: State<'_, ProjectState>,
    path: String,
    watch: bool,
) -> Result<ScanResponse, String> {
    let cache_dir = app.path().app_cache_dir().ok();
    let scan = {
        let path = PathBuf::from(path);
        tauri::async_runtime::spawn_blocking(move || scanner::scan(&path, cache_dir.as_deref()))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    };
    let root = PathBuf::from(&scan.root);
    if watch {
        project.set(root.clone());
        // A folder that cannot be watched is still worth showing, so this failure is not fatal.
        if let Err(e) = watcher::watch(&app, &watcher_state, &root) {
            eprintln!("cannot watch {}: {e}", root.display());
            watcher_state.stop();
        }
    }
    Ok(ScanResponse {
        watching: watcher_state.is_active(),
        scan,
    })
}

/// Shows a file of the open project in the system file manager. Paths outside the
/// project are refused. Files are never opened or run, only revealed.
#[tauri::command]
fn reveal_in_file_manager(project: State<'_, ProjectState>, path: String) -> Result<(), String> {
    let root = project.root().ok_or("no project is open")?;
    let full = project::resolve_in_project(&root, &path)?;
    tauri_plugin_opener::reveal_item_in_dir(full).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .manage(ProjectState::default())
        .invoke_handler(tauri::generate_handler![
            scan_repository,
            reveal_in_file_manager,
            export::save_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
