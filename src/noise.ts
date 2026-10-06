import type { Edge, FileNode, ScanResult } from "./types";

// Files that are not the product's own running code: tests, examples, docs, benchmarks,
// vendored and generated code, and lockfiles. Hiding them leaves the code that runs. The
// folder names follow the rule gitdiagram uses to decide which files describe a project.

const NOISE_FOLDER =
  /(^|\/)(tests?|__tests__|__mocks__|mocks?|specs?|test[_-]?data|fixtures?|__fixtures__|__snapshots__|e2e|cypress|examples?|samples?|demos?|stories|storybook|docs?|documentation|tutorials?|bench|benches|benchmarks?|vendor|third[_-]party|generated|__generated__|migrations?)\//i;
const NOISE_FILE =
  /\.(test|spec|stories|story|bench|e2e|generated|min)\.[^/]+$|(^|\/)(tests?\.[^/]+|test_[^/]+\.py|[^/]+_test\.[a-z]+|conftest\.py|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/i;

/** Whether a file is a test, example, doc, benchmark, vendored or generated file. */
export function isNoise(path: string): boolean {
  return NOISE_FOLDER.test(path) || NOISE_FILE.test(path);
}

/** The scan without those files and the wires that touch them; the same scan when none match. */
export function withoutNoise<T extends ScanResult>(scan: T): T {
  // Each kept file's new index, or -1 for a hidden one.
  const index = new Int32Array(scan.files.length);
  const files: FileNode[] = [];
  scan.files.forEach((f, i) => {
    index[i] = isNoise(f.path) ? -1 : files.push(f) - 1;
  });
  if (files.length === scan.files.length) return scan;
  const edges: Edge[] = [];
  for (const e of scan.edges) {
    const from = index[e.from];
    const to = index[e.to];
    if (from >= 0 && to >= 0) edges.push({ from, to });
  }
  return { ...scan, files, edges };
}
