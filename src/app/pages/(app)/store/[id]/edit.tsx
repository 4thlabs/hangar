import type { PageProps } from "waku/router";
import { unstable_notFound } from "waku/router/server";
import { saveApp } from "#app/actions/store/manage-app.ts";
import { AppEditor } from "#app/components/store/app-editor.tsx";
import { hangar } from "#libs/hangar/server";

export default async function EditAppPage({ id }: PageProps<"/store/[id]/edit">) {
  const app = hangar.store.app(id);

  if (!app) unstable_notFound();

  const source = await hangar.store.appSource(app.id);

  return (
    <main>
      <title>{`${app.name} | Hangar`}</title>
      <div>
        <h1 className="text-2xl font-semibold">{app.name}</h1>
        <p className="text-sm text-muted-foreground">
          Le <code>compose.yml</code> de l’app, validé par <code>docker compose config</code> avant d’être écrit. Une
          app installée prend les changements à son prochain démarrage.
        </p>
      </div>
      <AppEditor id={app.id} source={source} saveApp={saveApp} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
