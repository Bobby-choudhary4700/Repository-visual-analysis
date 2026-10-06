//! Maps a raw import specifier to the project file(s) it refers to.
//! Specifiers that point outside the project (npm packages, the standard library) resolve to nothing.

use super::aliases::Aliases;
use super::Lang;

const JS_EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];

/// `exists` answers whether a root-relative path is a scanned file.
pub fn resolve(
    lang: Lang,
    from: &str,
    spec: &str,
    aliases: &Aliases,
    exists: impl Fn(&str) -> bool,
) -> Vec<String> {
    let candidates = match lang {
        Lang::Javascript | Lang::Typescript | Lang::Tsx => js_candidates(from, spec, aliases),
        Lang::Python => python_candidates(from, spec),
        Lang::Rust => rust_candidates(from, spec, &exists),
    };
    // Candidates are ordered by priority, so the first file that exists wins.
    candidates.into_iter().find(|c| exists(c)).into_iter().collect()
}

fn js_candidates(from: &str, spec: &str, aliases: &Aliases) -> Vec<String> {
    // A bare specifier is a package, unless a tsconfig alias says it is a project file.
    let bases = if spec.starts_with('.') {
        join(dir(from), spec).into_iter().collect()
    } else {
        aliases.candidates(from, spec)
    };
    bases.iter().flat_map(|base| js_files(base)).collect()
}

/// The files a module path can mean: itself, with an extension added, or a folder's index.
fn js_files(base: &str) -> Vec<String> {
    let mut out = vec![base.to_string()];
    // TypeScript ESM code imports "./x.js" while the file on disk is "./x.ts".
    if let Some(stem) = base
        .strip_suffix(".js")
        .or_else(|| base.strip_suffix(".jsx"))
        .or_else(|| base.strip_suffix(".mjs"))
    {
        out.extend(["ts", "tsx", "mts"].iter().map(|ext| format!("{stem}.{ext}")));
    }
    out.extend(JS_EXTENSIONS.iter().map(|ext| format!("{base}.{ext}")));
    out.extend(JS_EXTENSIONS.iter().map(|ext| format!("{base}/index.{ext}")));
    out
}

fn python_candidates(from: &str, spec: &str) -> Vec<String> {
    let dots = spec.len() - spec.trim_start_matches('.').len();
    let module = spec[dots..].replace('.', "/");

    // Relative imports start from the file's package; absolute ones may be rooted at
    // any ancestor folder (repo root, `src/`, ...), so try each from nearest to farthest.
    let bases: Vec<String> = if dots > 0 {
        let mut base = dir(from).to_string();
        for _ in 1..dots {
            match parent(&base) {
                Some(p) => base = p.to_string(),
                None => return Vec::new(),
            }
        }
        vec![base]
    } else {
        let mut bases = vec![];
        let mut cur = Some(dir(from));
        while let Some(d) = cur {
            bases.push(d.to_string());
            cur = parent(d);
        }
        bases
    };

    let mut out = Vec::new();
    for base in bases {
        let path = child(&base, &module);
        if module.is_empty() {
            out.push(child(&path, "__init__.py"));
        } else {
            out.push(format!("{path}.py"));
            out.push(format!("{path}.pyi"));
            out.push(child(&path, "__init__.py"));
        }
    }
    out
}

/// Specs are `mod <name>` or `use <path>`, as `imports::rust_use_specs` writes them.
fn rust_candidates(from: &str, spec: &str, exists: &impl Fn(&str) -> bool) -> Vec<String> {
    let Some((kind, rest)) = spec.split_once(' ') else {
        return Vec::new();
    };
    if kind == "mod" {
        return module_files(&module_dir(from), rest);
    }

    use_candidates(from, rest, exists).unwrap_or_default()
}

fn use_candidates(
    from: &str,
    path: &str,
    exists: &impl Fn(&str) -> bool,
) -> Option<Vec<String>> {
    let mut segments: Vec<&str> = path.split("::").collect();
    // A path led by `crate`, `self` or `super` names one module for certain, so when its
    // last segments name an item rather than a module, that module's own file is the target.
    // A bare path may instead be an outside crate, which must resolve to nothing, so it only
    // gets the folders a uniform path could mean.
    let (bases, rooted) = match *segments.first()? {
        "crate" => {
            segments.remove(0);
            (vec![crate_root(from, exists)?], true)
        }
        "self" => {
            segments.remove(0);
            (vec![module_dir(from)], true)
        }
        // `super::super::x` climbs one module per leading `super`.
        "super" => {
            let mut base = module_dir(from);
            while segments.first() == Some(&"super") {
                segments.remove(0);
                base = parent(&base)?.to_string();
            }
            (vec![base], true)
        }
        // A uniform path (`use some_module::Item;`) names a module beside this one or at
        // the crate root; anything else is an outside crate and resolves to nothing.
        _ => {
            let mut bases = vec![module_dir(from)];
            if let Some(root) = crate_root(from, exists) {
                bases.push(root);
            }
            (bases, false)
        }
    };
    let mut out = Vec::new();
    for base in bases {
        out.extend(module_candidates(&base, &segments, rooted));
    }
    Some(out)
}

/// `a::b::Thing` under `base` may mean the module `a::b::Thing`, or an item inside `a::b`
/// or `a`, so the longest path is tried first and then its prefixes. When `base` is itself
/// a module this path is known to live in, its own file is the last resort, for an item
/// declared directly in it.
fn module_candidates(base: &str, segments: &[&str], rooted: bool) -> Vec<String> {
    let mut out = Vec::new();
    for end in (1..=segments.len()).rev() {
        let dir = segments[..end - 1]
            .iter()
            .fold(base.to_string(), |d, s| child(&d, s));
        out.extend(module_files(&dir, segments[end - 1]));
    }
    if rooted {
        out.push(child(base, "mod.rs"));
        if !base.is_empty() {
            out.push(format!("{base}.rs"));
        }
        out.push(child(base, "lib.rs"));
        out.push(child(base, "main.rs"));
    }
    out
}

/// The two files a module `name` can live in, relative to the folder its parent module owns.
fn module_files(dir: &str, name: &str) -> Vec<String> {
    vec![
        child(dir, &format!("{name}.rs")),
        child(dir, &format!("{name}/mod.rs")),
    ]
}

/// The folder a file's own child modules live in: beside `main.rs`, `lib.rs` and
/// `mod.rs`, and in a folder named after any other file.
fn module_dir(from: &str) -> String {
    let folder = dir(from);
    let file = from.rsplit('/').next().unwrap_or(from);
    match file {
        "main.rs" | "lib.rs" | "mod.rs" => folder.to_string(),
        _ => child(folder, file.trim_end_matches(".rs")),
    }
}

/// The nearest ancestor folder holding this file's crate root (`main.rs` or `lib.rs`).
fn crate_root(from: &str, exists: &impl Fn(&str) -> bool) -> Option<String> {
    let mut folder = Some(dir(from));
    while let Some(d) = folder {
        if exists(&child(d, "main.rs")) || exists(&child(d, "lib.rs")) {
            return Some(d.to_string());
        }
        folder = parent(d);
    }
    None
}

/// Folder part of a root-relative path; `""` for files at the root.
pub(super) fn dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

pub(super) fn parent(dir: &str) -> Option<&str> {
    if dir.is_empty() {
        None
    } else {
        Some(dir.rsplit_once('/').map_or("", |(p, _)| p))
    }
}

pub(super) fn child(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else if name.is_empty() {
        dir.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

/// Joins a relative specifier onto a folder, folding `.` and `..`.
/// Returns `None` when the path climbs above the project root.
pub(super) fn join(base: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(lang: Lang, from: &str, spec: &str, files: &[&str]) -> Option<String> {
        resolve(lang, from, spec, &Aliases::default(), |p| files.contains(&p)).into_iter().next()
    }

    #[test]
    fn js_resolution() {
        let files = ["src/a.ts", "src/lib/index.tsx", "src/esm.ts", "top.js"];
        assert_eq!(one(Lang::Typescript, "src/main.ts", "./a", &files).as_deref(), Some("src/a.ts"));
        assert_eq!(one(Lang::Typescript, "src/main.ts", "./lib", &files).as_deref(), Some("src/lib/index.tsx"));
        assert_eq!(one(Lang::Typescript, "src/main.ts", "./esm.js", &files).as_deref(), Some("src/esm.ts"));
        assert_eq!(one(Lang::Javascript, "src/x/y.js", "../../top", &files).as_deref(), Some("top.js"));
        assert_eq!(one(Lang::Javascript, "src/y.js", "../../outside", &files), None);
        assert_eq!(one(Lang::Javascript, "src/y.js", "react", &files), None);
    }

    #[test]
    fn python_absolute_prefers_nearest_root() {
        let files = ["src/pkg/mod.py", "pkg/mod.py"];
        assert_eq!(one(Lang::Python, "src/app.py", "pkg.mod", &files).as_deref(), Some("src/pkg/mod.py"));
        assert_eq!(one(Lang::Python, "tools/run.py", "pkg.mod", &files).as_deref(), Some("pkg/mod.py"));
        assert_eq!(one(Lang::Python, "a/b/c.py", "...", &files), None);
    }

    #[test]
    fn rust_nested_module() {
        let files = ["src/net/tcp.rs"];
        assert_eq!(one(Lang::Rust, "src/net.rs", "mod tcp", &files).as_deref(), Some("src/net/tcp.rs"));
    }

    #[test]
    fn rust_use_paths() {
        let files = [
            "src/main.rs",
            "src/net/mod.rs",
            "src/net/tcp.rs",
            "src/config.rs",
            "tools/src/lib.rs",
            "tools/src/fmt.rs",
        ];
        let at = |from, spec| one(Lang::Rust, from, spec, &files);
        // An item inside a module resolves to the module's file.
        assert_eq!(at("src/main.rs", "use crate::net::tcp::Stream").as_deref(), Some("src/net/tcp.rs"));
        assert_eq!(at("src/net/tcp.rs", "use crate::config::Config").as_deref(), Some("src/config.rs"));
        assert_eq!(at("src/net/mod.rs", "use self::tcp").as_deref(), Some("src/net/tcp.rs"));
        assert_eq!(at("src/net/tcp.rs", "use super::super::config").as_deref(), Some("src/config.rs"));
        // `crate::` is resolved against the nearest crate root, not the repository root.
        assert_eq!(at("tools/src/fmt.rs", "use crate::fmt").as_deref(), Some("tools/src/fmt.rs"));
        // An item declared in the module itself resolves to that module's own file.
        assert_eq!(at("src/net/tcp.rs", "use super::Listener").as_deref(), Some("src/net/mod.rs"));
        assert_eq!(at("src/net/tcp.rs", "use crate::Args").as_deref(), Some("src/main.rs"));
        // A uniform path names a module beside this one.
        assert_eq!(at("src/net/mod.rs", "use tcp::Stream").as_deref(), Some("src/net/tcp.rs"));
        // Outside crates and the standard library have no file in the project.
        assert_eq!(at("src/main.rs", "use serde::Serialize"), None);
        assert_eq!(at("src/net/tcp.rs", "use serde::Serialize"), None);
        assert_eq!(at("src/main.rs", "use super::x"), None);
    }
}
