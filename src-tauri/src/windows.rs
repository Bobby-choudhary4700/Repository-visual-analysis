//! Opens extra app windows, so different projects can be analysed side by side.
//! Each window keeps its own open project, scan and watcher, keyed by its label.

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The app's name, shown as the title of a window without a project.
pub const APP_TITLE: &str = "Repository Visual Analysis";

/// Labels of windows opened after the first; the capability file grants them by this prefix.
const LABEL_PREFIX: &str = "window-";

static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

/// Opens a new window on the welcome screen.
pub fn open(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let label = loop {
        let label = format!(
            "{LABEL_PREFIX}{}",
            NEXT_WINDOW.fetch_add(1, Ordering::Relaxed)
        );
        if app.get_webview_window(&label).is_none() {
            break label;
        }
    };
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(APP_TITLE)
        .inner_size(1280.0, 800.0)
        .build()
}

/// The title of a window showing the project at `root`, so windows can be told apart
/// in the taskbar and window switcher.
pub fn title_for(root: &std::path::Path) -> String {
    match root.file_name() {
        Some(name) => format!("{} - {APP_TITLE}", name.to_string_lossy()),
        None => APP_TITLE.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn titles_name_the_project() {
        assert_eq!(
            title_for(Path::new("/home/me/code/my-app")),
            "my-app - Repository Visual Analysis"
        );
        assert_eq!(title_for(Path::new("/")), APP_TITLE);
    }
}
