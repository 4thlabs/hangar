import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Field, FieldDescription, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { storeMutations, storeQueries } from "#modules/store/api/store-queries.ts";

/**
 * `/store/new`, a new app of the store. `store_`: a page of its own beside `/store`, not a child rendered inside it.
 */
export const Route = createFileRoute("/_app/store_/new")({
  // Warmed, not waited for: the page shows the template once read, and why it was not. The template does not change
  // while the server runs, so the page reads it from the cache.
  loader: ({ context }) => void context.queryClient.prefetchQuery(storeQueries.newApp()),
  component: NewAppPage,
});

/** `/store/new`: the id of a new app, and its `compose.yml`, which starts from the server's template. */
function NewAppPage() {
  const { data: template, error } = useQuery(storeQueries.newApp());

  return (
    <main>
      <title>New app | Hangar</title>
      <h1 className="text-2xl font-semibold">New app</h1>
      {error && <p className="text-sm text-destructive">{describeError(error)}</p>}
      {template && <NewAppEditor source={template.compose} />}
    </main>
  );
}

/** Writes a new app's `compose.yml` under the id typed in, then opens the app's own editor. */
function NewAppEditor({ source }: { source: string }) {
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const { editor, value, setRefusal } = useYamlEditor({ source, className: "h-[65vh]" });

  // The options have the store's apps read again, which lists the new one, before these run.
  const create = useMutation({
    ...storeMutations.createApp(),
    onSuccess: async app => {
      toastSuccess("App saved", `${app.id} was added to the store.`);
      // The new app gets its own editor, so that a second save edits it rather than create it again.
      await navigate({ to: "/store/$id/edit", params: { id: app.id } });
    },
    onError: failure => {
      setRefusal(describeError(failure));
      toastFailure("App rejected", failure);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Field className="max-w-sm">
        <FieldLabel htmlFor="app-id">Identifier</FieldLabel>
        <Input
          id="app-id"
          value={id}
          placeholder="my-app"
          className="font-mono"
          onChange={event => setId(event.target.value.toLowerCase())}
        />
        <FieldDescription>The app's folder in the store, and the name of its compose project.</FieldDescription>
      </Field>
      {editor}
      <PendingButton
        type="button"
        className="self-start"
        pending={create.isPending}
        pendingLabel="Validating…"
        icon={<SaveIcon data-icon="inline-start" />}
        disabled={id.length === 0}
        onClick={() => create.mutate({ data: { id, compose: value } })}
      >
        Save
      </PendingButton>
    </div>
  );
}
