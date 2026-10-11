import { HangarStore } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import type { AppOperation } from "./app-operation.ts";

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

/** Why a compose command on `project` is refused (malformed name, or no app of the store), or `null`. */
export function refuseAppOperation(project: string): AppOperationRefusal | null {
  if (!HangarStore.ProjectName.test(project)) {
    return { reason: "invalid", message: "La commande Docker Compose est invalide." };
  }

  if (!hangar.store.app(project)) {
    return { reason: "unmanaged", message: "Cette application n’est pas une application du store." };
  }

  return null;
}
