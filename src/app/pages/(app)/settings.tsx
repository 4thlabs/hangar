import { Sidequest } from "sidequest";
import { hangar } from "#libs/hangar/server";
import { TabsContent } from "#modules/common/ui/tabs.tsx";
import { saveConfig } from "#modules/settings/actions/manage-config.ts";
import { saveEnv } from "#modules/settings/actions/manage-env.ts";
import { cancelJob, runJob } from "#modules/settings/actions/manage-job.ts";
import { manageStore } from "#modules/settings/actions/manage-store.ts";
import { readHangarImage, updateHangar } from "#modules/settings/actions/update-hangar.ts";
import { ConfigSettingsCard } from "#modules/settings/components/config-settings-card.tsx";
import { EnvSettingsCard } from "#modules/settings/components/env-settings-card.tsx";
import { HangarUpdateCard } from "#modules/settings/components/hangar-update-card.tsx";
import { JobsSettingsCard } from "#modules/settings/components/jobs-settings-card.tsx";
import { SettingsTabs } from "#modules/settings/components/settings-tabs.tsx";
import { StoreSettingsCard } from "#modules/settings/components/store-settings-card.tsx";

export default async function SettingsPage() {
  const installed = await hangar.store.isInstalled();
  const jobs = await Sidequest.job.list({ limit: 50 });
  const variables = await hangar.store.env.read();
  const config = await hangar.store.config.source();
  const hangarImage = await readHangarImage();

  return (
    <main>
      <title>Paramètres | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Gérez la configuration de votre installation Hangar.</p>
      </div>
      <SettingsTabs>
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
        <TabsContent value="hangar">
          <HangarUpdateCard image={hangarImage} updateHangar={updateHangar} />
        </TabsContent>
      </SettingsTabs>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
