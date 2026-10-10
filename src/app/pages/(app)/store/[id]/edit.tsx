import type { PageProps } from "waku/router";
import { unstable_notFound } from "waku/router/server";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { createAppFile, readAppFile, saveAppFile } from "#modules/store/actions/manage-app.ts";
import { AppEditor } from "#modules/store/components/app-editor.tsx";
import { COMPOSE_FILE } from "#modules/store/compose-file.ts";

export default async function EditAppPage({ id }: PageProps<"/store/[id]/edit">) {
  const app = hangar.store.app(id);

  if (!app) {
    unstable_notFound();
  }

  const [files, compose] = await Promise.all([hangar.store.appFiles(app.id), readComposeFile(app.id)]);

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
      {"refusal" in compose ? (
        <Alert variant="destructive">
          <AlertTitle>Cette app ne peut pas être modifiée ici</AlertTitle>
          <AlertDescription>{compose.refusal}</AlertDescription>
        </Alert>
      ) : (
        <AppEditor
          id={app.id}
          files={files}
          initialFile={{ path: COMPOSE_FILE, source: compose.source }}
          readFile={readAppFile}
          saveFile={saveAppFile}
          createFile={createAppFile}
        />
      )}
    </main>
  );
}

/**
 * The compose.yml the editor opens on, or why it cannot be: one the store refuses to edit, such as a
 * symlink leading out of the app folder, leaves the page up with the reason instead of failing it.
 */
async function readComposeFile(id: string): Promise<{ source: string } | { refusal: string }> {
  try {
    return { source: await hangar.store.appFile(id, COMPOSE_FILE) };
  } catch (error) {
    if (error instanceof HangarError) {
      return { refusal: error.message };
    }

    throw error;
  }
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
