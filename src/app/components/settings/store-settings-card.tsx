"use client";

import { useState, useTransition } from "react";
import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { Card } from "#app/components/card/accent-card.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { createStoreActionToast, createStoreTransportErrorToast } from "#app/components/store/store-action-toast.ts";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { toast } from "#app/components/ui/toast.tsx";

type StoreSettingsCardProps = {
  storeUrl: string;
  initialInstalled: boolean;
  manageStore: () => Promise<StoreActionResult>;
};

export function StoreSettingsCard({ storeUrl, initialInstalled, manageStore }: StoreSettingsCardProps) {
  const [installed, setInstalled] = useState(initialInstalled);
  const [isPending, startTransition] = useTransition();

  function handleManageStore() {
    startTransition(async () => {
      try {
        const nextResult = await manageStore();
        setInstalled(nextResult.installed);
        toast.add(
          createStoreActionToast(nextResult, {
            success: "Opération terminée",
            error: "Échec de l’opération",
          }),
        );
      } catch {
        toast.add(createStoreTransportErrorToast("Échec de l’opération"));
      }
    });
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>STORE</CardTitle>
        <CardDescription>Consultez le dépôt configuré et synchronisez sa copie locale.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="store-url">URL du store</FieldLabel>
            <Input id="store-url" value={storeUrl} readOnly aria-describedby="store-status" />
            <FieldDescription id="store-status">
              {installed ? "Le store est installé localement." : "Le store n’est pas encore installé."}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button type="button" disabled={isPending} onClick={handleManageStore}>
          {isPending ? (
            <Spinner data-icon="inline-start" />
          ) : installed ? (
            <RefreshCwIcon data-icon="inline-start" />
          ) : (
            <DownloadIcon data-icon="inline-start" />
          )}
          {isPending ? "Synchronisation…" : installed ? "Mettre à jour" : "Installer"}
        </Button>
      </CardFooter>
    </Card>
  );
}
