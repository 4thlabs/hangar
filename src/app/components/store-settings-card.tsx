"use client";

import { useState, useTransition } from "react";
import { CircleAlertIcon, CircleCheckIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";

export type StoreActionResult = {
  success: boolean;
  installed: boolean;
  message: string;
};

type StoreSettingsCardProps = {
  storeUrl: string;
  initialInstalled: boolean;
  manageStore: () => Promise<StoreActionResult>;
};

export function StoreSettingsCard({ storeUrl, initialInstalled, manageStore }: StoreSettingsCardProps) {
  const [installed, setInstalled] = useState(initialInstalled);
  const [result, setResult] = useState<StoreActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleManageStore() {
    setResult(null);

    startTransition(async () => {
      try {
        const nextResult = await manageStore();
        setInstalled(nextResult.installed);
        setResult(nextResult);
      } catch {
        setResult({
          success: false,
          installed,
          message: "Impossible de contacter le serveur. Réessayez.",
        });
      }
    });
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Store</CardTitle>
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
          {result && (
            <Alert variant={result.success ? "default" : "destructive"}>
              {result.success ? <CircleCheckIcon /> : <CircleAlertIcon />}
              <AlertTitle>{result.success ? "Opération terminée" : "Échec de l’opération"}</AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )}
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
