//! The export manager's list: every picture or diagram the app saved, kept in the
//! user's app data folder so it outlives the window and the app. The UI only ever names
//! an entry by its id, so showing one in the file manager can only reach a file the app
//! itself wrote; nothing here opens or runs a file.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

const FILE_NAME: &str = "exports.json";
/// Older entries fall off the end of the list.
const MAX_ENTRIES: usize = 200;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecord {
    pub id: u64,
    /// Where the file was saved, in full.
    pub path: String,
    /// The project the export came from, if any.
    pub project: Option<String>,
    /// When it was saved, in milliseconds since 1970.
    pub saved_at: u64,
    pub size: u64,
}

/// An entry as the UI shows it, with whether the file is still where it was saved.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEntry {
    #[serde(flatten)]
    record: ExportRecord,
    name: String,
    folder: String,
    kind: String,
    exists: bool,
}

/// Guards the list file, so two windows saving at once do not lose an entry.
#[derive(Default)]
pub struct ExportHistory(Mutex<()>);

fn list_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|e| e.to_string())
}

/// The saved list; a missing or damaged file reads as an empty list.
fn load(file: &Path) -> Vec<ExportRecord> {
    fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn store(file: &Path, records: &[ExportRecord]) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(records).map_err(|e| e.to_string())?;
    // Written beside the list and moved over it, so a crash never leaves half a file.
    let partial = file.with_extension("json.partial");
    fs::write(&partial, json).map_err(|e| e.to_string())?;
    fs::rename(&partial, file).map_err(|e| e.to_string())
}

/// Puts a new export at the top of the list, replacing an older entry for the same file.
fn push(records: &mut Vec<ExportRecord>, record: ExportRecord) {
    records.retain(|r| r.path != record.path);
    records.insert(0, record);
    records.truncate(MAX_ENTRIES);
}

/// Adds a file the app just saved. Failing to remember it does not fail the export.
pub fn record(app: &tauri::AppHandle, path: &Path, project: Option<String>) {
    let history = app.state::<ExportHistory>();
    let Ok(_guard) = history.0.lock() else { return };
    let Ok(file) = list_path(app) else { return };
    let saved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut records = load(&file);
    // Ids only need to be unique within the list; time plus one beats any earlier id.
    let id = records
        .iter()
        .map(|r| r.id + 1)
        .max()
        .unwrap_or(0)
        .max(saved_at);
    let record = ExportRecord {
        id,
        path: path.to_string_lossy().into_owned(),
        project,
        saved_at,
        size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
    };
    push(&mut records, record);
    if let Err(e) = store(&file, &records) {
        eprintln!("cannot remember the export: {e}");
    }
}

fn entry(record: ExportRecord) -> ExportEntry {
    let path = Path::new(&record.path);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| record.path.clone());
    let folder = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let kind = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    ExportEntry {
        exists: path.is_file(),
        name,
        folder,
        kind,
        record,
    }
}

/// Every remembered export, newest first.
#[tauri::command]
pub fn list_exports(
    app: tauri::AppHandle,
    history: State<'_, ExportHistory>,
) -> Result<Vec<ExportEntry>, String> {
    let _guard = history.0.lock().map_err(|e| e.to_string())?;
    Ok(load(&list_path(&app)?).into_iter().map(entry).collect())
}

/// Takes one entry off the list. The file itself is left alone.
#[tauri::command]
pub fn forget_export(
    app: tauri::AppHandle,
    history: State<'_, ExportHistory>,
    id: u64,
) -> Result<(), String> {
    let _guard = history.0.lock().map_err(|e| e.to_string())?;
    let file = list_path(&app)?;
    let mut records = load(&file);
    records.retain(|r| r.id != id);
    store(&file, &records)
}

/// Empties the list. The files themselves are left alone.
#[tauri::command]
pub fn clear_exports(
    app: tauri::AppHandle,
    history: State<'_, ExportHistory>,
) -> Result<(), String> {
    let _guard = history.0.lock().map_err(|e| e.to_string())?;
    store(&list_path(&app)?, &[])
}

/// Shows a remembered export in the system file manager. Only files on the list can be
/// shown, and they are revealed, never opened.
#[tauri::command]
pub fn reveal_export(
    app: tauri::AppHandle,
    history: State<'_, ExportHistory>,
    id: u64,
) -> Result<(), String> {
    let path = {
        let _guard = history.0.lock().map_err(|e| e.to_string())?;
        load(&list_path(&app)?)
            .into_iter()
            .find(|r| r.id == id)
            .map(|r| PathBuf::from(r.path))
            .ok_or("that export is no longer on the list")?
    };
    if !path.is_file() {
        return Err(format!("{} has been moved or deleted", path.display()));
    }
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(id: u64, path: &str) -> ExportRecord {
        ExportRecord {
            id,
            path: path.into(),
            project: Some("demo".into()),
            saved_at: id,
            size: 1,
        }
    }

    #[test]
    fn newest_first_without_duplicates_and_capped() {
        let mut records = Vec::new();
        push(&mut records, rec(1, "/a.png"));
        push(&mut records, rec(2, "/b.svg"));
        push(&mut records, rec(3, "/a.png"));
        assert_eq!(records.iter().map(|r| r.id).collect::<Vec<_>>(), [3, 2]);

        for i in 10..(10 + MAX_ENTRIES as u64) {
            push(&mut records, rec(i, &format!("/{i}.png")));
        }
        assert_eq!(records.len(), MAX_ENTRIES);
        assert_eq!(records[0].id, 9 + MAX_ENTRIES as u64);
    }

    #[test]
    fn the_list_survives_a_round_trip_and_damage_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join(FILE_NAME);
        assert!(load(&file).is_empty());

        let records = vec![rec(2, "/b.svg"), rec(1, "/a.png")];
        store(&file, &records).unwrap();
        assert_eq!(load(&file), records);

        fs::write(&file, "not json").unwrap();
        assert!(load(&file).is_empty());
    }

    #[test]
    fn entries_say_whether_the_file_is_still_there() {
        let dir = tempfile::tempdir().unwrap();
        let saved = dir.path().join("graph.PNG");
        fs::write(&saved, "x").unwrap();
        let here = entry(rec(1, saved.to_str().unwrap()));
        assert!(here.exists);
        assert_eq!(here.name, "graph.PNG");
        assert_eq!(here.kind, "png");
        assert_eq!(here.folder, dir.path().to_str().unwrap());

        let gone = entry(rec(2, dir.path().join("gone.svg").to_str().unwrap()));
        assert!(!gone.exists);
    }
}
