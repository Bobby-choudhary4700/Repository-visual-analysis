//! Import aliases for JavaScript and TypeScript, so `~/lib/db` or `@/components/Button`
//! become wires the way relative imports do.
//!
//! The rules come from `compilerOptions.paths` and `baseUrl` in `tsconfig.json` (or
//! `jsconfig.json`). Each file uses the nearest config in or above its folder, as editors
//! do. A config's `extends` chain is followed for relative paths, and a config that sets
//! nothing itself takes the rules of the configs it lists under `references`, which is
//! how Vite's templates split theirs. Projects that alias `@/` or `~/` only in their
//! bundler config almost always mean their `src/` folder, so those are tried there last.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde_json::{Map, Value};

use super::resolve::{child, dir, join, parent};

/// A tsconfig bigger than this was not written by hand, and is skipped.
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
/// How far an `extends` chain is followed, which also stops a chain that loops.
const MAX_EXTENDS_DEPTH: usize = 8;
/// Where `@/` and `~/` point when no config says, nearest first, relative to the package.
const FALLBACK_FOLDERS: &[&str] = &["src", "app", ""];

#[derive(Default)]
pub struct Aliases {
    /// The rules of each config, by the root-relative folder it sits in. `None` marks a
    /// config without aliases, which still hides the configs above it.
    configs: HashMap<String, Option<Rules>>,
    /// Folders holding a `package.json`, for the `@/` and `~/` fallback.
    packages: HashSet<String>,
}

#[derive(Debug, Default)]
struct Rules {
    /// Root-relative folder that bare specifiers are also looked up in.
    base_url: Option<String>,
    patterns: Vec<Pattern>,
}

#[derive(Debug)]
struct Pattern {
    prefix: String,
    /// The text after the `*`, or `None` for a pattern without one, which matches exactly.
    suffix: Option<String>,
    /// Root-relative folder the targets are written relative to.
    base: String,
    /// The targets as written, each with at most one `*` to fill in.
    targets: Vec<String>,
}

/// The options that matter here, with `extends` applied.
#[derive(Default)]
struct Options {
    /// Root-relative.
    base_url: Option<String>,
    /// The `paths` object and the root-relative folder of the config that set it.
    paths: Option<(Map<String, Value>, String)>,
}

impl Aliases {
    /// Reads the configs among `files`, the root-relative paths the scan found.
    pub fn load(root: &Path, files: &[&str]) -> Aliases {
        let mut aliases = Aliases::default();
        for &rel in files {
            let folder = dir(rel);
            match &rel[rel.rfind('/').map_or(0, |i| i + 1)..] {
                "package.json" => {
                    aliases.packages.insert(folder.to_string());
                }
                // Files arrive sorted, so a jsconfig.json is read before the tsconfig.json
                // beside it, which then takes its place.
                "jsconfig.json" | "tsconfig.json" => {
                    aliases
                        .configs
                        .insert(folder.to_string(), load_rules(root, rel));
                }
                _ => {}
            }
        }
        aliases
    }

    /// Root-relative paths, without extensions, that a bare specifier imported by `from`
    /// may mean, most likely first. Empty for an ordinary package import.
    pub fn candidates(&self, from: &str, spec: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut matched = false;
        if let Some(rules) = self.nearest_rules(from) {
            if let Some(paths) = rules.matches(spec) {
                matched = true;
                out.extend(paths);
            }
            if let Some(base) = &rules.base_url {
                out.extend(join(base, spec));
            }
        }
        if !matched {
            if let Some(rest) = spec.strip_prefix("@/").or_else(|| spec.strip_prefix("~/")) {
                let package = self.nearest_package(from);
                for folder in FALLBACK_FOLDERS {
                    out.extend(join(&child(package, folder), rest));
                }
            }
        }
        out
    }

    fn nearest_rules(&self, from: &str) -> Option<&Rules> {
        let mut folder = Some(dir(from));
        while let Some(d) = folder {
            if let Some(rules) = self.configs.get(d) {
                return rules.as_ref();
            }
            folder = parent(d);
        }
        None
    }

    fn nearest_package<'a>(&self, from: &'a str) -> &'a str {
        let mut folder = Some(dir(from));
        while let Some(d) = folder {
            if self.packages.contains(d) {
                return d;
            }
            folder = parent(d);
        }
        ""
    }
}

impl Rules {
    /// The paths a specifier maps to, if a pattern matches it. As in TypeScript, an exact
    /// pattern wins, then the `*` pattern with the longest prefix, and only that one's
    /// targets are tried.
    fn matches(&self, spec: &str) -> Option<Vec<String>> {
        let (pattern, middle) = match self
            .patterns
            .iter()
            .find(|p| p.suffix.is_none() && p.prefix == spec)
        {
            Some(exact) => (exact, ""),
            None => {
                let mut best: Option<(&Pattern, &str)> = None;
                for p in &self.patterns {
                    let Some(suffix) = &p.suffix else { continue };
                    let fits = spec.len() >= p.prefix.len() + suffix.len()
                        && spec.starts_with(&p.prefix)
                        && spec.ends_with(suffix.as_str());
                    if fits && best.is_none_or(|(b, _)| p.prefix.len() > b.prefix.len()) {
                        best = Some((p, &spec[p.prefix.len()..spec.len() - suffix.len()]));
                    }
                }
                best?
            }
        };
        Some(
            pattern
                .targets
                .iter()
                .filter_map(|t| join(&pattern.base, &t.replacen('*', middle, 1)))
                .collect(),
        )
    }
}

/// The alias rules of one config file, or `None` when it sets none.
fn load_rules(root: &Path, rel: &str) -> Option<Rules> {
    let (options, json) = read_options(root, rel, 0)?;
    if options.base_url.is_some() || options.paths.is_some() {
        return Some(rules_from(options));
    }
    // A solution-style config only lists the configs that hold the real options.
    let mut merged = Rules::default();
    for reference in json.get("references")?.as_array()? {
        let Some(path) = reference.get("path").and_then(Value::as_str) else {
            continue;
        };
        let Some(target) = join(dir(rel), &path.replace('\\', "/")) else {
            continue;
        };
        let target = if target.ends_with(".json") {
            target
        } else {
            child(&target, "tsconfig.json")
        };
        if let Some((options, _)) = read_options(root, &target, 1) {
            let rules = rules_from(options);
            merged.base_url = merged.base_url.or(rules.base_url);
            merged.patterns.extend(rules.patterns);
        }
    }
    (merged.base_url.is_some() || !merged.patterns.is_empty()).then_some(merged)
}

fn rules_from(options: Options) -> Rules {
    let mut patterns = Vec::new();
    if let Some((paths, defined_in)) = options.paths {
        // Targets are relative to `baseUrl` when there is one, else to the config itself.
        let base = options.base_url.clone().unwrap_or(defined_in);
        for (key, targets) in paths {
            if key.matches('*').count() > 1 {
                continue;
            }
            let targets: Vec<String> = targets
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|t| t.matches('*').count() <= 1 && !t.starts_with('/'))
                .map(|t| t.replace('\\', "/"))
                .collect();
            if targets.is_empty() {
                continue;
            }
            let (prefix, suffix) = match key.split_once('*') {
                Some((prefix, suffix)) => (prefix.to_string(), Some(suffix.to_string())),
                None => (key, None),
            };
            patterns.push(Pattern {
                prefix,
                suffix,
                base: base.clone(),
                targets,
            });
        }
    }
    Rules {
        base_url: options.base_url,
        patterns,
    }
}

/// Reads a config and the configs it extends, later ones overriding earlier ones, and
/// returns the merged options along with the config's own JSON.
fn read_options(root: &Path, rel: &str, depth: usize) -> Option<(Options, Value)> {
    if depth > MAX_EXTENDS_DEPTH {
        return None;
    }
    let full = root.join(rel);
    let meta = std::fs::metadata(&full).ok()?;
    if !meta.is_file() || meta.len() > MAX_CONFIG_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(&full).ok()?;
    let json: Value = serde_json::from_str(&strip_jsonc(&text)).ok()?;
    let folder = dir(rel);

    let mut options = Options::default();
    let extends: Vec<&str> = match json.get("extends") {
        Some(Value::String(one)) => vec![one],
        Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    for spec in extends {
        let Some(parent_rel) = extends_path(root, folder, spec) else {
            continue;
        };
        if let Some((inherited, _)) = read_options(root, &parent_rel, depth + 1) {
            options.base_url = inherited.base_url.or(options.base_url);
            options.paths = inherited.paths.or(options.paths);
        }
    }
    if let Some(compiler) = json.get("compilerOptions") {
        if let Some(base_url) = compiler.get("baseUrl").and_then(Value::as_str) {
            if !base_url.starts_with('/') {
                options.base_url = join(folder, &base_url.replace('\\', "/"));
            }
        }
        if let Some(paths) = compiler.get("paths").and_then(Value::as_object) {
            options.paths = Some((paths.clone(), folder.to_string()));
        }
    }
    Some((options, json))
}

/// The root-relative file an `extends` entry names. Only relative entries are followed:
/// shared configs from packages set compiler options, not a project's own aliases.
fn extends_path(root: &Path, folder: &str, spec: &str) -> Option<String> {
    let spec = spec.replace('\\', "/");
    if !(spec.starts_with("./") || spec.starts_with("../")) {
        return None;
    }
    let path = join(folder, &spec)?;
    if root.join(&path).is_file() {
        return Some(path);
    }
    let with_json = format!("{path}.json");
    root.join(&with_json).is_file().then_some(with_json)
}

/// tsconfig files are JSON with comments and trailing commas; this removes both.
fn strip_jsonc(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    // Comments go first, so a comment after the last comma does not hide that it trails.
    let mut plain = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => copy_string(&mut chars, &mut plain),
            '/' if chars.peek() == Some(&'/') => while chars.next_if(|&n| n != '\n').is_some() {},
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = '\0';
                for n in chars.by_ref() {
                    if previous == '*' && n == '/' {
                        break;
                    }
                    previous = n;
                }
                // A comment between two tokens still separates them.
                plain.push(' ');
            }
            _ => plain.push(c),
        }
    }
    let mut out = String::with_capacity(plain.len());
    let mut chars = plain.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => copy_string(&mut chars, &mut out),
            // A comma with only whitespace before the closing bracket is a trailing one.
            ',' if matches!(chars.clone().find(|n| !n.is_whitespace()), Some('}' | ']')) => {}
            _ => out.push(c),
        }
    }
    out
}

/// Copies a JSON string whose opening quote was just read, escapes and all.
fn copy_string(chars: &mut impl Iterator<Item = char>, out: &mut String) {
    out.push('"');
    while let Some(c) = chars.next() {
        out.push(c);
        match c {
            '\\' => out.extend(chars.next()),
            '"' => break,
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn project(files: &[(&str, &str)]) -> (tempfile::TempDir, Aliases) {
        let dir = tempfile::tempdir().unwrap();
        for (rel, body) in files {
            let path = dir.path().join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, body).unwrap();
        }
        let mut rels: Vec<&str> = files.iter().map(|(rel, _)| *rel).collect();
        rels.sort();
        let aliases = Aliases::load(dir.path(), &rels);
        (dir, aliases)
    }

    #[test]
    fn jsonc_comments_and_trailing_commas_are_removed() {
        let text = "\u{feff}{\n  // line\n  \"a\": \"//not a comment\", /* block */ \"b\": [1, 2, // last\n],\n  \"c\": \"say \\\"hi\\\"\",\n}";
        let json: Value = serde_json::from_str(&strip_jsonc(text)).unwrap();
        assert_eq!(json["a"], "//not a comment");
        assert_eq!(json["b"], serde_json::json!([1, 2]));
        assert_eq!(json["c"], "say \"hi\"");
    }

    #[test]
    fn paths_map_onto_files_relative_to_the_config() {
        let (_dir, aliases) = project(&[(
            "tsconfig.json",
            r#"{
              /* Path aliases */
              "compilerOptions": {
                "paths": {
                  "~/*": ["./src/*"],
                  "@ui/*": ["./packages/ui/src/*", "./vendor/ui/*"],
                  "@ui/button": ["./packages/ui/src/button/index.ts"],
                  "config": ["./config/main"],
                },
              },
            }"#,
        )]);
        assert_eq!(aliases.candidates("src/app.ts", "~/lib/db"), ["src/lib/db"]);
        // Every target of the matching pattern, in order.
        assert_eq!(
            aliases.candidates("src/app.ts", "@ui/menu"),
            ["packages/ui/src/menu", "vendor/ui/menu"]
        );
        // An exact pattern wins over a `*` one.
        assert_eq!(
            aliases.candidates("src/app.ts", "@ui/button"),
            ["packages/ui/src/button/index.ts"]
        );
        assert_eq!(aliases.candidates("src/app.ts", "config"), ["config/main"]);
        assert!(aliases.candidates("src/app.ts", "react").is_empty());
    }

    #[test]
    fn the_longest_prefix_wins_and_base_url_comes_last() {
        let (_dir, aliases) = project(&[(
            "web/tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": "src", "paths": {
                "@/*": ["*"],
                "@/components/*": ["ui/components/*"]
            } } }"#,
        )]);
        // Targets are relative to baseUrl when it is set.
        assert_eq!(
            aliases.candidates("web/src/main.ts", "@/components/Nav"),
            ["web/src/ui/components/Nav", "web/src/@/components/Nav"]
        );
        assert_eq!(
            aliases.candidates("web/src/main.ts", "@/util"),
            ["web/src/util", "web/src/@/util"]
        );
        // baseUrl alone lets a bare specifier name a folder under it.
        assert_eq!(
            aliases.candidates("web/src/main.ts", "store/cart"),
            ["web/src/store/cart"]
        );
        // Files outside the config's folder do not use it.
        assert!(aliases.candidates("other/main.ts", "store/cart").is_empty());
    }

    #[test]
    fn extends_and_references_are_followed() {
        let (_dir, aliases) = project(&[
            (
                "tsconfig.base.json",
                r#"{ "compilerOptions": { "paths": { "@lib/*": ["libs/*/src"] } } }"#,
            ),
            (
                "apps/web/tsconfig.json",
                r#"{ "extends": "../../tsconfig.base", "compilerOptions": {} }"#,
            ),
            // Vite's template: the root config only references the real ones.
            (
                "site/tsconfig.json",
                r#"{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }"#,
            ),
            (
                "site/tsconfig.app.json",
                r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
            ),
        ]);
        // Paths inherited through `extends` stay relative to the config that set them.
        assert_eq!(
            aliases.candidates("apps/web/main.ts", "@lib/auth"),
            ["libs/auth/src"]
        );
        assert_eq!(
            aliases.candidates("site/src/main.tsx", "@/App"),
            ["site/src/App"]
        );
    }

    #[test]
    fn a_nearer_config_without_aliases_hides_the_outer_one() {
        let (_dir, aliases) = project(&[
            (
                "tsconfig.json",
                r##"{ "compilerOptions": { "paths": { "#/*": ["./src/*"] } } }"##,
            ),
            (
                "tools/tsconfig.json",
                r#"{ "compilerOptions": { "strict": true } }"#,
            ),
        ]);
        assert_eq!(aliases.candidates("src/a.ts", "#/b"), ["src/b"]);
        assert!(aliases.candidates("tools/a.ts", "#/b").is_empty());
    }

    #[test]
    fn at_and_tilde_fall_back_to_the_package_src_folder() {
        let (_dir, aliases) = project(&[("web/package.json", "{}")]);
        assert_eq!(
            aliases.candidates("web/src/pages/home.tsx", "@/lib/api"),
            ["web/src/lib/api", "web/app/lib/api", "web/lib/api"]
        );
        // Scoped packages are packages.
        assert!(aliases.candidates("web/src/a.ts", "@scope/pkg").is_empty());
        // A matching pattern replaces the fallback, even when its file is missing.
        let (_dir, aliases) = project(&[(
            "tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@/*": ["./lib/*"] } } }"#,
        )]);
        assert_eq!(aliases.candidates("x.ts", "@/a"), ["lib/a"]);
    }

    #[test]
    fn broken_configs_and_escapes_are_ignored() {
        let (_dir, aliases) = project(&[
            (
                "tsconfig.json",
                r#"{ "compilerOptions": { "paths": { "~/*": ["../../outside/*"] } } }"#,
            ),
            ("bad/tsconfig.json", "{ not json"),
            ("loop/tsconfig.json", r#"{ "extends": "./tsconfig.json" }"#),
        ]);
        assert!(aliases.candidates("a.ts", "~/x").is_empty());
        assert!(aliases.candidates("bad/a.ts", "x").is_empty());
        assert!(aliases.candidates("loop/a.ts", "x").is_empty());
    }
}
