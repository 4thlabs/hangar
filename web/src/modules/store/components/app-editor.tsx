import { SaveIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { AppFileTree } from "#modules/store/components/app-file-tree.tsx";
import { useAppFiles, type AppFilesOptions } from "#modules/store/hooks/use-app-files.ts";

/** CodeMirror, loaded with the first page that edits a file rather than with every page. */
const CodeEditor = lazy(async () => ({ default: (await import("#modules/common/ui/code-editor.tsx")).CodeEditor }));

/**
 * Edits every file of a store app: the file tree on the left, the open file beside it, and why a file was refused
 * under it.
 *
 * Keyed on the app: moving to another app's editor keeps the page mounted, as only its `$id` changes, and the tree,
 * the open file and the drafts were seeded by the app the editor opened on.
 */
export function AppEditor(props: AppFilesOptions) {
  return <SingleAppEditor key={props.id} {...props} />;
}

/** The editor of the one app it mounted with. */
function SingleAppEditor(props: AppFilesOptions) {
  const files = useAppFiles(props);

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(12rem,16rem)_1fr]">
      <div className="flex min-w-0 flex-col gap-3">
        <AppFileTree
          paths={files.paths}
          selectedPath={files.selectedPath}
          unsavedPaths={files.unsavedPaths}
          onSelect={files.select}
          onCreate={files.create}
          isCreating={files.isPending}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="font-mono text-sm text-muted-foreground">{files.selectedPath}</p>
        {files.selectedDraft === undefined ? (
          <div className="flex h-[65vh] items-center justify-center rounded-lg border border-input">
            {files.isLoading && <Spinner />}
          </div>
        ) : (
          <Suspense fallback={<Spinner />}>
            <CodeEditor
              key={files.selectedPath}
              defaultValue={files.selectedDraft}
              onChange={files.updateDraft}
              className="h-[65vh]"
            />
          </Suspense>
        )}
        {files.error && <pre className="text-sm whitespace-pre-wrap text-destructive">{files.error}</pre>}
        <PendingButton
          type="button"
          className="self-start"
          pending={files.isPending}
          pendingLabel="Validating…"
          icon={<SaveIcon data-icon="inline-start" />}
          disabled={files.selectedDraft === undefined}
          onClick={files.save}
        >
          Save
        </PendingButton>
      </div>
    </div>
  );
}
