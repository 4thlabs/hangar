"use client";

import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { SettingsMessages } from "#modules/settings/messages.ts";
import type { StoreActionResult } from "#modules/store/actions/store-action-result.ts";

type StoreSettingsCardProps = {
  storeUrl: string;
  initialInstalled: boolean;
  manageStore: () => Promise<StoreActionResult>;
};

export function StoreSettingsCard({ storeUrl, initialInstalled, manageStore }: StoreSettingsCardProps) {
  const [installed, setInstalled] = useState(initialInstalled);
  const { run, isPending } = useServerAction();
  const { t } = useTranslation(SettingsMessages);

  const handleManageStore = () =>
    // The synchronisation itself runs detached server-side: this toast only says it started,
    // and its outcome arrives later as a notification.
    run(manageStore, { success: t("store.started"), error: t("store.startFailed") }, result => {
      // Only a returned result carries the new state; a transport failure leaves it as it was.
      if (result) {
        setInstalled(result.installed);
      }
    });

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{t("store.title")}</CardTitle>
        <CardDescription>{t("store.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="store-url">{t("store.url")}</FieldLabel>
            <Input id="store-url" value={storeUrl} readOnly aria-describedby="store-status" />
            <FieldDescription id="store-status">
              {installed ? t("store.installed") : t("store.notInstalled")}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={isPending}
          pendingLabel={t("store.syncing")}
          icon={installed ? <RefreshCwIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
          onClick={handleManageStore}
        >
          {installed ? t("store.update") : t("store.install")}
        </PendingButton>
      </CardFooter>
    </Card>
  );
}
