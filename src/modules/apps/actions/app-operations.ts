import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { AppsMessages } from "#modules/apps/messages.ts";

/** Why a compose command was refused. */
type AppOperationRefusal = {
  reason: "invalid" | "unmanaged";
  message: string;
};

/** The server-side checks on the apps a compose command targets. Its arguments come from `AppCommands`. */
export class AppOperationGuard {
  static readonly ComposeProjectName = /^[a-z0-9][a-z0-9_-]*$/;

  /** Why a compose command on `project` is refused (malformed name, or not an app Hangar manages), or `null`. */
  static refuse(project: string): AppOperationRefusal | null {
    const { t } = ServerTranslation.get(AppsMessages);

    if (!AppOperationGuard.ComposeProjectName.test(project)) {
      return { reason: "invalid", message: t("commands.invalid") };
    }

    if (!hangar.store.app(project)?.installed) {
      return { reason: "unmanaged", message: t("commands.unmanaged") };
    }

    return null;
  }
}
