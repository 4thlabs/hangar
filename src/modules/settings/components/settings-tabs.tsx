"use client";

import type { ReactNode } from "react";
import { useRouter } from "waku";
import { Tabs, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";
import { SettingsTab, type SettingsTabId } from "#modules/settings/settings-tab.ts";

/** The settings tabs, the URL hash saying which one is open, so a link or the Spotlight can open any of them. */
export function SettingsTabs({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <Tabs
      value={SettingsTab.parse(router.hash)}
      onValueChange={(tab: SettingsTabId) => void router.replace({ to: "/settings", hash: tab })}
      className="gap-6"
    >
      <TabsList className="self-center">
        {SettingsTab.All.map(tab => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
