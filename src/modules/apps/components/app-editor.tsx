"use client";

import { SaveIcon } from "lucide-react";
import { useRouter } from "waku";
import { AppFileTree } from "#modules/apps/components/app-file-tree.tsx";
import { useAppFiles, type AppFilesOptions } from "#modules/apps/hooks/use-app-files.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { CodeEditor } from "#modules/common/ui/code-editor.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type AppEditorProps = Omit<AppFilesOptions, "onSaved">;

/** Edits every file of a store app: a file tree on the left, the open file beside it. */
export function AppEditor(props: AppEditorProps) {
  const router = useRouter();

  const files = useAppFiles({
    ...props,
    onSaved: ({ composeChanged }) => {
      // The compose file may rename the app or change its icon, which the page and the store list show.
      // The server tells, as an alias or another case may lead to it.
      if (composeChanged) {
        router.reload();
      }
    },
  });

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(12rem,16rem)_1fr]">
      <AppFileTree
        paths={files.paths}
        selectedPath={files.selectedPath}
        unsavedPaths={files.unsavedPaths}
        onSelect={files.select}
        onCreate={files.create}
        isCreating={files.isPending}
      />
      <div className="flex min-w-0 flex-col gap-3">
        <p className="font-mono text-sm text-muted-foreground">{files.selectedPath}</p>
        {files.selectedDraft === undefined ? (
          <div className="flex h-[65vh] items-center justify-center rounded-lg border border-input">
            {files.isLoading && <Spinner />}
          </div>
        ) : (
          <CodeEditor
            key={files.selectedPath}
            defaultValue={files.selectedDraft}
            onChange={files.updateDraft}
            className="h-[65vh]"
          />
        )}
        {files.error && <pre className="text-sm whitespace-pre-wrap text-destructive">{files.error}</pre>}
        <PendingButton
          type="button"
          className="self-start"
          pending={files.isPending}
          pendingLabel="Validation…"
          icon={<SaveIcon data-icon="inline-start" />}
          disabled={files.selectedDraft === undefined}
          onClick={files.save}
        >
          Enregistrer
        </PendingButton>
      </div>
    </div>
  );
}
