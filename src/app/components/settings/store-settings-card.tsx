"use client";

import { useState } from "react";
import type { StoreActionResult } from "#app/actions/store/store-action-result.ts";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";

type StoreSettingsCardProps = {
  storeUrl: string;
  initialInstalled: boolean;
  manageStore: () => Promise<StoreActionResult>;
};

export function StoreSettingsCard({ storeUrl, initialInstalled, manageStore }: StoreSettingsCardProps) {
  const [installed, setInstalled] = useState(initialInstalled);
  const { run, isPending } = useServerAction();

  const handleManageStore = () =>
    // The synchronisation itself runs detached server-side: this toast only says it started,
    // and its outcome arrives later as a notification.
    run(manageStore, { success: "Synchronisation lancée", error: "Échec du lancement" }, result => {
      // Only a returned result carries the new state; a transport failure leaves it as it was.
      if (result) setInstalled(result.installed);
    });

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
