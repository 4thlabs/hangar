import { hangar } from "#libs/hangar/server";
import type { AppOperation } from "./app-operation.ts";

const COMPOSE_PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** Docker Compose arguments run for each operation */
export const appOperationArguments: Record<AppOperation, readonly string[]> = {
  up: ["up", "-d"],
  down: ["down"],
  recreate: ["up", "-d", "--force-recreate"],
  update: ["up", "-d", "--pull", "always"],
};

/** Why a compose command was refused. */
type AppOperationRefusal = {
  reason: "invalid" | "unmanaged";
  message: string;
};

/** Why a compose command on `project` is refused (malformed name, or not an app Hangar manages), or `null`. */
export function refuseAppOperation(project: string): AppOperationRefusal | null {
  if (!COMPOSE_PROJECT_NAME.test(project)) {
    return { reason: "invalid", message: "La commande Docker Compose est invalide." };
  }

  if (!hangar.store.app(project)?.installed) {
    return { reason: "unmanaged", message: "Cette application n’est pas installée et gérée par Hangar." };
  }

  return null;
}
