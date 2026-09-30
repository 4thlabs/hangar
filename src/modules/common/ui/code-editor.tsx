"use client";

import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { indentLess, indentMore } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { keymap, type Command } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { cn } from "cn";

/** Colours from the app's tokens, so light and dark themes follow without a second theme. */
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { caretColor: "var(--foreground)", fontFamily: "var(--font-mono, monospace)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-gutters": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--ring) 35%, transparent)",
  },
});

// ponytail: mid-tone hues readable on both backgrounds; Lezer's YAML only tells keys from values.
const highlight = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: "oklch(0.62 0.14 240)" },
  { tag: tags.string, color: "oklch(0.62 0.14 150)" },
  { tag: [tags.labelName, tags.typeName], color: "oklch(0.68 0.15 70)" },
  { tag: [tags.lineComment, tags.meta], color: "var(--muted-foreground)", fontStyle: "italic" },
]);

/**
 * Tab types the indent unit (spaces: YAML refuses tabs) at the cursor, or indents the selected
 * lines. Escape then Tab still leaves the editor, CodeMirror's own way out of a Tab-bound editor.
 */
const insertIndent: Command = view => {
  if (view.state.selection.ranges.some(range => !range.empty)) return indentMore(view);
  view.dispatch(view.state.replaceSelection(view.state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" });
  return true;
};

type CodeEditorProps = {
  /** The initial document: the editor owns the text afterwards */
  defaultValue: string;
  onChange: (value: string) => void;
  className?: string;
};

/** A YAML editor. Uncontrolled: remount it (a new `key`) to load another document. */
export function CodeEditor({ defaultValue, onChange, className }: CodeEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  // Read through a ref: the view is built once, and must not keep the first render's callback.
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      doc: defaultValue,
      parent: parent.current!,
      extensions: [
        basicSetup,
        keymap.of([{ key: "Tab", run: insertIndent, shift: indentLess }]),
        yaml(),
        theme,
        syntaxHighlighting(highlight),
        EditorView.updateListener.of(update => {
          if (update.docChanged) change.current(update.state.doc.toString());
        }),
      ],
    });

    return () => view.destroy();
  }, []);

  return (
    <div
      ref={parent}
      className={cn(
        "overflow-hidden rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 [&_.cm-editor]:h-full",
        className,
      )}
    />
  );
}
