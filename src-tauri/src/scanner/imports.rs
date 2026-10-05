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

/// `mod name;` declarations, which point at another file (inline `mod x { }` does not).
const RS_QUERY: &str = r#"
(mod_item name: (identifier) @spec !body)
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
    fn python_forms() {
        let src = b"import os, pkg.mod as m\nfrom .. import sibling\nfrom .local import thing as t\n";
        let specs = Extractor::new().extract(Lang::Python, src);
        assert_eq!(
            specs,
            ["..", "..sibling", ".local", ".local.thing", "os", "pkg.mod"]
        );
    }
}
