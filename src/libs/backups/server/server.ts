import "server-only";
import { hangar } from "#libs/hangar/server";
import { AppBackups } from "../app-backups.ts";

/** The archives of the apps this Hangar installed. The Sidequest worker builds its own (`src/libs/jobs/worker.ts`). */
export const backups = new AppBackups(hangar.store.backupsPath, hangar.store.appDataPath);
