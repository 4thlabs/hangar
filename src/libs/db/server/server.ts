import "server-only";

/**
 * The database for the web server, guarded so the handle can never be pulled into a client
 * bundle. It exposes exactly what `#libs/db` does.
 *
 * The unguarded entry exists because Sidequest loads a job module in a plain Node process, where
 * `server-only` throws — the same split as `hangar`/`hangar/server` and `docker`/`docker/server`.
 */
export * from "../index.ts";
