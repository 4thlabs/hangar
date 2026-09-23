"use client";

import { useState } from "react";
import { SaveIcon } from "lucide-react";
import { useRouter } from "waku";
import type { ActionResult } from "#app/actions/action-result.ts";
import { Button } from "#app/components/ui/button.tsx";
import { CodeEditor } from "#app/components/ui/code-editor.tsx";
import { Field, FieldDescription, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";

type AppEditorProps = {
  /** The app being edited; absent when adding one, whose id is then typed in */
  id?: string;
  source: string;
  saveApp: (id: string, source: string, create: boolean) => Promise<ActionResult>;
};

/** Edits a store app's compose.yml, or writes a new app's. */
export function AppEditor({ id, source, saveApp }: AppEditorProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [newId, setNewId] = useState("");
  const [value, setValue] = useState(source);
  // docker compose explains itself over several lines: keep them under the editor, not in a toast.
  const [error, setError] = useState<string | null>(null);
  const create = id === undefined;
  const appId = id ?? newId;

  const handleSave = () =>
    run(
      () => saveApp(appId, value, create),
      { success: "Application enregistrée", error: "Application refusée" },
      result => {
        setError(result && !result.success ? result.message : null);
        if (!result?.success) return;
        // A new app gets its own editor, so a second save edits it instead of re-creating it.
        if (create) router.push(`/store/${appId}/edit`);
        else router.reload();
      },
    );

  return (
    <div className="flex flex-col gap-3">
      {create && (
        <Field className="max-w-sm">
          <FieldLabel htmlFor="app-id">Identifiant</FieldLabel>
          <Input
            id="app-id"
            value={newId}
            placeholder="mon-app"
            className="font-mono"
            onChange={event => setNewId(event.target.value.toLowerCase())}
          />
          <FieldDescription>Le dossier de l’app dans le store, et le nom de son projet compose.</FieldDescription>
        </Field>
      )}
      <CodeEditor defaultValue={source} onChange={setValue} className="h-[65vh]" />
      {error && <pre className="text-sm whitespace-pre-wrap text-destructive">{error}</pre>}
      <Button type="button" className="self-start" disabled={isPending || appId.length === 0} onClick={handleSave}>
        {isPending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
        {isPending ? "Validation…" : "Enregistrer"}
      </Button>
    </div>
  );
}
