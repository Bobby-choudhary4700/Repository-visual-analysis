mod export;
mod project;
pub mod scanner;
mod watcher;
mod windows;

use std::path::PathBuf;

use project::ProjectState;
use scanner::ScanResult;
use serde::Serialize;
use tauri::{Manager, State, WindowEvent};
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
/// With `watch`, the folder also becomes the calling window's open project and is
/// watched for changes. Other windows keep their own projects.
#[tauri::command]
async fn scan_repository(
    app: tauri::AppHandle,
    window: tauri::Window,
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
    let label = window.label();
    if watch {
        project.set(label, root.clone());
        let _ = window.set_title(&windows::title_for(&root));
        // A folder that cannot be watched is still worth showing, so this failure is not fatal.
        if let Err(e) = watcher::watch(&app, &watcher_state, label, &root) {
            eprintln!("cannot watch {}: {e}", root.display());
            watcher_state.stop(label);
        }
    }
    Ok(ScanResponse {
        watching: watcher_state.is_active(label),
        scan,
    })
}

/// Shows a file of the window's open project in the system file manager. Paths outside
/// the project are refused. Files are never opened or run, only revealed.
#[tauri::command]
fn reveal_in_file_manager(
    window: tauri::Window,
    project: State<'_, ProjectState>,
    path: String,
) -> Result<(), String> {
    let root = project.root(window.label()).ok_or("no project is open")?;
    let full = project::resolve_in_project(&root, &path)?;
    tauri_plugin_opener::reveal_item_in_dir(full).map_err(|e| e.to_string())
}

/// Closes the window's project when the UI goes back to the home screen: stops watching
/// it, stops showing its files in the file manager and puts back the plain window title.
#[tauri::command]
fn close_project(
    window: tauri::Window,
    watcher_state: State<'_, WatcherState>,
    project: State<'_, ProjectState>,
) {
    let label = window.label();
    watcher_state.stop(label);
    project.remove(label);
    let _ = window.set_title(windows::APP_TITLE);
}

/// Opens another app window, so a second project can be analysed alongside this one.
/// Async, because creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
async fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    windows::open(&app).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .manage(ProjectState::default())
        .on_window_event(|window, event| {
            // A closed window's project is forgotten and no longer watched.
            if let WindowEvent::Destroyed = event {
                let label = window.label();
                window.state::<WatcherState>().stop(label);
                window.state::<ProjectState>().remove(label);
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_repository,
            reveal_in_file_manager,
            close_project,
            open_new_window,
            export::save_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
