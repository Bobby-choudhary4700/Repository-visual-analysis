# Repository Visual Analysis

A desktop app that draws a code project as a graph: files and folders are nodes, and the
imports between them are wires.

![The app showing its own scanner, with one file selected](docs/screenshot.png)

## Using it

- **Open folder** scans a project. The first view shows its top folders.
- Click a folder to open it, and right-click any node to close the folder it sits in.
- Click a file to see what it imports and what imports it. Every entry in that panel is a
  link that jumps to that file.
- Press **Ctrl+K** (Cmd+K on macOS) to find a file by name. Picking one opens the folders
  above it and centres the graph on it.
- Hover a node to trace its wires.

## How it stays fast on big repositories

- **Parallel scan in Rust.** The `ignore` crate (ripgrep's walker) lists files on every core
  and skips whatever `.gitignore` excludes, plus `node_modules/`, `target/`, `dist/`, `build/`
  and `__pycache__/` even when no `.gitignore` mentions them.
- **Imports only.** tree-sitter reads just the import statements of each source file. Files
  over 1 MB (bundles, generated code) are listed but not parsed.
- **Cache.** Parsed imports are saved per project with each file's size and modified time,
  so reopening a project only re-parses files that changed.
- **Folders first.** The first view shows one node per folder, with wires summed from the
  files inside. Click a folder to open it, right-click a node to close its folder. Only what
  is open gets drawn.
- **WebGL drawing.** Sigma.js renders the graph on the GPU.
- **Live updates.** The open project is watched, and a burst of edits (a save, a
  `git checkout`) redraws the graph once the changes settle. Churn under ignored folders
  is skipped, and the open folders stay open across the redraw.

Measured on a 4-core cloud machine: 12,700 files (8,700 Rust sources) scan in 5.2 s the first
time and 44 ms with the cache.

## Languages

| Language | What becomes a wire |
| --- | --- |
| JavaScript / TypeScript / TSX | relative `import`, `export … from`, `require()`, `import()` |
| Python | `import a.b`, `from .x import y` (relative and absolute) |
| Rust | `mod name;` declarations and `use` paths (`crate::`, `self::`, `super::`) |

Imports of outside packages (npm, pip, crates, the standard library) are not drawn.

## Project layout

```
src/                 React frontend
  App.tsx            open folder, expand/collapse and selection state
  SearchBox.tsx      Ctrl+K file search (ranking in search.ts)
  FileDetails.tsx    imports / imported-by panel for the selected file
  graph.ts           folds files into their nearest open folder and sums wires
  GraphView.tsx      Sigma.js renderer and layout
src-tauri/           Rust backend
  src/scanner/       walk.rs (file listing), imports.rs (tree-sitter), resolve.rs, cache.rs
  src/watcher.rs     debounced file watching for live updates
  examples/scan.rs   command-line scan for benchmarking
```

## Running it

Prerequisites: Node 20+, Rust, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)
for your OS (on Linux, `libwebkit2gtk-4.1-dev` and friends).

```sh
npm install
npm run tauri dev       # run the app with hot reload
npm run tauri build     # build an installer for this OS

cd src-tauri
cargo test              # scanner tests
cargo run --release --example scan -- /path/to/repo > scan.json
```
