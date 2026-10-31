import { Fragment } from "react";
import type { PageProps } from "waku/router";
import { unstable_notFound } from "waku/router/server";
import { HangarError, type AppFiles } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { ProjectActions } from "#modules/apps/components/project-actions.tsx";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { createAppFile, readAppFile, saveAppFile } from "#modules/store/actions/manage-app.ts";
import { AppEditor } from "#modules/store/components/app-editor.tsx";
import { COMPOSE_FILE } from "#modules/store/compose-file.ts";
import { StoreMessages } from "#modules/store/messages.ts";

export default async function EditAppPage({ id }: PageProps<"/store/[id]/edit">) {
  const app = hangar.store.app(id);

  if (!app) {
    unstable_notFound();
  }

  const { t } = ServerTranslation.get(StoreMessages);
  const appFiles = await hangar.store.files(app.id);
  const [files, compose] = await Promise.all([appFiles.list(), readComposeFile(appFiles)]);

  return (
    <main>
      <title>{`${app.name} | Hangar`}</title>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{app.name}</h1>
          {/* Compose runs over the installed apps only. */}
          {app.installed && <ProjectActions project={app.id} />}
        </div>
        <p className="text-sm text-muted-foreground">
          {/* Indexed: the sentence is fixed, and the same file name comes up twice in it. */}
          {t("editPage.description", text => <code>{text}</code>).map((part, index) => (
            <Fragment key={index}>{part}</Fragment>
          ))}
        </p>
      </div>
      {"refusal" in compose ? (
        <Alert variant="destructive">
          <AlertTitle>{t("editPage.refusal")}</AlertTitle>
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
async function readComposeFile(appFiles: AppFiles): Promise<{ source: string } | { refusal: string }> {
  try {
    return { source: await appFiles.read(COMPOSE_FILE) };
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
