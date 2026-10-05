# Repository Visual Analysis

A desktop app that draws a code project as a graph: files and folders are nodes, and the
imports between them are wires.

![The app showing its own source: the React frontend and the Rust backend as two clusters of files linked by their imports](docs/screenshot.png)

## Using it

- **Open a project** with the Open folder button, **Ctrl+O** (Cmd+O on macOS), or by dropping
  a folder onto the window. The welcome screen lists recent projects.
- Click a folder to open it, and right-click any node to close the folder it sits in. The
  **Explorer** on the left (**Ctrl+B** hides it) opens and closes the same folders, and
  hovering one of its rows traces that node in the graph.
- Click a file to see what it imports and what imports it. Every entry in that panel jumps
  to that file, and **Show in folder** and **Copy path** hand the file to your other tools.
- Press **Ctrl+K** to find a file by name. Picking one opens the folders above it and
  centres the graph on it.
- Hover a node to trace its wires and see a short summary. The legend shows what each
  colour means.
- Zoom with the scroll wheel, the buttons at the bottom right, or **+** and **−**. **F** fits
  the whole graph and **Esc** clears the selection.
- **Live** in the status bar means the folder is watched: saving a file redraws the graph.

![App.tsx selected: the files it imports fan out around it and are listed in the side panel](docs/selected.png)

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
- **Layout off the UI thread.** ForceAtlas2 runs in a Web Worker, so the window stays
  responsive while a big folder is arranged, and clicking several folders quickly only lays
  out the last state. The explorer only draws the rows in view.
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
  App.tsx            open project, folder and selection state, keyboard shortcuts
  Welcome.tsx        start screen with recent projects (stored by recent.ts)
  Sidebar.tsx        explorer that mirrors the graph (tree.ts builds its index)
  GraphView.tsx      Sigma.js renderer, hover tracing and camera controls
  layout.ts          runs the layout in layout.worker.ts and animates nodes into place
  graph.ts           folds files into their nearest open folder and sums wires
  SearchBox.tsx      Ctrl+K file search (ranking in search.ts)
  FileDetails.tsx    imports / imported-by panel for the selected file
  Legend.tsx, StatusBar.tsx, styles.css
src-tauri/           Rust backend
  src/lib.rs         commands the frontend calls: scan_repository, reveal_in_file_manager
  src/project.rs     keeps file actions inside the open project
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
