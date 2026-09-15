import { cancelJob, runJob } from "#app/actions/jobs/manage-job.ts";
import { manageStore } from "#app/actions/store/manage-store.ts";
import { JobsSettingsCard } from "#app/components/settings/jobs-settings-card.tsx";
import { StoreSettingsCard } from "#app/components/settings/store-settings-card.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#app/components/ui/tabs.tsx";
import { hangar } from "#libs/hangar/server";
import { Sidequest } from "sidequest";

export default async function SettingsPage() {
  const installed = await hangar.store.isInstalled();
  const jobs = await Sidequest.job.list({ limit: 50 });

  return (
    <main>
      <title>Paramètres | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Gérez la configuration de votre installation Hangar.</p>
      </div>
      <Tabs defaultValue="store">
        <TabsList>
          <TabsTrigger value="store">Store</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="store">
          <StoreSettingsCard
            storeUrl={hangar.config.storeUrl()}
            initialInstalled={installed}
            manageStore={manageStore}
          />
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
