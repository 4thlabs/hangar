import { lazy, Suspense, useState } from "react";
import { Spinner } from "#modules/common/ui/spinner.tsx";

/** CodeMirror, loaded with the first page that edits a file rather than with every page. */
const CodeEditor = lazy(async () => ({ default: (await import("#modules/common/ui/code-editor.tsx")).CodeEditor }));

type YamlEditorOptions = {
  /** The file the editor opens with: remount the caller, with a new `key`, to load another. */
  source: string;
  className: string;
};

/**
 * A YAML file edited in place; the caller places the editor and saves its `value`. A refusal stays under the editor,
 * not in a toast: the server's reason, a field of `hangar.yml` or compose's complaint, may run over several lines.
 */
export function useYamlEditor({ source, className }: YamlEditorOptions) {
  const [value, setValue] = useState(source);
  const [refusal, setRefusal] = useState<string | null>(null);

  const editor = (
    <>
      <Suspense fallback={<Spinner />}>
        <CodeEditor defaultValue={source} onChange={setValue} className={className} />
      </Suspense>
      {refusal && <pre className="text-sm whitespace-pre-wrap text-destructive">{refusal}</pre>}
    </>
  );

  return { editor, value, setRefusal };
}
