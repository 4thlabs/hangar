# ADR 0001: One cache, rendered without a spinner when warm

- **Status:** Accepted (1A, 2A, 3A, 4A)
- **Date:** 2026-10-06
- **Deciders:** Thomas

## Context

The pages read slow sources: the Docker daemon, the image-check report, the widgets' services. The previous
`#libs/cache` kept their answers, but did not work the way we wanted:

- **Spinners came back.** Whether a page showed its spinner depended on every caller remembering to `peek()`
  before it `read()`, and on nobody calling `clear()`. One `clear()` (the image report, on every notification)
  was enough to bring the `/apps` spinner back.
- **Not transparent.** A cached read needed `define(key, ttl, grace, load)`, a `Snapshot` with four methods,
  `Cache.join` for derived values, `renderSnapshot` and `<Warm ready={…peek()}>` in every page, and a warm loop
  that had to list what each page read.
- **No single entry point.** Five `new Cache()` (Docker, widgets, GitHub, image report, tests), each with its own
  `clear()`.

What was asked for:

1. A cache of rendered HTML, with a TTL.
2. Docker caches its own information.
3. One access point in the library; using it is transparent.
4. Start from scratch, without reusing the previous code.

## The fact the design rests on

React renders a promise **synchronously** when it carries `status: "fulfilled"` and a `value`, whether a server
component returns it or passes it to `use()`. Any other promise suspends, and the Suspense fallback goes out in the
shell first, however fast it settles; that includes the fresh promise every `async` component returns. Verified with
the repo's React 19.3 (`createLazyWrapperAroundWakeable` and `trackUsedThenable` in `react-server-dom-webpack`),
rendering through Flight then SSR, with `onShellReady`:

```html
<!--$-->
<p>warm-data</p>
<!--/$-->
use() on a marked promise
<!--$-->
<p>warm-element</p>
<!--/$-->
component returning a marked promise
<!--$?--><template id="B:0"></template>SPINNER<!--/$-->
async component, value already there
<!--$?--><template id="B:1"></template>SPINNER<!--/$-->
use() on an unmarked promise
```

So the cache hands back **the same promise object for as long as a value lives, marked once it settles**. A
component returns it (or calls `use()` on it) and renders inline when warm, suspending only when cold, behind an
ordinary `<Suspense>`. The one rule left for callers: never `await` a cached read inside a component.

## Decision 1: the shape of the one access point

All options share the same behaviour: fresh within `ttl`, served stale while reloading up to `maxStale`, awaited
beyond; concurrent reads share one load; a failed reload keeps the last good value.

### 1A. One `Cache` instance, `get` at the call site (chosen)

```ts
// #libs/cache
export class Cache {
  get<T>(key: string, policy: CachePolicy, load: () => Promise<T>): Promise<T>;
  refresh(prefix: string): Promise<void>; // reloads, readers keep the current value meanwhile
  keepWarm(intervalMs: number): () => void;
  clear(prefix: string): void; // tests only
}

// #libs/cache/server: the web server's one instance
export const cache = new Cache();
```

```ts
// Docker takes it by injection (AGENTS.md § Classes), keys under "docker:"
overview() {
  return this.cache.get("docker:overview", { ttl: 300_000, maxStale: 3_600_000 }, this.loadOverview);
}
```

One object to inject, `new Cache()` in a test, refresh by prefix. The key and policy are written at each `get`, in
practice once: one method per read.

### 1B. Bind once with `wrap` (not chosen)

`readonly containers = cache.wrap("docker:containers", policy, load)`. Close to the previous `define`, and a
parameterised read (one repository, one widget placement) needs a second form.

### 1C. A `@cached` method decorator (not chosen)

Most transparent, but standard decorators would have to go through TS 7, vite and the Babel ESLint parser, none of
which the repo uses, and the key would be implicit.

## Decision 2: derived values

### 2A. Synchronous `map` and `all` beside `get` (chosen)

```ts
projects() {
  return map(this.containers(), sources => summarize(sources));
}

runningImages() {
  return map(all([this.containers(), this.images()]), ([sources, digests]) => join(sources, digests));
}
```

Settled in, settled out in the same call; pending in, a promise out. Nothing derived is stored, so it cannot drift
from its sources, and refreshing them refreshes it.

### 2B. Cache derived values as entries of their own (not chosen)

A refresh would rebuild `projects` from the old `containers` still served during their own reload. Right only with
dependency tracking.

## Decision 3: the HTML cache with a TTL

### 3A. Cache the rendered element through the same `get` (chosen)

A widget's cached value is its rendered card, not its data:

```tsx
cache.get(`widget:${key}`, { ttl, maxStale }, async () => show(await load()));
```

A warm widget costs neither the service call nor the render, and the TTL comes from `hangar.yml` as before. The
element is fully rendered inside the load (`show` calls `render`), so React does not call anything again per
request. A widget over data another layer already caches (Docker) declares a `source` and is not cached twice.

### 3B. A response cache in a Hono middleware (not chosen)

Every page carries the session (navbar user, notifications), RSC navigations are separate requests, and a page could
only refresh as a whole.

### 3C. Serialise the RSC payload, like Next's `"use cache"` (not chosen)

Depends on React's unstable server APIs and Waku internals, for what 3A gives with an object reference.

## Decision 4: keeping it warm and fresh

### 4A. The cache owns both (chosen)

```ts
cache.keepWarm(30_000); // reloads every value read once that would go stale before the next tick
docker.follow(); // daemon events call cache.refresh("docker:…")
```

Started once from `src/app/middleware/cache-warm.ts`. The loop no longer lists what pages read, and the app never
clears: a notification calls `imageCheckReport.refresh()`. The first visit after a restart is still cold.

### 4B. 4A plus a startup prime (not chosen)

Rendering the dashboard's loads at boot would make that first visit warm too. Only worth it if that spinner shows.

## Errors

A failed load is never cached. Warm, the last good value is served until `maxStale`, and the failed reload is
logged. Cold, the read rejects, and `recover(read, onError)` turns that into the error card or alert, settled at
once when the failure is already known.

## Consequences

- Gone: `Snapshot`, `define`, `peek`/`read`/`revalidate`, `Cache.join`, `renderSnapshot`, `<Warm>`, the per-page warm
  list, `ImageCheckReport.invalidate` and the private `Cache` instances.
- A component that reads the cache returns the promise (`map`/`recover`), it is not `async`.
- `#libs/cache/server` carries no `server-only` guard: the instance binds no dependency. The Sidequest worker builds
  its own `Cache`, per run.
- `imageCheckReport`, which now binds the server cache, moves from the `#libs/jobs` barrel to `#libs/jobs/server`.
- Values stay warm once read, for the life of the process: a widget removed from `hangar.yml` keeps being reloaded
  until the next restart.
- A widget's render error is cached with its card for the TTL, as a fallback card.
