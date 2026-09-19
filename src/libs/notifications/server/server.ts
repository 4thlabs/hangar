import "server-only";

import { db } from "#libs/db/server";
import { Notifications } from "../notifications.ts";

/**
 * The notification centre for the web server.
 *
 * This is the only place the database handle is bound to it: a Sidequest job runs outside this
 * module graph and builds its own, the way `check-image-version.ts` builds its own Docker client.
 */
export const notifications = new Notifications(db);
