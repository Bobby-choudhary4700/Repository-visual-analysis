use std::sync::OnceLock;

use serde::Serialize;
use tree_sitter::{Language, Node, Parser, Query, QueryCursor, StreamingIterator};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Javascript,
    Typescript,
    Tsx,
    Python,
    Rust,
}

impl Lang {
    pub fn from_path(path: &str) -> Option<Lang> {
        let ext = path.rsplit_once('.')?.1;
        Some(match ext {
            "js" | "jsx" | "mjs" | "cjs" => Lang::Javascript,
            "ts" | "mts" | "cts" => Lang::Typescript,
            "tsx" => Lang::Tsx,
            "py" | "pyi" => Lang::Python,
            "rs" => Lang::Rust,
            _ => return None,
        })
    }

    fn grammar(self) -> Language {
        match self {
            Lang::Javascript => tree_sitter_javascript::LANGUAGE.into(),
            Lang::Typescript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::Python => tree_sitter_python::LANGUAGE.into(),
            Lang::Rust => tree_sitter_rust::LANGUAGE.into(),
        }
    }

    fn query_source(self) -> &'static str {
        match self {
            Lang::Javascript | Lang::Typescript | Lang::Tsx => JS_QUERY,
            Lang::Python => PY_QUERY,
            Lang::Rust => RS_QUERY,
        }
    }

    /// Queries are compiled once per language and shared across threads.
    fn query(self) -> &'static Query {
        static CELLS: [OnceLock<Query>; 5] = [const { OnceLock::new() }; 5];
        CELLS[self as usize].get_or_init(|| {
            Query::new(&self.grammar(), self.query_source()).expect("valid import query")
        })
    }
}

/// `import`/`export ... from`, `require("...")` and `import("...")`.
const JS_QUERY: &str = r#"
(import_statement source: (string (string_fragment) @spec))
(export_statement source: (string (string_fragment) @spec))
(call_expression
  function: (identifier) @fn
  arguments: (arguments . (string (string_fragment) @spec))
  (#eq? @fn "require"))
(call_expression
  function: (import)
  arguments: (arguments . (string (string_fragment) @spec)))
"#;

/// Whole import statements; module and imported names are read in `python_specs`.
const PY_QUERY: &str = r#"
(import_statement) @import
(import_from_statement) @from
"#;

/// `mod name;` declarations, which point at another file (inline `mod x { }` does not),
/// and `use` paths, expanded in `rust_use_specs`.
const RS_QUERY: &str = r#"
(mod_item name: (identifier) @mod !body)
(use_declaration argument: (_) @use)
"#;

/// Reusable per-thread parser. Returned specifiers are raw text, resolved later.
pub struct Extractor {
    parser: Parser,
}

impl Extractor {
    pub fn new() -> Self {
        Self {
            parser: Parser::new(),
        }
    }

    pub fn extract(&mut self, lang: Lang, source: &[u8]) -> Vec<String> {
        if self.parser.set_language(&lang.grammar()).is_err() {
            return Vec::new();
        }
        let Some(tree) = self.parser.parse(source, None) else {
            return Vec::new();
        };
        let query = lang.query();
        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(query, tree.root_node(), source);
        let mut specs = Vec::new();
        while let Some(m) = matches.next() {
            for capture in m.captures {
                let name = query.capture_names()[capture.index as usize];
                match (lang, name) {
                    (Lang::Python, _) => python_specs(capture.node, source, &mut specs),
                    (Lang::Rust, "mod") => {
                        specs.push(format!("mod {}", text(capture.node, source)))
                    }
                    (Lang::Rust, "use") => {
                        let mut found = Vec::new();
                        rust_use_specs(capture.node, source, "", &mut found);
                        let depth = inline_mod_depth(capture.node);
                        specs.extend(found.into_iter().filter_map(|s| outside_file(s, depth)));
                    }
                    (_, "spec") => specs.push(text(capture.node, source).to_string()),
                    _ => {}
                }
            }
        }
        specs.sort();
        specs.dedup();
        specs
    }
}

/// `import a.b` gives `a.b`. `from m import x, y` gives `m` plus `m.x` and `m.y`,
/// since `x` may be a submodule; candidates that match no file are dropped later.
fn python_specs(stmt: Node, source: &[u8], out: &mut Vec<String>) {
    let mut cursor = stmt.walk();
    if stmt.kind() == "import_statement" {
        for name in stmt.children_by_field_name("name", &mut cursor) {
            out.push(dotted(name, source).to_string());
        }
        return;
    }
    let Some(module) = stmt.child_by_field_name("module_name") else {
        return;
    };
    let module = text(module, source);
    out.push(module.to_string());
    for name in stmt.children_by_field_name("name", &mut cursor) {
        let name = dotted(name, source);
        if module.ends_with('.') {
            out.push(format!("{module}{name}"));
        } else {
            out.push(format!("{module}.{name}"));
        }
    }
}

/// How many inline `mod … { }` blocks enclose this node. `self` and `super` inside one
/// are relative to that block, not to the file.
fn inline_mod_depth(node: Node) -> usize {
    let mut depth = 0;
    let mut current = node.parent();
    while let Some(n) = current {
        if n.kind() == "mod_item" && n.child_by_field_name("body").is_some() {
            depth += 1;
        }
        current = n.parent();
    }
    depth
}

/// Rewrites a spec written inside `depth` inline modules so it is relative to the file,
/// or drops it when it points at something declared in this same file.
fn outside_file(spec: String, depth: usize) -> Option<String> {
    if depth == 0 {
        return Some(spec);
    }
    let path = spec.strip_prefix("use ")?;
    if path.starts_with("crate") {
        return Some(spec);
    }
    // Each inline module must be climbed out of before a `super` reaches the file's parent.
    let supers = path.split("::").take_while(|s| *s == "super").count();
    if supers <= depth {
        return None;
    }
    Some(format!(
        "use {}",
        path.splitn(depth + 1, "::").last().unwrap_or(path)
    ))
}

/// Flattens a `use` tree into one `use <path>` spec per leaf, so
/// `use crate::a::{b, c::d};` yields `use crate::a::b` and `use crate::a::c::d`.
/// `prefix` is the path accumulated from the enclosing scopes.
fn rust_use_specs(node: Node, source: &[u8], prefix: &str, out: &mut Vec<String>) {
    let join = |segment: &str| {
        if prefix.is_empty() {
            segment.to_string()
        } else {
            format!("{prefix}::{segment}")
        }
    };
    match node.kind() {
        // `a::b` and `a::{…}` both carry the scope in `path`.
        "scoped_identifier" | "scoped_use_list" => {
            let scope = node
                .child_by_field_name("path")
                .map_or_else(|| prefix.to_string(), |p| join(text(p, source)));
            match node.child_by_field_name("name") {
                Some(name) => out.push(format!("use {}", {
                    let name = text(name, source);
                    if scope.is_empty() {
                        name.to_string()
                    } else {
                        format!("{scope}::{name}")
                    }
                })),
                // A `{…}` list; recurse into it with the scope as the new prefix.
                None => {
                    if let Some(list) = node.child_by_field_name("list") {
                        rust_use_specs(list, source, &scope, out);
                    }
                }
            }
        }
        "use_list" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                rust_use_specs(child, source, prefix, out);
            }
        }
        "use_as_clause" => {
            if let Some(path) = node.child_by_field_name("path") {
                rust_use_specs(path, source, prefix, out);
            }
        }
        // `use a::*;` points at the module itself, whose path is the wildcard's own child.
        "use_wildcard" => match node.named_child(0) {
            Some(path) => rust_use_specs(path, source, prefix, out),
            None if !prefix.is_empty() => out.push(format!("use {prefix}")),
            None => {}
        },
        "identifier" | "crate" | "self" | "super" => out.push(format!("use {}", join(text(node, source)))),
        _ => {}
    }
}

/// The module path of a name node, without any `as alias`.
fn dotted<'a>(node: Node, source: &'a [u8]) -> &'a str {
    let node = if node.kind() == "aliased_import" {
        node.child_by_field_name("name").unwrap_or(node)
    } else {
        node
    };
    text(node, source)
}

fn text<'a>(node: Node, source: &'a [u8]) -> &'a str {
    node.utf8_text(source).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_query_compiles() {
        for lang in [
            Lang::Javascript,
            Lang::Typescript,
            Lang::Tsx,
            Lang::Python,
            Lang::Rust,
        ] {
            lang.query();
        }
    }

    #[test]
    fn javascript_forms() {
        let src = br#"
            import a from "./a";
            import "./side-effect";
            export { b } from "./b";
            const c = require("./c");
            const d = await import("./d");
            notRequire("./ignored");
        "#;
        let specs = Extractor::new().extract(Lang::Javascript, src);
        assert_eq!(specs, ["./a", "./b", "./c", "./d", "./side-effect"]);
    }

    #[test]
    fn tsx_forms() {
        let src = br#"
            import type { T } from "./types";
            import { View } from "../ui/View";
            export const App = () => <View />;
        "#;
        let specs = Extractor::new().extract(Lang::Tsx, src);
        assert_eq!(specs, ["../ui/View", "./types"]);
    }

    #[test]
    fn rust_forms() {
        let src = br#"
            mod config;
            mod inline { }
            use crate::net::tcp::Stream;
            use crate::util::{a, b::c};
            use super::super::other;
            use self::local::*;
            use serde::Serialize as S;
        "#;
        let specs = Extractor::new().extract(Lang::Rust, src);
        assert_eq!(
            specs,
            [
                "mod config",
                "use crate::net::tcp::Stream",
                "use crate::util::a",
                "use crate::util::b::c",
                "use self::local",
                "use serde::Serialize",
                "use super::super::other",
            ]
        );
    }

    #[test]
    fn rust_inline_module_paths_are_relative_to_it() {
        let src = br#"
            mod tests {
                use super::*;
                use super::super::sibling::Thing;
                use crate::other;
                use tempfile::TempDir;
            }
        "#;
        let specs = Extractor::new().extract(Lang::Rust, src);
        // `super::*` is this same file, and `tempfile` is an outside crate; neither is a wire.
        assert_eq!(specs, ["use crate::other", "use super::sibling::Thing"]);
    }

    #[test]
    fn python_forms() {
        let src = b"import os, pkg.mod as m\nfrom .. import sibling\nfrom .local import thing as t\n";
        let specs = Extractor::new().extract(Lang::Python, src);
        assert_eq!(
            specs,
            ["..", "..sibling", ".local", ".local.thing", "os", "pkg.mod"]
        );
    }
}
