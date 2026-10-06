import "server-only";

import { db } from "#libs/db/server";
import { Notifications } from "../notifications.ts";

/** The notification centre for the web server; jobs get theirs from `src/libs/jobs/worker.ts`. */
export const notifications = new Notifications(db);
