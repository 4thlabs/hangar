import { hangar } from "#libs/hangar/server";

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
    if (!AppOperationGuard.ComposeProjectName.test(project)) {
      return { reason: "invalid", message: "La commande Docker Compose est invalide." };
    }

    if (!hangar.store.app(project)?.installed) {
      return { reason: "unmanaged", message: "Cette application n’est pas installée et gérée par Hangar." };
    }

    return null;
  }
}
