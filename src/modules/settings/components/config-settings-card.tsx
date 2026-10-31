"use client";

import { SaveIcon } from "lucide-react";
import { useRouter } from "waku";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { SettingsMessages } from "#modules/settings/messages.ts";

type ConfigSettingsCardProps = {
  source: string;
  saveConfig: (source: string) => Promise<ActionResult>;
};

export function ConfigSettingsCard({ source, saveConfig }: ConfigSettingsCardProps) {
  const router = useRouter();
  const { t } = useTranslation(SettingsMessages);

  const { editor, handleSave, isPending } = useYamlEditor({
    source,
    save: saveConfig,
    titles: { success: t("config.saved"), error: t("config.rejected") },
    onSaved: () => router.reload(),
    className: "h-[60vh]",
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("config.title")}</CardTitle>
        <CardDescription>
          {t("config.description.before")}
          <code>hangar.yml</code>
          {t("config.description.after")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{editor}</CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={isPending}
          pendingLabel={t("saving")}
          icon={<SaveIcon data-icon="inline-start" />}
          onClick={handleSave}
        >
          {t("save")}
        </PendingButton>
      </CardFooter>
    </Card>
  );
}
