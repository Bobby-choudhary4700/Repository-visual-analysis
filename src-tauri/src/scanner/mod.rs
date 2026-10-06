//! Walks a project folder, extracts import statements and turns them into a file graph.
//!
//! The work is split so large repositories stay fast:
//! 1. `walk` lists files on all cores and skips anything `.gitignore` excludes.
//! 2. `imports` parses only supported source files with tree-sitter, in parallel,
//!    reusing cached results for files whose size and modified time are unchanged.
//! 3. `resolve` maps each import specifier to a file inside the project, following
//!    tsconfig path aliases (`aliases`) for JavaScript and TypeScript.

mod aliases;
mod cache;
mod imports;
mod resolve;
mod walk;

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use rayon::prelude::*;
use serde::Serialize;

pub use imports::Lang;

/// Files larger than this are listed but not parsed (minified bundles, generated code).
const MAX_PARSE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    /// Absolute path of the scanned folder.
    pub root: String,
    pub files: Vec<FileNode>,
    pub edges: Vec<Edge>,
    pub stats: ScanStats,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    /// Path relative to the root, always `/`-separated.
    pub path: String,
    pub size: u64,
    pub lang: Option<Lang>,
}

/// A wire from one file to a file it imports, as indexes into `ScanResult::files`.
#[derive(Debug, Serialize, PartialEq, Eq, Hash, Clone, Copy)]
pub struct Edge {
    pub from: u32,
    pub to: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub files: usize,
    pub parsed: usize,
    pub cached: usize,
    pub elapsed_ms: u64,
}

pub fn scan(root: &Path, cache_dir: Option<&Path>) -> Result<ScanResult, String> {
    let started = Instant::now();
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot open {}: {e}", root.display()))?;
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }

    let mut entries = walk::list_files(&root);
    entries.sort_by(|a, b| a.rel.cmp(&b.rel));

    let old_cache = cache_dir.map(|dir| cache::load(dir, &root)).unwrap_or_default();

    // Parse in parallel. Each result carries whether it came from the cache.
    let specs: Vec<(Vec<String>, bool)> = entries
        .par_iter()
        .map_init(imports::Extractor::new, |extractor, entry| {
            let Some(lang) = entry.lang else {
                return (Vec::new(), false);
            };
            if entry.size > MAX_PARSE_BYTES {
                return (Vec::new(), false);
            }
            if let Some(hit) = old_cache.get(&entry.rel) {
                if hit.size == entry.size && hit.mtime == entry.mtime {
                    return (hit.specs.clone(), true);
                }
            }
            let specs = std::fs::read(&entry.abs)
                .map(|source| extractor.extract(lang, &source))
                .unwrap_or_default();
            (specs, false)
        })
        .collect();

    let index: HashMap<&str, u32> = entries
        .iter()
        .enumerate()
        .map(|(i, e)| (e.rel.as_str(), i as u32))
        .collect();

    // Read on every scan rather than cached, so editing a tsconfig redraws the wires.
    let paths: Vec<&str> = entries.iter().map(|e| e.rel.as_str()).collect();
    let aliases = aliases::Aliases::load(&root, &paths);

    let mut edges = HashSet::new();
    for (i, entry) in entries.iter().enumerate() {
        let Some(lang) = entry.lang else { continue };
        for spec in &specs[i].0 {
            let exists = |p: &str| index.contains_key(p);
            for target in resolve::resolve(lang, &entry.rel, spec, &aliases, exists) {
                let to = index[target.as_str()];
                if to != i as u32 {
                    edges.insert(Edge { from: i as u32, to });
                }
            }
        }
    }
    let mut edges: Vec<Edge> = edges.into_iter().collect();
    edges.sort_by_key(|e| (e.from, e.to));

    let parsed = entries
        .iter()
        .zip(&specs)
        .filter(|(e, (_, cached))| e.lang.is_some() && e.size <= MAX_PARSE_BYTES && !cached)
        .count();
    let cached = specs.iter().filter(|(_, cached)| *cached).count();

    if let Some(dir) = cache_dir {
        let new_cache = entries
            .iter()
            .zip(&specs)
            .filter(|(e, _)| e.lang.is_some() && e.size <= MAX_PARSE_BYTES)
            .map(|(e, (specs, _))| {
                (
                    e.rel.clone(),
                    cache::Entry {
                        size: e.size,
                        mtime: e.mtime,
                        specs: specs.clone(),
                    },
                )
            })
            .collect();
        // A failed cache write only costs speed on the next scan.
        let _ = cache::save(dir, &root, new_cache);
    }

    let files = entries
        .into_iter()
        .map(|e| FileNode {
            path: e.rel,
            size: e.size,
            lang: e.lang,
        })
        .collect::<Vec<_>>();

    Ok(ScanResult {
        root: root.to_string_lossy().into_owned(),
        stats: ScanStats {
            files: files.len(),
            parsed,
            cached,
            elapsed_ms: started.elapsed().as_millis() as u64,
        },
        files,
        edges,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    fn wires(result: &ScanResult) -> Vec<(String, String)> {
        result
            .edges
            .iter()
            .map(|e| {
                (
                    result.files[e.from as usize].path.clone(),
                    result.files[e.to as usize].path.clone(),
                )
            })
            .collect()
    }

    #[test]
    fn scans_mixed_project_and_uses_cache() {
        let project = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let root = project.path();
        write(root, ".gitignore", "build/\n");
        write(root, "build/out.js", "import './skipped';");
        write(root, "node_modules/lib/index.js", "");
        write(
            root,
            "web/main.ts",
            "import { a } from './util';\nimport React from 'react';\nexport * from '../web/types.js';\nconst x = require('./legacy');",
        );
        write(root, "web/util/index.ts", "");
        write(root, "web/types.ts", "");
        write(root, "web/legacy.js", "");
        write(root, "py/app.py", "import pkg.models\nfrom . import helpers\nfrom .sub.thing import X");
        write(root, "py/helpers.py", "");
        write(root, "py/sub/thing.py", "");
        write(root, "py/pkg/__init__.py", "");
        write(root, "py/pkg/models.py", "");
        write(root, "crate/src/main.rs", "mod config;\nmod net;\nmod inline { }\nuse crate::net::tcp::Stream;");
        write(root, "crate/src/config.rs", "");
        write(root, "crate/src/net/mod.rs", "mod tcp;");
        write(root, "crate/src/net/tcp.rs", "");

        let first = scan(root, Some(cache.path())).unwrap();
        let paths: Vec<&str> = first.files.iter().map(|f| f.path.as_str()).collect();
        assert!(!paths.iter().any(|p| p.starts_with("build/")), "gitignored file listed");
        assert!(!paths.iter().any(|p| p.starts_with("node_modules/")), "node_modules listed");

        let mut got = wires(&first);
        got.sort();
        let want: Vec<(String, String)> = [
            ("crate/src/main.rs", "crate/src/config.rs"),
            ("crate/src/main.rs", "crate/src/net/mod.rs"),
            ("crate/src/main.rs", "crate/src/net/tcp.rs"),
            ("crate/src/net/mod.rs", "crate/src/net/tcp.rs"),
            ("py/app.py", "py/helpers.py"),
            ("py/app.py", "py/pkg/models.py"),
            ("py/app.py", "py/sub/thing.py"),
            ("web/main.ts", "web/legacy.js"),
            ("web/main.ts", "web/types.ts"),
            ("web/main.ts", "web/util/index.ts"),
        ]
        .iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();
        assert_eq!(got, want);
        assert_eq!(first.stats.cached, 0);
        assert!(first.stats.parsed > 0);

        let second = scan(root, Some(cache.path())).unwrap();
        assert_eq!(second.stats.parsed, 0, "unchanged files should come from the cache");
        assert_eq!(second.stats.cached, first.stats.parsed);
        assert_eq!(wires(&second).len(), want.len());
    }

    #[test]
    fn follows_tsconfig_path_aliases_and_their_edits() {
        let project = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let root = project.path();
        write(root, "tsconfig.json", r#"{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }"#);
        write(root, "src/app.tsx", "import { db } from '~/lib/db';\nimport { Button } from '@/ui';\nimport x from 'react';");
        write(root, "src/lib/db.ts", "");
        write(root, "src/ui/index.tsx", "");

        let first = scan(root, Some(cache.path())).unwrap();
        // `@/` has no rule here, so it falls back to the package's `src/` folder.
        assert_eq!(
            wires(&first),
            [
                ("src/app.tsx".to_string(), "src/lib/db.ts".to_string()),
                ("src/app.tsx".to_string(), "src/ui/index.tsx".to_string()),
            ]
        );

        // Aliases are read on every scan, so a tsconfig edit counts even for cached files.
        write(root, "tsconfig.json", r#"{ "compilerOptions": { "paths": { "~/*": ["./missing/*"] } } }"#);
        let second = scan(root, Some(cache.path())).unwrap();
        assert!(second.stats.cached > 0);
        assert_eq!(
            wires(&second),
            [("src/app.tsx".to_string(), "src/ui/index.tsx".to_string())]
        );
    }
}
