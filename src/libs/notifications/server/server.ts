import "server-only";

import { db } from "#libs/db/server";
import { Notifications } from "../notifications.ts";

/**
 * The notification centre for the web server.
 *
 * This is the only place the web server binds the database handle to it: a Sidequest job runs
 * outside this module graph and gets its own from the worker's composition root,
 * `src/libs/jobs/worker.ts`.
 */
export const notifications = new Notifications(db);
