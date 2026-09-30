"use client";

import { SaveIcon } from "lucide-react";
import { useRouter } from "waku";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

type ConfigSettingsCardProps = {
  source: string;
  saveConfig: (source: string) => Promise<ActionResult>;
};

export function ConfigSettingsCard({ source, saveConfig }: ConfigSettingsCardProps) {
  const router = useRouter();
  const { editor, handleSave, isPending } = useYamlEditor({
    source,
    save: saveConfig,
    titles: { success: "Configuration enregistrée", error: "Configuration refusée" },
    onSaved: () => router.reload(),
    className: "h-[60vh]",
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>CONFIGURATION</CardTitle>
        <CardDescription>
          Le fichier <code>hangar.yml</code> du store : catégories, fichiers partagés et widgets du tableau de bord. Il
          est validé avant d’être écrit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{editor}</CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={isPending}
          pendingLabel="Enregistrement…"
          icon={<SaveIcon data-icon="inline-start" />}
          onClick={handleSave}
        >
          Enregistrer
        </PendingButton>
      </CardFooter>
    </Card>
  );
}
