use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::UNIX_EPOCH;

use ignore::overrides::OverrideBuilder;
use ignore::{WalkBuilder, WalkState};

use super::Lang;

/// Folders skipped even when a project has no `.gitignore` for them.
const ALWAYS_SKIP: &[&str] = &["node_modules/", "__pycache__/", "target/", "dist/", "build/"];

pub struct Entry {
    pub abs: PathBuf,
    pub rel: String,
    pub size: u64,
    /// Modified time in nanoseconds since the Unix epoch, 0 when unknown.
    pub mtime: u64,
    pub lang: Option<Lang>,
}

/// Lists every file under `root` on all cores, honouring `.gitignore`, `.ignore`
/// and hidden-file rules, even outside a git checkout.
pub fn list_files(root: &Path) -> Vec<Entry> {
    let mut overrides = OverrideBuilder::new(root);
    for dir in ALWAYS_SKIP {
        overrides.add(&format!("!{dir}")).expect("static glob");
    }

    let walker = WalkBuilder::new(root)
        .require_git(false)
        .overrides(overrides.build().expect("static globs"))
        .build_parallel();

    let (tx, rx) = mpsc::channel();
    walker.run(|| {
        let tx = tx.clone();
        Box::new(move |result| {
            let Ok(dent) = result else {
                return WalkState::Continue;
            };
            if !dent.file_type().is_some_and(|t| t.is_file()) {
                return WalkState::Continue;
            }
            let Ok(rel) = dent.path().strip_prefix(root) else {
                return WalkState::Continue;
            };
            let rel = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            let meta = dent.metadata().ok();
            let size = meta.as_ref().map_or(0, |m| m.len());
            let mtime = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos() as u64);
            let lang = Lang::from_path(&rel);
            let _ = tx.send(Entry {
                abs: dent.into_path(),
                rel,
                size,
                mtime,
                lang,
            });
            WalkState::Continue
        })
    });
    drop(tx);
    rx.into_iter().collect()
}
