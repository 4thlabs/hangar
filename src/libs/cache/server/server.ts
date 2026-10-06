import { Cache } from "../cache.ts";

// Reused across HMR reloads, otherwise dev drops every warm value on each edit
const globalForCache = globalThis as unknown as { cache?: Cache };

/**
 * The web server's one cache, which every server-side reader shares. No `server-only` guard: it
 * binds no dependency, and the Sidequest worker builds its own (`src/libs/jobs/worker.ts`).
 */
export const cache = globalForCache.cache ?? new Cache();

globalForCache.cache = cache;
