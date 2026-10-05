import "server-only";

import { createServices } from "../services.ts";

/**
 * The services of the web server, built once, guarded so none of them can be pulled into a client
 * bundle. `#libs/docker/server` and `#libs/notifications/server` re-export from here.
 */
export const { docker, dockerEvents, notifications } = createServices();
