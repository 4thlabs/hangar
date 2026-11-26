import { useState } from "react";
import { useStoreNewApp } from "#libs/api";
import { ErrorMessage } from "#modules/common/error-message.ts";
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
      {error && <p className="text-sm text-destructive">{ErrorMessage.of(error)}</p>}
      {template && <NewAppEditor source={template.compose} />}
    </main>
  );
}

/** The new app's id, as its folder in the store, and its `compose.yml`. */
function NewAppEditor({ source }: { source: string }) {
  const [id, setId] = useState("");
  const { editor } = useYamlEditor({ source, className: "h-[65vh]" });

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
    </div>
  );
}
