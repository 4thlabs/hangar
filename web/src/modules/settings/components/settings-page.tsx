import { useLocation, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";
import { ConfigSettingsCard } from "#modules/settings/components/config-settings-card.tsx";
import { EnvSettingsCard } from "#modules/settings/components/env-settings-card.tsx";
import { StoreSettingsCard } from "#modules/settings/components/store-settings-card.tsx";
import { SettingsTab, type SettingsTabId } from "#modules/settings/settings-tab.ts";

/** `/settings`: the store, `.env.global` and `hangar.yml`, a tab each, the URL's hash saying which one is open. */
export function SettingsPage() {
  const hash = useLocation({ select: location => location.hash });
  const navigate = useNavigate();

  return (
    <main>
      <title>Settings | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage the configuration of your Hangar installation.</p>
      </div>
      <Tabs
        value={SettingsTab.parse(hash)}
        onValueChange={(tab: SettingsTabId) => void navigate({ to: "/settings", hash: tab, replace: true })}
        className="gap-6"
      >
        <TabsList className="self-center">
          {SettingsTab.All.map(tab => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="store">
          <StoreSettingsCard />
        </TabsContent>
        <TabsContent value="env">
          <EnvSettingsCard />
        </TabsContent>
        <TabsContent value="config">
          <ConfigSettingsCard />
        </TabsContent>
      </Tabs>
    </main>
  );
}
