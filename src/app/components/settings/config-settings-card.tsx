"use client";

import { useState } from "react";
import { SaveIcon } from "lucide-react";
import { useRouter } from "waku";
import type { ActionResult } from "#app/actions/action-result.ts";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { CodeEditor } from "#app/components/ui/code-editor.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";

type ConfigSettingsCardProps = {
  source: string;
  saveConfig: (source: string) => Promise<ActionResult>;
};

export function ConfigSettingsCard({ source, saveConfig }: ConfigSettingsCardProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [value, setValue] = useState(source);
  // The validation issues span several lines: a toast would squash them, keep them under the editor.
  const [error, setError] = useState<string | null>(null);

  const handleSave = () =>
    run(
      () => saveConfig(value),
      { success: "Configuration enregistrée", error: "Configuration refusée" },
      result => {
        setError(result && !result.success ? result.message : null);
        if (result?.success) router.reload();
      },
    );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>CONFIGURATION</CardTitle>
        <CardDescription>
          Le fichier <code>hangar.yml</code> du store : catégories, fichiers partagés et widgets du tableau de bord. Il
          est validé avant d’être écrit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CodeEditor defaultValue={source} onChange={setValue} className="h-[60vh]" />
        {error && <pre className="text-sm whitespace-pre-wrap text-destructive">{error}</pre>}
      </CardContent>
      <CardFooter>
        <Button type="button" disabled={isPending} onClick={handleSave}>
          {isPending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </CardFooter>
    </Card>
  );
}
