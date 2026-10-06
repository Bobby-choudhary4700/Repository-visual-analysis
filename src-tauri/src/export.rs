//! Saves an exported picture or diagram where the user chooses. The save dialog runs
//! here rather than in the UI, so the UI can only write to a path the user just picked,
//! and only files of the kinds below.

use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

/// The file kinds the UI exports: extension and the name the save dialog shows.
const KINDS: &[(&str, &str)] = &[
    ("png", "PNG image"),
    ("svg", "SVG image"),
    ("mmd", "Mermaid diagram"),
];

/// The suggested file name arrives URL-encoded in this header; the body is the file.
const NAME_HEADER: &str = "x-file-name";

/// Asks where to save the file the UI sent, then writes it there. Returns the saved
/// file's name, or `None` when the user cancelled the dialog.
#[tauri::command]
pub async fn save_export(
    window: tauri::Window,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("the export arrived without its contents".into());
    };
    let name = request
        .headers()
        .get(NAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .ok_or("the export arrived without a file name")?;
    let (extension, label) = kind_of(&name)?;

    let mut dialog = window
        .dialog()
        .file()
        .set_title("Save the graph")
        .set_file_name(&name)
        .add_filter(label, &[extension]);
    // Attached to the window, so the dialog stays in front of it, as the dialog plugin does.
    #[cfg(desktop)]
    {
        dialog = dialog.set_parent(&window);
    }
    // An async command runs off the main thread, which the blocking dialog needs free.
    let chosen = dialog.blocking_save_file();
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = with_extension(chosen.into_path().map_err(|e| e.to_string())?, extension);
    std::fs::write(&path, data).map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    Ok(Some(
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(name),
    ))
}

/// The extension and dialog label for a suggested file name, refusing other kinds and
/// anything that looks like a path.
fn kind_of(name: &str) -> Result<(&'static str, &'static str), String> {
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err(format!("{name:?} is not a file name"));
    }
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase());
    KINDS
        .iter()
        .find(|(ext, _)| extension.as_deref() == Some(*ext))
        .copied()
        .ok_or_else(|| format!("cannot export {name:?}: only PNG, SVG and Mermaid files"))
}

/// Some save dialogs return the name exactly as typed; a file without the right
/// extension would not open in the program it is meant for.
fn with_extension(path: PathBuf, extension: &str) -> PathBuf {
    let matches = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension));
    if matches {
        path
    } else {
        let mut name = path.into_os_string();
        name.push(".");
        name.push(extension);
        PathBuf::from(name)
    }
}

/// Decodes `%XX` escapes, as `encodeURIComponent` writes them. Bad escapes stay as they are.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(byte) = hex {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_kinds_and_plain_names_are_accepted() {
        assert_eq!(kind_of("repo-graph.png").unwrap().0, "png");
        assert_eq!(kind_of("Repo Graph.SVG").unwrap().0, "svg");
        assert_eq!(kind_of("repo.mmd").unwrap().0, "mmd");
        assert!(kind_of("repo.exe").is_err());
        assert!(kind_of("graph").is_err());
        assert!(kind_of("../graph.png").is_err());
        assert!(kind_of("dir\\graph.png").is_err());
        assert!(kind_of("").is_err());
    }

    #[test]
    fn a_missing_extension_is_added() {
        assert_eq!(
            with_extension("/tmp/graph".into(), "png"),
            PathBuf::from("/tmp/graph.png")
        );
        assert_eq!(
            with_extension("/tmp/graph.PNG".into(), "png"),
            PathBuf::from("/tmp/graph.PNG")
        );
        assert_eq!(
            with_extension("/tmp/my.graph".into(), "svg"),
            PathBuf::from("/tmp/my.graph.svg")
        );
    }

    #[test]
    fn names_are_decoded_like_encode_uri_component_writes_them() {
        assert_eq!(percent_decode("my%20repo-graph.png"), "my repo-graph.png");
        assert_eq!(percent_decode("caf%C3%A9.svg"), "café.svg");
        assert_eq!(percent_decode("100%.png"), "100%.png");
        assert_eq!(percent_decode("%zz.png"), "%zz.png");
    }
}
