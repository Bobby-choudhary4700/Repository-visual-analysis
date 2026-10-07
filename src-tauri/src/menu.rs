//! The app's menus. On Windows and Linux the window is frameless and the UI draws its
//! own title bar with File, Edit, View, Export, Window and Help, so the native menu is
//! only built on macOS, where it lives in the screen's top bar. There, a few items act
//! here (new window, close window, full screen, quit, web links); the rest are sent to
//! the window in front as a `menu` event, and the UI runs the same action its own menus,
//! buttons and shortcuts run.

use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{
    IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewWindow};

use crate::windows;

/// The event the UI listens for.
const MENU_EVENT: &str = "menu";
/// The Open Recent submenu, refilled whenever the UI's recent projects change.
const RECENT_MENU: &str = "file.recent";
/// Items of the Open Recent submenu are this prefix plus their place in the list.
const RECENT_PREFIX: &str = "recent:";

const REPO_URL: &str = "https://github.com/Bobby-choudhary4700/Repository-visual-analysis";
const ISSUES_URL: &str = "https://github.com/Bobby-choudhary4700/Repository-visual-analysis/issues";
const MERMAID_DOCS_URL: &str = "https://mermaid.js.org/";

/// The recent project folders the Open Recent items stand for, in menu order.
#[derive(Default)]
pub struct RecentMenu(Mutex<Vec<String>>);

/// What the UI is asked to do. `path` is set for an Open Recent item.
#[derive(Clone, Serialize)]
struct MenuAction {
    action: String,
    path: Option<String>,
}

/// Builds the native menu bar (macOS only). Items sent to the UI use its action names as
/// their ids.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app, id, text, true, accelerator)
    };

    let recent = SubmenuBuilder::with_id(app, RECENT_MENU, "Open Recent")
        .item(&MenuItem::new(
            app,
            "No recent folders",
            false,
            None::<&str>,
        )?)
        .build()?;
    let mermaid = SubmenuBuilder::new(app, "Open Mermaid")
        .item(&item("mermaid-open-file", "Open Mermaid File…", None)?)
        .item(&item(
            "mermaid-viewer",
            "Open Mermaid Viewer",
            Some("CmdOrCtrl+Shift+M"),
        )?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(
            "new-window",
            "New Window",
            Some("CmdOrCtrl+Shift+N"),
        )?)
        .item(&item("open-folder", "Open Folder…", Some("CmdOrCtrl+O"))?)
        .item(&recent)
        .item(&mermaid)
        .separator();
    // On macOS, Settings and Quit live in the app menu instead.
    #[cfg(not(target_os = "macos"))]
    let file = file
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator();
    let file = file
        .item(&item("close-folder", "Close Folder", None)?)
        .item(&item("close-window", "Close Window", Some("CmdOrCtrl+W"))?);
    #[cfg(not(target_os = "macos"))]
    let file = file
        .separator()
        .item(&item("exit", "Exit", Some("CmdOrCtrl+Q"))?);
    let file = file.build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&item("find", "Find File…", Some("CmdOrCtrl+K"))?)
        .build()?;

    let theme = SubmenuBuilder::new(app, "Theme")
        .item(&item("theme-dark", "Dark", None)?)
        .item(&item("theme-light", "Light", None)?)
        .item(&item("theme-system", "Match System", None)?)
        .build()?;
    let color = SubmenuBuilder::new(app, "Colour By")
        .item(&item("color-type", "File Type", None)?)
        .item(&item("color-folder", "Folder", None)?)
        .item(&item("color-links", "Links", None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item(
            "toggle-explorer",
            "Show or Hide Explorer",
            Some("CmdOrCtrl+B"),
        )?)
        .separator()
        .item(&item("view-3d", "3D View", None)?)
        .item(&item("view-2d", "2D View", None)?)
        .item(&color)
        .item(&item("auto-rotate", "Turn Slowly (3D)", None)?)
        .item(&item(
            "hide-noise",
            "Hide or Show Tests, Docs and Examples",
            None,
        )?)
        .separator()
        .item(&item("zoom-in", "Zoom In", None)?)
        .item(&item("zoom-out", "Zoom Out", None)?)
        .item(&item("fit", "Fit to Screen", None)?)
        .separator()
        .item(&theme)
        .item(&item("fullscreen", "Toggle Full Screen", Some("F11"))?)
        .build()?;

    let export = SubmenuBuilder::new(app, "Export")
        .item(&item("export-png", "Save Graph as PNG…", None)?)
        .item(&item("export-svg", "Save Graph as SVG…", None)?)
        .item(&item("export-mermaid", "Save Graph as Mermaid…", None)?)
        .item(&item("copy-mermaid", "Copy Graph as Mermaid", None)?)
        .item(&item(
            "export-viewer",
            "Open Graph in Mermaid Viewer",
            None,
        )?)
        .separator()
        .item(&item(
            "export-manager",
            "Export Manager…",
            Some("CmdOrCtrl+Shift+E"),
        )?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&item("new-window", "New Window", None)?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item(
            "shortcuts",
            "Keyboard Shortcuts",
            Some("CmdOrCtrl+/"),
        )?)
        .separator()
        .item(&item("github", "Project on GitHub", None)?)
        .item(&item("report-issue", "Report an Issue", None)?);
    #[cfg(not(target_os = "macos"))]
    let help = help
        .separator()
        .item(&item("about", "About Repository Visual Analysis", None)?);
    let help = help.build()?;

    let mut menus: Vec<&dyn IsMenuItem<R>> = Vec::new();
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, windows::APP_TITLE)
        .item(&item("about", "About Repository Visual Analysis", None)?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&item(
            "exit",
            "Quit Repository Visual Analysis",
            Some("CmdOrCtrl+Q"),
        )?)
        .build()?;
    #[cfg(target_os = "macos")]
    menus.push(&app_menu);
    menus.extend([
        &file as &dyn IsMenuItem<R>,
        &edit,
        &view,
        &export,
        &window,
        &help,
    ]);
    Menu::with_items(app, &menus)
}

/// Runs a clicked menu item: here when it is about windows or the app, otherwise in
/// the window in front.
pub fn handle(app: &AppHandle, id: &str) {
    let window = front_window(app);
    let result = match id {
        "new-window" => windows::open(app).map(|_| ()),
        "close-window" => window.map_or(Ok(()), |w| w.close()),
        "exit" => {
            app.exit(0);
            Ok(())
        }
        "fullscreen" => window.map_or(Ok(()), |w| {
            let on = w.is_fullscreen().unwrap_or(false);
            w.set_fullscreen(!on)
        }),
        "github" | "report-issue" => {
            if let Err(e) = open_link(id.to_owned(), None) {
                eprintln!("{e}");
            }
            Ok(())
        }
        _ => {
            let Some(window) = window else { return };
            let action = match id.strip_prefix(RECENT_PREFIX) {
                Some(index) => {
                    let paths = app.state::<RecentMenu>();
                    let path = index
                        .parse::<usize>()
                        .ok()
                        .and_then(|i| paths.0.lock().ok()?.get(i).cloned());
                    let Some(path) = path else { return };
                    MenuAction {
                        action: "open-recent".into(),
                        path: Some(path),
                    }
                }
                None => MenuAction {
                    action: id.to_owned(),
                    path: None,
                },
            };
            app.emit_to(
                EventTarget::webview_window(window.label()),
                MENU_EVENT,
                action,
            )
        }
    };
    if let Err(e) = result {
        eprintln!("menu item {id} failed: {e}");
    }
}

/// Opens one of the app's web pages in the browser: the project ("github"), its issue
/// tracker ("report-issue"), or Mermaid's documentation ("mermaid-docs"), optionally at
/// one syntax page such as `flowchart.html`. Only these fixed sites; files are never opened.
#[tauri::command]
pub fn open_link(which: String, page: Option<String>) -> Result<(), String> {
    let url = match which.as_str() {
        "github" => REPO_URL.to_owned(),
        "report-issue" => ISSUES_URL.to_owned(),
        "mermaid-docs" => mermaid_docs_url(page.as_deref().unwrap_or(""))?,
        _ => return Err(format!("no link called {which}")),
    };
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("cannot open {url}: {e}"))
}

/// A page under Mermaid's syntax docs. The page is a plain file name, so the link cannot
/// leave the docs site.
fn mermaid_docs_url(page: &str) -> Result<String, String> {
    if page.is_empty() {
        return Ok(format!("{MERMAID_DOCS_URL}intro/"));
    }
    let plain = page.strip_suffix(".html").is_some_and(|stem| {
        !stem.is_empty()
            && stem
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    });
    if !plain {
        return Err(format!("not a Mermaid docs page: {page}"));
    }
    Ok(format!("{MERMAID_DOCS_URL}syntax/{page}"))
}

/// Quits the app, closing every window: File > Exit in the UI's own menus.
#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

/// The window the menu was used in: the focused one, or else the first window.
fn front_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next())
        .cloned()
}

/// Refills Open Recent with the UI's recent project folders, newest first.
#[tauri::command]
pub fn set_recent_menu(
    app: AppHandle,
    state: tauri::State<'_, RecentMenu>,
    paths: Vec<String>,
) -> Result<(), String> {
    let paths: Vec<String> = paths.into_iter().take(10).collect();
    if let Ok(mut stored) = state.0.lock() {
        stored.clone_from(&paths);
    }
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(MenuItemKind::Submenu(recent)) =
        find(&menu.items().map_err(|e| e.to_string())?, RECENT_MENU)
    else {
        return Ok(());
    };
    fill_recent(&app, &recent, &paths).map_err(|e| e.to_string())
}

fn fill_recent(
    app: &AppHandle,
    recent: &Submenu<tauri::Wry>,
    paths: &[String],
) -> tauri::Result<()> {
    for item in recent.items()? {
        recent.remove(&item)?;
    }
    if paths.is_empty() {
        recent.append(&MenuItem::new(
            app,
            "No recent folders",
            false,
            None::<&str>,
        )?)?;
        return Ok(());
    }
    for (i, path) in paths.iter().enumerate() {
        recent.append(&MenuItem::with_id(
            app,
            format!("{RECENT_PREFIX}{i}"),
            menu_label(path),
            true,
            None::<&str>,
        )?)?;
    }
    recent.append(&PredefinedMenuItem::separator(app)?)?;
    recent.append(&MenuItem::with_id(
        app,
        "clear-recent",
        "Clear Recent",
        true,
        None::<&str>,
    )?)?;
    Ok(())
}

/// Finds a submenu by id anywhere in the menu bar.
fn find<R: Runtime>(items: &[MenuItemKind<R>], id: &str) -> Option<MenuItemKind<R>> {
    for item in items {
        if let MenuItemKind::Submenu(sub) = item {
            if sub.id() == id {
                return Some(item.clone());
            }
            if let Some(found) = sub.items().ok().and_then(|inner| find(&inner, id)) {
                return Some(found);
            }
        }
    }
    None
}

/// A recent folder as a menu item: its full path, with `&` doubled so the menu does not
/// read it as a keyboard mnemonic.
fn menu_label(path: &str) -> String {
    path.replace('&', "&&")
}

#[cfg(test)]
mod tests {
    use super::mermaid_docs_url;

    #[test]
    fn mermaid_docs_stay_on_the_docs_site() {
        assert_eq!(
            mermaid_docs_url("").unwrap(),
            "https://mermaid.js.org/intro/"
        );
        assert_eq!(
            mermaid_docs_url("flowchart.html").unwrap(),
            "https://mermaid.js.org/syntax/flowchart.html"
        );
        for bad in [
            "../x.html",
            "a/b.html",
            "x",
            ".html",
            "https://evil.example/x.html",
            "x.html?y",
        ] {
            assert!(mermaid_docs_url(bad).is_err(), "{bad}");
        }
    }
}
