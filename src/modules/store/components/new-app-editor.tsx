"use client";

import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Field, FieldDescription, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { StoreMessages } from "#modules/store/messages.ts";

type NewAppEditorProps = {
  /** The compose.yml the new app starts from */
  source: string;
  create: (id: string, source: string) => Promise<ActionResult>;
};

/** Writes a new app's compose.yml under the id typed in, then opens the app's own editor. */
export function NewAppEditor({ source, create }: NewAppEditorProps) {
  const router = useRouter();
  const [id, setId] = useState("");
  const { t } = useTranslation(StoreMessages);

  const { editor, handleSave, isPending } = useYamlEditor({
    source,
    save: value => create(id, value),
    titles: { success: t("editor.appSaved"), error: t("editor.appRejected") },
    // The new app gets its own editor, so a second save edits it instead of re-creating it.
    onSaved: () => router.push(`/store/${id}/edit`),
    className: "h-[65vh]",
  });

  return (
    <div className="flex flex-col gap-3">
      <Field className="max-w-sm">
        <FieldLabel htmlFor="app-id">{t("editor.appId")}</FieldLabel>
        <Input
          id="app-id"
          value={id}
          placeholder={t("editor.appIdPlaceholder")}
          className="font-mono"
          onChange={event => setId(event.target.value.toLowerCase())}
        />
        <FieldDescription>{t("editor.appIdDescription")}</FieldDescription>
      </Field>
      {editor}
      <PendingButton
        type="button"
        className="self-start"
        pending={isPending}
        pendingLabel={t("editor.validating")}
        icon={<SaveIcon data-icon="inline-start" />}
        disabled={id.length === 0}
        onClick={handleSave}
      >
        {t("editor.save")}
      </PendingButton>
    </div>
  );
}
