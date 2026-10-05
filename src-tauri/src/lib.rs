pub mod scanner;

use std::path::PathBuf;

use scanner::ScanResult;
use tauri::Manager;

/// Scans a project folder and returns its files plus the import wires between them.
/// Runs on a blocking thread so the UI stays responsive on large repositories.
#[tauri::command]
async fn scan_repository(app: tauri::AppHandle, path: String) -> Result<ScanResult, String> {
    let cache_dir = app.path().app_cache_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan(&PathBuf::from(path), cache_dir.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_repository])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
