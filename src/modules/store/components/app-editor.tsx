"use client";

import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Field, FieldDescription, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

type AppEditorProps = {
  /** The app being edited; absent when adding one, whose id is then typed in */
  id?: string;
  source: string;
  /** Creates the app when `id` is absent, saves it otherwise */
  save: (id: string, source: string) => Promise<ActionResult>;
};

/** Edits a store app's compose.yml, or writes a new app's. */
export function AppEditor({ id, source, save }: AppEditorProps) {
  const router = useRouter();
  const [newId, setNewId] = useState("");
  const create = id === undefined;
  const appId = id ?? newId;

  const { editor, handleSave, isPending } = useYamlEditor({
    source,
    save: value => save(appId, value),
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
