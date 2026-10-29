"use client";

import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Field, FieldDescription, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

type NewAppEditorProps = {
  /** The compose.yml the new app starts from */
  source: string;
  create: (id: string, source: string) => Promise<ActionResult>;
};

/** Writes a new app's compose.yml under the id typed in, then opens the app's own editor. */
export function NewAppEditor({ source, create }: NewAppEditorProps) {
  const router = useRouter();
  const [id, setId] = useState("");

  const { editor, handleSave, isPending } = useYamlEditor({
    source,
    save: value => create(id, value),
    titles: { success: "Application enregistrée", error: "Application refusée" },
    // The new app gets its own editor, so a second save edits it instead of re-creating it.
    onSaved: () => router.push({ to: "/apps/[project]/edit", params: { project: id } }),
    className: "h-[65vh]",
  });

  return (
    <div className="flex flex-col gap-3">
      <Field className="max-w-sm">
        <FieldLabel htmlFor="app-id">Identifiant</FieldLabel>
        <Input
          id="app-id"
          value={id}
          placeholder="mon-app"
          className="font-mono"
          onChange={event => setId(event.target.value.toLowerCase())}
        />
        <FieldDescription>Le dossier de l’app dans le store, et le nom de son projet compose.</FieldDescription>
      </Field>
      {editor}
      <PendingButton
        type="button"
        className="self-start"
        pending={isPending}
        pendingLabel="Validation…"
        icon={<SaveIcon data-icon="inline-start" />}
        disabled={id.length === 0}
        onClick={handleSave}
      >
        Enregistrer
      </PendingButton>
    </div>
  );
}
