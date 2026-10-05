//! Maps a raw import specifier to the project file(s) it refers to.
//! Specifiers that point outside the project (npm packages, the standard library) resolve to nothing.

use super::Lang;

const JS_EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];

/// `exists` answers whether a root-relative path is a scanned file.
pub fn resolve(lang: Lang, from: &str, spec: &str, exists: impl Fn(&str) -> bool) -> Vec<String> {
    let candidates = match lang {
        Lang::Javascript | Lang::Typescript | Lang::Tsx => js_candidates(from, spec),
        Lang::Python => python_candidates(from, spec),
        Lang::Rust => rust_candidates(from, spec),
    };
    // Candidates are ordered by priority, so the first file that exists wins.
    candidates.into_iter().find(|c| exists(c)).into_iter().collect()
}

fn js_candidates(from: &str, spec: &str) -> Vec<String> {
    if !spec.starts_with('.') {
        return Vec::new();
    }
    let Some(base) = join(dir(from), spec) else {
        return Vec::new();
    };
    let mut out = vec![base.clone()];
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

fn rust_candidates(from: &str, name: &str) -> Vec<String> {
    let folder = dir(from);
    let file = from.rsplit('/').next().unwrap_or(from);
    // `mod x;` in main.rs, lib.rs or mod.rs looks beside the file; elsewhere in a folder named after it.
    let base = match file {
        "main.rs" | "lib.rs" | "mod.rs" => folder.to_string(),
        _ => child(folder, file.trim_end_matches(".rs")),
    };
    vec![
        child(&base, &format!("{name}.rs")),
        child(&base, &format!("{name}/mod.rs")),
    ]
}

/// Folder part of a root-relative path; `""` for files at the root.
fn dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

fn parent(dir: &str) -> Option<&str> {
    if dir.is_empty() {
        None
    } else {
        Some(dir.rsplit_once('/').map_or("", |(p, _)| p))
    }
}

fn child(dir: &str, name: &str) -> String {
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
fn join(base: &str, rel: &str) -> Option<String> {
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
        resolve(lang, from, spec, |p| files.contains(&p)).into_iter().next()
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
        assert_eq!(one(Lang::Rust, "src/net.rs", "tcp", &files).as_deref(), Some("src/net/tcp.rs"));
    }
}
