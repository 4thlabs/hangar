"use client";

import { ArrowUpFromLineIcon } from "lucide-react";
import { useState } from "react";
import type { ActionResult, ReadResult } from "#modules/common/actions/action-result.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

type HangarUpdateCardProps = {
  /** The image an update pulls, or why Hangar cannot update itself here. */
  image: ReadResult<string>;
  updateHangar: () => Promise<ActionResult>;
};

export function HangarUpdateCard({ image, updateHangar }: HangarUpdateCardProps) {
  const [confirming, setConfirming] = useState(false);
  const { run, isPending } = useServerAction();

  function update() {
    setConfirming(false);
    run(updateHangar, { success: "Mise à jour lancée", error: "Échec du lancement" });
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>HANGAR</CardTitle>
        <CardDescription>Mettez Hangar à jour vers la dernière image publiée sous son tag.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="hangar-image">Image</FieldLabel>
            <Input
              id="hangar-image"
              value={image.success ? image.value : "—"}
              readOnly
              aria-describedby="hangar-image-status"
            />
            <FieldDescription id="hangar-image-status">
              {image.success
                ? "Le tag choisi dans votre compose.yml décide de la version : latest suit les releases, edge chaque merge."
                : image.message}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={isPending}
          pendingLabel="Lancement…"
          icon={<ArrowUpFromLineIcon data-icon="inline-start" />}
          disabled={!image.success}
          onClick={() => setConfirming(true)}
        >
          Mettre à jour Hangar
        </PendingButton>
      </CardFooter>
      <ConfirmDialog
        open={confirming}
        title="Mettre à jour Hangar ?"
        description="Hangar télécharge son image puis, si elle a changé, redémarre : la page sera indisponible quelques secondes. Les applications ne sont pas touchées."
        confirmLabel="Mettre à jour"
        onConfirm={update}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
