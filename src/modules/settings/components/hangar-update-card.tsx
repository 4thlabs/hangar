"use client";

import { ArrowUpFromLineIcon } from "lucide-react";
import { useState } from "react";
import type { ActionResult, ReadResult } from "#modules/common/actions/action-result.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { SettingsMessages } from "#modules/settings/messages.ts";

type HangarUpdateCardProps = {
  /** The image an update pulls, or why Hangar cannot update itself here. */
  image: ReadResult<string>;
  updateHangar: () => Promise<ActionResult>;
};

export function HangarUpdateCard({ image, updateHangar }: HangarUpdateCardProps) {
  const [confirming, setConfirming] = useState(false);
  const { run, isPending } = useServerAction();
  const { t } = useTranslation(SettingsMessages);

  function update() {
    setConfirming(false);
    run(updateHangar, { success: t("hangar.started"), error: t("hangar.startFailed") });
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{t("hangar.title")}</CardTitle>
        <CardDescription>{t("hangar.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="hangar-image">{t("hangar.image")}</FieldLabel>
            <Input
              id="hangar-image"
              value={image.success ? image.value : "—"}
              readOnly
              aria-describedby="hangar-image-status"
            />
            <FieldDescription id="hangar-image-status">
              {image.success ? t("hangar.tagHint") : image.message}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={isPending}
          pendingLabel={t("hangar.starting")}
          icon={<ArrowUpFromLineIcon data-icon="inline-start" />}
          disabled={!image.success}
          onClick={() => setConfirming(true)}
        >
          {t("hangar.update")}
        </PendingButton>
      </CardFooter>
      <ConfirmDialog
        open={confirming}
        title={t("hangar.confirmTitle")}
        description={t("hangar.confirmDescription")}
        confirmLabel={t("hangar.confirm")}
        onConfirm={update}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
