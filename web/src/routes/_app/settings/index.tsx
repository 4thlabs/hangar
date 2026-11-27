import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";
import { settingsQueries } from "#modules/settings/api/settings-queries.ts";
import { ConfigSettingsCard } from "#modules/settings/components/config-settings-card.tsx";
import { EnvSettingsCard } from "#modules/settings/components/env-settings-card.tsx";
import { JobsSettingsCard } from "#modules/settings/components/jobs-settings-card.tsx";
import { StoreSettingsCard } from "#modules/settings/components/store-settings-card.tsx";
import { settingsLabels } from "#modules/settings/helpers/settings-labels.ts";
import { parseSettingsTab, settingsTabs, type SettingsTabId } from "#modules/settings/helpers/settings-tab.ts";
import { m } from "#paraglide/messages.js";

/** `/settings`, its tab in the hash. */
export const Route = createFileRoute("/_app/settings/")({
  // Warmed, not waited for: each card shows its own skeleton and failure. Their options keep a warmed read fresh for a
  // second, so that the card that mounts reads nothing again. The edited files are not warmed: each is read as its tab
  // opens, and shown from that read alone.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(settingsQueries.storeStatus());
    void context.queryClient.prefetchQuery(settingsQueries.jobs());
  },
  component: SettingsPage,
});

/**
 * `/settings`: the store, `.env.global`, `hangar.yml` and the server's jobs, a tab each, the URL's hash saying which one
 * is open.
 */
function SettingsPage() {
  const hash = useLocation({ select: location => location.hash });
  const navigate = useNavigate();

  return (
    <main>
      <title>{m.settings_page_document_title()}</title>
      <div>
        <h1 className="text-2xl font-semibold">{m.settings_page_title()}</h1>
        <p className="text-sm text-muted-foreground">{m.settings_page_description()}</p>
      </div>
      <Tabs
        value={parseSettingsTab(hash)}
        onValueChange={(tab: SettingsTabId) => void navigate({ to: "/settings", hash: tab, replace: true })}
        className="gap-6"
      >
        <TabsList className="self-center">
          {settingsTabs.map(tab => (
            <TabsTrigger key={tab} value={tab}>
              {settingsLabels.tabs[tab]()}
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
        <TabsContent value="jobs">
          <JobsSettingsCard />
        </TabsContent>
      </Tabs>
    </main>
  );
}
