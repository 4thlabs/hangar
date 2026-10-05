import Dockerode from "dockerode";
import { db } from "#libs/db";
import { Docker, DockerEvents } from "#libs/docker";
import { hangar } from "#libs/hangar/server";
import { Notifications } from "#libs/notifications";

/** Every service Hangar runs on, bound to its real dependencies. */
export type Services = ReturnType<typeof createServices>;

/**
 * Binds Hangar's services to the real daemon, store and database: the one place they are wired.
 *
 * Unguarded, so a Sidequest job can call it from the plain Node worker, where `server-only` throws.
 * The web server goes through `#libs/services/server`, which calls it once behind that guard.
 */
export function createServices() {
  // Constructed with no options so it applies its own defaults, `DOCKER_HOST` included. This is
  // the only place the package is imported as a value: everywhere else takes the client by
  // injection, which keeps the rest of the libs out of the browser bundle.
  const client = new Dockerode();
  const docker = new Docker(client, hangar.store);

  return {
    hangar,
    db,
    docker,
    /**
     * The daemon's events, refreshing {@link docker}'s snapshots as they come. Not started here:
     * module scope in the RSC graph is evaluated by `waku build`, where there is no daemon to
     * follow. `src/app/middleware/cache-warm.ts` starts it with the server.
     */
    dockerEvents: new DockerEvents(client, change => void docker.refresh([change])),
    notifications: new Notifications(db),
  };
}
