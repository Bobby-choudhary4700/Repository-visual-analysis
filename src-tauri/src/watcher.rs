//! Watches the project open in each window and tells that window when its files change.
//!
//! Events are debounced, because one save from an editor or one `git checkout`
//! produces many of them. The frontend answers by scanning again, which is cheap:
//! only the files that actually changed are re-parsed.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, EventTarget};

/// Emitted to the window whose project changed, once a burst of file changes has settled.
pub const CHANGED_EVENT: &str = "repository-changed";

/// How long the changes must stay quiet before the frontend is told.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// Folders whose churn should never trigger a rescan; they are not scanned either.
const SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
];

/// Holds the watcher for each window's project, by window label. Dropping a watcher
/// stops the watch, which in turn ends its debounce thread, so opening another project
/// or closing the window cleans up the old one.
#[derive(Default)]
pub struct WatcherState(Mutex<HashMap<String, RecommendedWatcher>>);

impl WatcherState {
    /// Stops a window's watch, so a project that failed to watch is not served by the
    /// previous one's watcher, and a closed window's project is no longer watched.
    pub fn stop(&self, window: &str) {
        if let Ok(mut watchers) = self.0.lock() {
            watchers.remove(window);
        }
    }

    pub fn is_active(&self, window: &str) -> bool {
        self.0
            .lock()
            .is_ok_and(|watchers| watchers.contains_key(window))
    }
}

/// Replaces the window's watch, if any, with a recursive watch of `root` whose
/// changes are reported to that window only.
pub fn watch(
    app: &AppHandle,
    state: &WatcherState,
    window: &str,
    root: &Path,
) -> Result<(), String> {
    let app = app.clone();
    let target = EventTarget::webview_window(window);
    let watcher = spawn_watch(root, move || {
        app.emit_to(target.clone(), CHANGED_EVENT, ()).is_ok()
    })?;
    // Replacing the stored watcher drops the previous one, stopping the old watch.
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(window.to_owned(), watcher);
    Ok(())
}

/// Watches `root` and calls `on_change` once per settled burst of changes, on its own
/// thread. The thread stops when `on_change` returns false or the watcher is dropped.
fn spawn_watch(
    root: &Path,
    on_change: impl Fn() -> bool + Send + 'static,
) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        ) {
            return;
        }
        if event.paths.iter().all(|p| is_noise(p)) {
            return;
        }
        // The receiver is gone once the watcher is replaced; the error ends this callback's work.
        let _ = tx.send(());
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        // Each burst: wait for the first change, then for a quiet gap, then report once.
        while rx.recv().is_ok() {
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(()) => continue,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if !on_change() {
                return;
            }
        }
    });

    Ok(watcher)
}

/// True for paths inside folders the scanner ignores anyway.
fn is_noise(path: &Path) -> bool {
    path.components()
        .any(|c| SKIP.contains(&c.as_os_str().to_string_lossy().as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drives the real watcher over a temporary folder: a burst of edits must report
    /// once, churn in an ignored folder must report not at all.
    #[test]
    fn reports_once_per_burst_and_skips_ignored_folders() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("a.rs"), "").unwrap();
        std::fs::create_dir(root.join("target")).unwrap();

        let (tx, rx) = mpsc::channel();
        let watcher = spawn_watch(root, move || tx.send(()).is_ok()).unwrap();

        // One burst of several writes.
        for i in 0..5 {
            std::fs::write(root.join("a.rs"), format!("// {i}")).unwrap();
            std::thread::sleep(Duration::from_millis(20));
        }
        rx.recv_timeout(Duration::from_secs(5))
            .expect("a change should be reported");
        assert_eq!(
            rx.recv_timeout(DEBOUNCE * 3),
            Err(RecvTimeoutError::Timeout),
            "one burst should be reported only once",
        );

        // Build output churns constantly and must not trigger a rescan.
        std::fs::write(root.join("target/out.bin"), "x").unwrap();
        assert_eq!(
            rx.recv_timeout(DEBOUNCE * 3),
            Err(RecvTimeoutError::Timeout),
            "changes under target/ should be ignored",
        );

        // A second burst is reported again.
        std::fs::write(root.join("b.rs"), "fn main() {}").unwrap();
        rx.recv_timeout(Duration::from_secs(5))
            .expect("a later change should be reported");

        drop(watcher);
    }

    #[test]
    fn noise_is_only_ignored_folders() {
        assert!(is_noise(Path::new("/p/.git/index")));
        assert!(is_noise(Path::new("/p/web/node_modules/x/a.js")));
        assert!(!is_noise(Path::new("/p/src/main.rs")));
        assert!(!is_noise(Path::new("/p/src/building.rs")));
    }
}
