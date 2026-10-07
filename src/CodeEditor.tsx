import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderText,
  type DecorationSet,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { mermaidLanguage } from "./mermaidSyntax";

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: "mermaid" | "json";
  /** A 1-based line to mark as the one with a problem, or `null` for none. */
  problemLine?: number | null;
  placeholder?: string;
  ariaLabel: string;
}

/** Marks the line Mermaid or the JSON reader complained about. */
const setProblemLine = StateEffect.define<number | null>();
const problemLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setProblemLine)) continue;
      const line = effect.value;
      marks =
        line && line >= 1 && line <= tr.state.doc.lines
          ? Decoration.set([Decoration.line({ class: "cm-problem-line" }).range(tr.state.doc.line(line).from)])
          : Decoration.none;
    }
    return marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Colours come from the app's theme variables, so the editor follows dark and light. */
const appTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "var(--surface)", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--text)", padding: "10px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--text-faint)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--tint)" },
  ".cm-activeLineGutter": { color: "var(--text-muted)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--brand) 30%, transparent) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--brand) 22%, transparent)", outline: "none" },
  ".cm-placeholder": { color: "var(--text-faint)" },
});

/**
 * A code editor with line numbers and colours for Mermaid text or JSON, after the
 * Mermaid Live Editor's editor pane. Undo, redo and Tab indenting work as in any editor.
 */
export function CodeEditor({ value, onChange, language, problemLine = null, placeholder, ariaLabel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(classHighlighter),
      language === "json" ? json() : mermaidLanguage,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorState.tabSize.of(2),
      appTheme,
      problemLineField,
      EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    if (placeholder) extensions.push(placeholderText(placeholder));
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: value, extensions }) });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is made once per language; later text arrives through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Text from outside (a sample, a file, the graph's export) replaces what is there.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setProblemLine.of(problemLine) });
  }, [problemLine, value]);

  return <div ref={hostRef} className="code-editor" />;
}
