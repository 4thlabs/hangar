"use client";

import { useState } from "react";
import { SaveIcon } from "lucide-react";
import { useRouter } from "waku";
import type { ActionResult } from "#app/actions/action-result.ts";
import { PendingButton } from "#app/components/common/pending-button.tsx";
import { useYamlEditor } from "#app/components/common/use-yaml-editor.tsx";
import { Field, FieldDescription, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";

type AppEditorProps = {
  /** The app being edited; absent when adding one, whose id is then typed in */
  id?: string;
  source: string;
  saveApp: (id: string, source: string, create: boolean) => Promise<ActionResult>;
};

/** Edits a store app's compose.yml, or writes a new app's. */
export function AppEditor({ id, source, saveApp }: AppEditorProps) {
  const router = useRouter();
  const [newId, setNewId] = useState("");
  const create = id === undefined;
  const appId = id ?? newId;

  const { editor, handleSave, isPending } = useYamlEditor({
    source,
    save: value => saveApp(appId, value, create),
    titles: { success: "Application enregistrée", error: "Application refusée" },
    // A new app gets its own editor, so a second save edits it instead of re-creating it.
    onSaved: () => (create ? router.push(`/store/${appId}/edit`) : router.reload()),
    className: "h-[65vh]",
  });

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
      {editor}
      <PendingButton
        type="button"
        className="self-start"
        pending={isPending}
        pendingLabel="Validation…"
        icon={<SaveIcon data-icon="inline-start" />}
        disabled={appId.length === 0}
        onClick={handleSave}
      >
        Enregistrer
      </PendingButton>
    </div>
  );
}
