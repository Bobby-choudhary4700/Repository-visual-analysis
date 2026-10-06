//! Remembers the open project so the UI can show its files in the system file
//! manager, without letting the UI reach any path outside it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct ProjectState(Mutex<Option<PathBuf>>);

impl ProjectState {
    pub fn set(&self, root: PathBuf) {
        if let Ok(mut current) = self.0.lock() {
            *current = Some(root);
        }
    }

    /// Forgets the open project, so no path resolves until another one opens.
    pub fn clear(&self) {
        if let Ok(mut current) = self.0.lock() {
            *current = None;
        }
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.0.lock().ok()?.clone()
    }
}

/// Joins a project-relative path onto `root`, refusing anything that lands outside it
/// through `..`, an absolute path or a symlink.
pub fn resolve_in_project(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let full = root
        .join(rel)
        .canonicalize()
        .map_err(|_| format!("{rel} no longer exists"))?;
    if full.starts_with(&root) {
        Ok(full)
    } else {
        Err(format!("{rel} is outside the open project"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn only_paths_inside_the_project_resolve() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("project");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/main.rs"), "").unwrap();
        fs::write(outer.path().join("secret.txt"), "").unwrap();

        let ok = resolve_in_project(&root, "src/main.rs").unwrap();
        assert!(ok.ends_with("src/main.rs"));

        assert!(resolve_in_project(&root, "../secret.txt").is_err());
        let absolute = outer.path().join("secret.txt");
        assert!(resolve_in_project(&root, absolute.to_str().unwrap()).is_err());
        assert!(resolve_in_project(&root, "src/missing.rs").is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outer.path().join("secret.txt"), root.join("link.txt")).unwrap();
            assert!(resolve_in_project(&root, "link.txt").is_err(), "a symlink must not escape");
        }
    }
}
