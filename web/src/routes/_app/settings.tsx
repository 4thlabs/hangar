import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";
import { settingsQueries } from "#modules/settings/api/settings-queries.ts";
import { ConfigSettingsCard } from "#modules/settings/components/config-settings-card.tsx";
import { EnvSettingsCard } from "#modules/settings/components/env-settings-card.tsx";
import { JobsSettingsCard } from "#modules/settings/components/jobs-settings-card.tsx";
import { StoreSettingsCard } from "#modules/settings/components/store-settings-card.tsx";
import { parseSettingsTab, settingsTabs, type SettingsTabId } from "#modules/settings/helpers/settings-tab.ts";

/**
 * How long a read the loader warmed is taken as it is, in milliseconds: a hover then a click runs the loader twice, and
 * the second reads nothing again. A suspense read takes it as fresh as long.
 */
const warmedFor = 1_000;

/** `/settings`, its tab in the hash. */
export const Route = createFileRoute("/_app/settings")({
  // Warmed, not waited for: each card shows its own skeleton and failure. The edited files are not: each is read as
  // its tab opens, and shown from that read alone.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery({ ...settingsQueries.storeStatus(), staleTime: warmedFor });
    void context.queryClient.prefetchQuery({ ...settingsQueries.jobs(), staleTime: warmedFor });
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
      <title>Settings | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage the configuration of your Hangar installation.</p>
      </div>
      <Tabs
        value={parseSettingsTab(hash)}
        onValueChange={(tab: SettingsTabId) => void navigate({ to: "/settings", hash: tab, replace: true })}
        className="gap-6"
      >
        <TabsList className="self-center">
          {settingsTabs.map(tab => (
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
        <TabsContent value="jobs">
          <JobsSettingsCard />
        </TabsContent>
      </Tabs>
    </main>
  );
}
