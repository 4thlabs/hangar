import type { PageProps } from "waku/router";
import { unstable_notFound } from "waku/router/server";
import { hangar } from "#libs/hangar/server";
import { readAppFile, saveAppFile } from "#modules/store/actions/manage-app.ts";
import { AppEditor } from "#modules/store/components/app-editor.tsx";

/** The file the editor opens on: the one every app has, and the one Hangar reads it from. */
const DEFAULT_FILE = "compose.yml";

export default async function EditAppPage({ id }: PageProps<"/store/[id]/edit">) {
  const app = hangar.store.app(id);

  if (!app) {
    unstable_notFound();
  }

  const [files, source] = await Promise.all([
    hangar.store.appFiles(app.id),
    hangar.store.appFile(app.id, DEFAULT_FILE),
  ]);

  return (
    <main>
      <title>{`${app.name} | Hangar`}</title>
      <div>
        <h1 className="text-2xl font-semibold">{app.name}</h1>
        <p className="text-sm text-muted-foreground">
          Les fichiers de l’app, chacun vérifié avant d’être écrit : le <code>compose.yml</code> par{" "}
          <code>docker compose config</code>, les autres <code>.yml</code> et les <code>.env</code> par une lecture de
          leur syntaxe. Une app installée prend les changements à son prochain démarrage.
        </p>
      </div>
      <AppEditor
        id={app.id}
        files={files}
        initialFile={{ path: DEFAULT_FILE, source }}
        readFile={readAppFile}
        saveFile={saveAppFile}
      />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
