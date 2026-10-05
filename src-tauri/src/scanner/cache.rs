//! Per-project cache of parsed import specifiers, keyed by file size and modified time.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Bump when the extraction rules change so old caches are ignored.
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
pub struct Entry {
    pub size: u64,
    pub mtime: u64,
    pub specs: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    entries: HashMap<String, Entry>,
}

fn path_for(dir: &Path, root: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    root.hash(&mut hasher);
    dir.join(format!("scan-{:016x}.json", hasher.finish()))
}

/// Returns an empty map when there is no usable cache.
pub fn load(dir: &Path, root: &Path) -> HashMap<String, Entry> {
    fs::read(path_for(dir, root))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CacheFile>(&bytes).ok())
        .filter(|c| c.version == VERSION)
        .map(|c| c.entries)
        .unwrap_or_default()
}

pub fn save(dir: &Path, root: &Path, entries: HashMap<String, Entry>) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let file = CacheFile {
        version: VERSION,
        entries,
    };
    let bytes = serde_json::to_vec(&file).map_err(std::io::Error::other)?;
    // Write then rename so a crash never leaves a half-written cache.
    let target = path_for(dir, root);
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, target)
}
