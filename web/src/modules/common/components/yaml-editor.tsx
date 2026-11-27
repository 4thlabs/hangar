import { lazy, Suspense } from "react";
import { Spinner } from "#modules/common/ui/spinner.tsx";

/** CodeMirror, loaded with the first page that edits a file rather than with every page. */
const CodeEditor = lazy(async () => ({ default: (await import("#modules/common/ui/code-editor.tsx")).CodeEditor }));

type YamlEditorProps = {
  /** The file the editor opens with: remount it, with a new `key`, to load another. */
  source: string;
  className: string;
  /** Told the file as it is typed, as a form's field takes it. */
  onChange: (source: string) => void;
  /** Why the file was refused, under the editor; none when `undefined`. */
  refusal: string | undefined;
};

/**
 * A YAML file edited in place, its value held by the caller's form. A refusal stays under the editor, not in a toast:
 * the server's reason, a field of `hangar.yml` or compose's complaint, may run over several lines.
 */
export function YamlEditor({ source, className, onChange, refusal }: YamlEditorProps) {
  return (
    <>
      <Suspense fallback={<Spinner />}>
        <CodeEditor defaultValue={source} onChange={onChange} className={className} />
      </Suspense>
      {refusal !== undefined && (
        <pre role="alert" className="text-sm whitespace-pre-wrap text-destructive">
          {refusal}
        </pre>
      )}
    </>
  );
}
