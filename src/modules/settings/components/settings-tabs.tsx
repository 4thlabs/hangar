"use client";

import type { ReactNode } from "react";
import { useRouter } from "waku";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Tabs, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";
import { SettingsMessages } from "#modules/settings/messages.ts";
import { SettingsTab, type SettingsTabId } from "#modules/settings/settings-tab.ts";

/** The settings tabs, the URL hash saying which one is open, so a link or the Spotlight can open any of them. */
export function SettingsTabs({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useTranslation(SettingsMessages);

  return (
    <Tabs
      value={SettingsTab.parse(router.hash)}
      onValueChange={(tab: SettingsTabId) => void router.replace({ to: "/settings", hash: tab })}
      className="gap-6"
    >
      <TabsList className="self-center">
        {SettingsTab.All.map(tab => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {t(`tabs.${tab.id}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
