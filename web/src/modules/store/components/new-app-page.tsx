import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { getStoreAppsQueryKey, useEditorCreateApp, useStoreNewApp } from "#libs/api";
import { toastFailure, toastSuccess } from "#modules/common/components/action-toast.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { describeError } from "#modules/common/error-message.ts";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Field, FieldDescription, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

/** `/store/new`: the id of a new app, and its `compose.yml`, which starts from the server's template. */
export function NewAppPage() {
  const { data: template, error } = useStoreNewApp({ query: { staleTime: Infinity } });

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const { editor, value, setRefusal } = useYamlEditor({ source, className: "h-[65vh]" });

  const create = useEditorCreateApp({
    mutation: {
      onSuccess: async app => {
        toastSuccess("App saved", `${app.id} was added to the store.`);
        await queryClient.invalidateQueries({ queryKey: getStoreAppsQueryKey() });
        // The new app gets its own editor, so that a second save edits it rather than create it again.
        await navigate({ to: "/store/$id/edit", params: { id: app.id } });
      },
      onError: failure => {
        setRefusal(describeError(failure));
        toastFailure("App rejected", failure);
      },
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
