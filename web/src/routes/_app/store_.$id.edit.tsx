import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { getEditorFilesQueryKey, getStoreAppsQueryKey, useEditorFiles, useEditorRead, type SavedFile } from "#libs/api";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { AppEditor } from "#modules/store/components/app-editor.tsx";
import { composeFileName } from "#modules/store/helpers/compose-file.ts";

/**
 * `/store/$id/edit`, the editor of an app of the store. `store_`: a page of its own beside `/store`, not a child
 * rendered inside it.
 */
export const Route = createFileRoute("/_app/store_/$id/edit")({
  component: EditAppPage,
});

/** How the edit page reads the app: anew each time it opens, and not when the window gets the focus back. */
const editedFileQuery = { staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false } as const;

/** `/store/$id/edit`: every file of a store app, its `compose.yml` open first. */
function EditAppPage() {
  const { id } = useParams({ from: "/_app/store_/$id/edit" });
  const queryClient = useQueryClient();
  // Shown from this mount's reads alone: a sync or an install may have changed the files since a page read them.
  const opened = useEditorFiles(id, { query: editedFileQuery });
  const compose = useEditorRead(id, { path: composeFileName }, { query: editedFileQuery });
  const isRead = opened.isFetchedAfterMount && compose.isFetchedAfterMount;

  // The compose file may rename the app or change its icon, which the page and the store show: the server tells, as
  // a symlink or another case may lead to it. The drafts stay, as the editor is keyed on the app alone.
  const onSaved = ({ composeChanged }: SavedFile) => {
    if (composeChanged) {
      void queryClient.invalidateQueries({ queryKey: getEditorFilesQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: getStoreAppsQueryKey() });
    }
  };

  return (
    <main>
      <title>{`${opened.data?.app.name ?? id} | Hangar`}</title>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{opened.data?.app.name ?? id}</h1>
        <p className="text-sm text-muted-foreground">
          The app's files, each checked before it is written: the <code>compose.yml</code> by{" "}
          <code>docker compose config</code>, and by <code>docker stack config</code> beside a{" "}
          <code>compose.swarm.yml</code>, the other <code>.yml</code> and <code>.yaml</code> files and the{" "}
          <code>.env</code> files by a read of their syntax. Those other files are changed in place: a container that
          mounts them sees the new content at once. Changes to the <code>compose.yml</code> apply the next time the app
          starts.
        </p>
      </div>
      {opened.error && <p className="text-sm text-destructive">{describeError(opened.error)}</p>}
      {!opened.error && compose.error && (
        <Alert variant="destructive">
          <AlertTitle>This app cannot be edited here</AlertTitle>
          <AlertDescription>{describeError(compose.error)}</AlertDescription>
        </Alert>
      )}
      {isRead && opened.data && compose.data && (
        <AppEditor id={id} files={opened.data.files} initialFile={compose.data} onSaved={onSaved} />
      )}
    </main>
  );
}
