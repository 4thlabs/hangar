import { Sidequest } from "sidequest";
import { hangar } from "#libs/hangar/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#modules/common/ui/tabs.tsx";
import { saveConfig } from "#modules/settings/actions/manage-config.ts";
import { saveEnv } from "#modules/settings/actions/manage-env.ts";
import { cancelJob, runJob } from "#modules/settings/actions/manage-job.ts";
import { manageStore } from "#modules/settings/actions/manage-store.ts";
import { ConfigSettingsCard } from "#modules/settings/components/config-settings-card.tsx";
import { EnvSettingsCard } from "#modules/settings/components/env-settings-card.tsx";
import { JobsSettingsCard } from "#modules/settings/components/jobs-settings-card.tsx";
import { StoreSettingsCard } from "#modules/settings/components/store-settings-card.tsx";

export default async function SettingsPage() {
  const installed = await hangar.store.isInstalled();
  const jobs = await Sidequest.job.list({ limit: 50 });
  const variables = await hangar.store.env.read();
  const config = await hangar.store.config.source();

  return (
    <main>
      <title>Paramètres | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Gérez la configuration de votre installation Hangar.</p>
      </div>
      <Tabs defaultValue="store" className="gap-6">
        <TabsList className="self-center">
          <TabsTrigger value="store">Store</TabsTrigger>
          <TabsTrigger value="env">Environnement</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="store">
          <StoreSettingsCard storeUrl={hangar.store.url} initialInstalled={installed} manageStore={manageStore} />
        </TabsContent>
        <TabsContent value="env">
          <EnvSettingsCard variables={variables} saveEnv={saveEnv} />
        </TabsContent>
        <TabsContent value="config">
          <ConfigSettingsCard source={config} saveConfig={saveConfig} />
        </TabsContent>
        <TabsContent value="jobs">
          <JobsSettingsCard jobs={jobs} runJob={runJob} cancelJob={cancelJob} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
