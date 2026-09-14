import { hangar } from "#libs/hangar/server";
import { isAppOperation, type AppOperation } from "./app-operation.ts";

const COMPOSE_PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** Docker Compose arguments run for each operation */
export const appOperationArguments: Record<AppOperation, readonly string[]> = {
  up: ["up", "-d"],
  down: ["down"],
  recreate: ["up", "-d", "--force-recreate"],
};

/** Why a compose command was refused, or `null` when it may run */
export type AppOperationRefusal = {
  reason: "invalid" | "unmanaged";
  message: string;
};

/**
 * Checks a compose command is well formed and targets an app Hangar installed and manages.
 * Both the server action and the streaming route go through this: a second copy of the
 * check is a second place for it to drift.
 * @param project The Compose project name
 * @param operation The requested operation
 */
export function refuseAppOperation(project: string, operation: string): AppOperationRefusal | null {
  if (!COMPOSE_PROJECT_NAME.test(project) || !isAppOperation(operation)) {
    return { reason: "invalid", message: "La commande Docker Compose est invalide." };
  }

  const app = [...hangar.store.apps].find(candidate => candidate.id === project && candidate.installed);
  if (!app) {
    return { reason: "unmanaged", message: "Cette application n’est pas installée et gérée par Hangar." };
  }

  return null;
}
