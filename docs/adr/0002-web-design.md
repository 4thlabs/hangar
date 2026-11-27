# ADR 0002: The page's design in `web/`: the Waku layout, with a data layer, one stream model and catalogs

- **Status:** Accepted on 2026-11-26: option A, with the [decisions](#decisions) below and the
  [addendum's](#decisions-of-the-addendum)
- **Date:** 2026-11-26
- **Amended:** by #207 on 2026-11-26, [decisions 1](#decision-1-layers-and-what-each-may-import), [6](#decision-6-files)
  and [10](#decision-10-the-migration)'s rule 4: TanStack Router's own layout (a route file is its page, the shell a
  layout route, the wiring at `src/`), and modules that import only `common` and `libs`. What this record says of a
  module's root `.ts` applies to its `helpers/`. By #203 on 2026-11-27, [decisions 3](#decision-3-one-model-for-quoll-events),
  [4](#decision-4-errors-and-feedback) and [10](#decision-10-the-migration), and
  [rule 15](#rule-15-route-preloading): loaders that warm with `prefetchQuery` and wait for nothing, and the bell's
  feed closed while the tab is hidden. On the maintainer's decision of 2026-11-27, also by #203, decision 4's regions
  and rule 15: `QueryRegion` over the caller's `useQuery` and `RenderRegion`, with no `Suspense`, and a warmed read
  that keeps a `staleTime` at least the warm one.
- **Deciders:** Thomas
- **Study:** read-only, on `origin/main` at `d4eeec5` (#176 merged since, at `e37fd06`), and the web changes of
  `4thlabs/issue-176` and `4thlabs/issue-178`. The rewrite of two modules was made in a scratch worktree. Its patch
  (83 files, `git apply` on `d4eeec5`) is kept outside the repository and is not committed.
- **In short:** the [`hangar-web` skill](../../.agents/skills/hangar-web/SKILL.md) gives the rules with one example
  per layer. This record gives the why.

## Context

`web/` is the Rust server's page: a Vite SPA with React and its compiler, TanStack Router (code routes today,
file routes with #186), TanStack Query on the hooks orval writes from the OpenAPI document, quoll `Events` streams,
and shadcn components. The maintainer's verdict is that its TypeScript "lacks design". Measured on `origin/main`:

- **46 classes made only of static members, in 45 files.** The count comes from the lint selector of decision 7, run
  on the tree before the change. #178 adds 16 more (`Severity`, `HealthDot`, `ClockFormat`, `PriceCurve`,
  `DashboardColumns`...). Some take their real dependency at each call: `SessionGuard.require(queryClient)`,
  `SessionGuard.signedOut(router, queryClient)`, `NotificationCache.change(queryClient, ...)`.
- **Pages mix four jobs.** `apps-page.tsx` reads the URL and an orval hook, opens the Docker feed, holds the
  selection, sums the totals, filters and sorts, and lays out. Nothing in it can be tested without rendering the
  route.
- **No data layer.** 26 imports of orval's `use*` hooks sit in components and hooks. A query's policy is written at
  each call site: `{ staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false }` twice in settings.
  What a change makes stale is decided in four styles: a predicate on URL prefixes (`DockerQueries`), a `wasRunning`
  ref in an effect (store sync), an awaited `Promise.all` in a mutation's `onSuccess` (config save), and
  `invalidateQueries` calls inside a stream hook (compose).
- **Five hand-written stream hooks** on one transport (`ServerEvents`). Each one repeats the open/close
  bookkeeping. Visibility handling is written twice (`use-docker-changes`, `use-docker-stats`). The per-frame
  batching and the status machine are written twice too (`use-compose-stream`, `use-log-events`).
- **Texts in three places**: literals in JSX, `*Text` classes (`StoreSyncText`, `JobText`, `ProjectStatusView`),
  and `ErrorMessage`, the per-code table.

Already decided, and taken as constraints here:

- [#195](https://github.com/4thlabs/hangar/issues/195) (2026-11-26): no class made only of statics. What has no state becomes module functions and consts. What has
  state or dependencies becomes a class created with `new`, its dependencies passed to the constructor, one shared
  instance created where the page is built.
- English only (2026-11-24), but every error carries a code and params (`ErrorCode`,
  [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)), and every notification a key and params, so that translation
  can come later.
- [#186](https://github.com/4thlabs/hangar/issues/186): file routes with `autoCodeSplitting`. The route files stay thin, and the modules do not move.

The study had no TypeScript skill for the coding-team roles, which came later. It followed the generic steps, with the
repository's `npm run typecheck`, `eslint` and `vitest` as its experiments.

## The baseline: the Waku version's organisation (`src/`)

The maintainer finds it was good. This is what it is.

**Layers and what imports what.**

```
src/app/pages/(app)/apps.tsx          thin page: <title>, <Suspense>, getConfig (its search codec)
  └ modules/apps/components/apps-content.tsx     server component: reads AppsSnapshot.load(), never awaits it
      ├ modules/apps/snapshots.ts                data access: docker, hangar, imageCheckReport through the Cache
      └ modules/apps/components/apps-overview.tsx  "use client": gets the snapshot as props, filters, counts, lays out
          ├ modules/apps/filter.ts, format.ts, search-codec.ts   plain helpers, free functions and static classes
          ├ modules/apps/hooks/use-docker-stats.ts               the live part
          └ modules/apps/messages.ts                             the words, a typed catalog
modules/apps/actions/*.ts             "use server": zod, sessions.require(), libs, an ActionResult {success, message}
libs/*                                framework-free classes, dependencies by constructor, bound in libs/*/server
```

- One module per page domain, with `actions/`, `components/`, `hooks/`, and plain `.ts` at its root. `common` holds
  the shell, `ui/` and the generic hooks. A module may import another directly. No barrel.
- **State.** Server state was the render. A page was read again with `router.reload()`, and `AutoReload` did it
  every 30 seconds. URL state went through `unstable_searchCodec`. Local UI state lived in the client components.
  Preferences were cookies and jotai atoms.
- **Mutations.** A server action returned an `ActionResult`. `useServerAction` ran it in a transition, toasted its
  message and called `onSettled`.
- **Streams.** One generic hook, `common/hooks/use-stream-text.ts`, served logs and compose output, with
  `use-command-stream.ts` on top of it. Only `use-docker-stats` was its own.
- **Texts.** A `messages.ts` per module (9 of them), read with `t()`.
- **Helpers.** Mixed: 48 files export free functions or consts (`filterProjects`, `countBy`, `MAX_STREAM_CHARACTERS`),
  and 50 have static classes (`MetricFormat`, `TableSort`, `CommandStream`).

**What carries over to an SPA as it is:** modules by domain, the folders `components/` and `hooks/` with plain
`.ts` at the root, thin pages (they become #186's route files), the split between a part that reads and a part that
lays out props (`apps-content` against `apps-overview`), one generic stream hook in `common`, one catalog per
module, and "a module may import another".

**What must change, because RSC and server actions are gone:**

| Waku                                                         | SPA                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `actions/` (server code the page calls)                      | `api/`: query and mutation options on orval's, keys, what each change makes stale  |
| `*Snapshot.load()` in a server component                     | `useQuery(xQueries.y())`, warmed by a route loader's `prefetchQuery` (rule 15)     |
| `router.reload()`, `AutoReload` every 30 s                   | the query cache, invalidated by mutations and by the `Events` feeds                |
| `ActionResult.message`, in the reader's language             | an `ApiError` with a code and params, worded by the page (`describeError`)         |
| `Suspense` over a marked promise ([ADR 0001](0001-cache.md)) | `useQuery`, shown by a region with its own error boundary (amended by #203)        |
| `use-stream-text` (text chunks)                              | typed `Events` items: one hook for feeds that do not end, one for streams that end |
| `ServerTranslation` / `useTranslation`                       | none for now: `messages.ts` is a plain object, English only                        |
| `searchCodec`                                                | the route's `validateSearch`, on functions of the module's root `.ts`              |

**How far `web/` drifted from it.** It kept the modules and their folders. It lost four things:

- the split between reading and laying out: `AppsPage` is both;
- the data-access layer: orval hooks are called from components, and the policies and staleness rules are spread;
- the single stream hook: there are five;
- the catalogs: the words went back into the JSX and into static classes.

It also turned the baseline's free functions into static classes (`filterProjects` became `ProjectFilter.apply`,
`countBy` became `ProjectFilter.count`), under AGENTS.md's rule.

## Options

### A. The baseline, adapted to the SPA (recommended)

The Waku layout as it was, with `actions/` replaced by `api/`, one stream model in `common/hooks`, `Region`
boundaries, and the #195 rule. Everything below, decisions 1 to 10, is this option.

### B. bulletproof-react's features

`src/features/<x>/{api,components,hooks,stores,types,utils}`, `src/app/routes`, and shared → features → app imports,
with no import from one feature to another, enforced with `import/no-restricted-paths`. Its `api/` files hold a
fetcher, a `queryOptions` and a hook per request.

- Taken into A: `api/` per domain, `queryOptions` shared by loaders and components, one-way imports enforced by lint,
  no barrels.
- Not taken: the ban on imports between features. Hangar's domains call each other on purpose: notifications word
  compose actions, spotlight lists each module's source, settings reads the store. The fetcher per request is not
  taken either, as orval writes it. Renaming `modules/` to `features/` would only cost a diff.
- Taken since, by #207 on 2026-11-26: the ban on imports between modules. What two modules share goes down into
  `common`, and the routes compose the modules, as TanStack Router's examples compose their pages.

[Feature-Sliced Design](https://feature-sliced.design/) (app, pages, widgets, features, entities, shared, each slice with a public API) goes further in
the same direction. Its seven layers are too many for twelve pages.

### C. Code colocated with the routes

The code would sit under TanStack's file routes: `routes/_app/apps/-components/...`, as `routeFileIgnorePrefix`
allows. This contradicts #186 ("the modules do not move"). It would also split one domain across routes: the apps
list, an app's page, the spotlight source and the notification words share `compose-actions.ts`. Not taken.

### A against the baseline, point by point

| Point            | Waku baseline                                        | A                                                        | Who wins                                 |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| Modules, folders | by domain, `components/` `hooks/` root `.ts`         | the same                                                 | the same                                 |
| Data access      | `actions/` + `*Snapshot`                             | `api/`: options, keys, staleness, `Session`              | the same role                            |
| Page component   | content (reads) / overview (lays out)                | page reads its inputs, one view-model function, lays out | the same split, cheaper                  |
| Computations     | in the client overview (`totals` reduce) and helpers | in root `.ts` functions only (`appsView`)                | A, by one rule the baseline did not hold |
| Server state     | the render, reload every 30 s                        | the query cache, invalidated by mutations and feeds      | A (forced: no RSC)                       |
| Streams          | one hook, text                                       | two hooks, typed, on one transport                       | the same idea                            |
| Texts            | `messages.ts` with `t()`                             | `messages.ts`, a plain object, no `t()`                  | the baseline's place, simpler            |
| Helpers          | free functions and static classes, mixed             | functions and consts only, classes with instances        | A (#195)                                 |
| Lint             | blank lines only                                     | + the static-class selector and the import boundaries    | A                                        |

So the baseline, adapted, is the better choice. It is option A. What A adds is the minimum an SPA needs that RSC gave
for free: a place for the cache's keys and policies, and a model for the feeds that replace `router.reload()`. The
before/after below is written in the baseline's form.

## Decision 1: layers, and what each may import

Amended by #207 on 2026-11-26, to follow TanStack Router's own examples (`kitchen-sink-react-query-file-based`,
`authenticated-routes`, `start-trellaux`) and keep the modules apart: the route file is the page, the shell is the
layout route `_app.tsx`, the wiring is a few files at `src/`, and the domain `.ts` of a module is in its `helpers/`.
Amended again by #210 on 2026-11-27: the routes are in one folder per section, and the layout is `_app/route.tsx`
(decision 6).

```
src/main.tsx, page.ts, router.ts   the wiring: createPage (QueryClient, Session, Preferences, router), the router,
                                   the providers (app-providers.tsx, theme-effects.tsx); no app/ folder
src/routes/                        one file per route = its page: path, validateSearch, beforeLoad, loader, and the
                                   component that composes the modules; one folder per section under _app/, whose
                                   route.tsx is the shell, its pieces in _app/-shell/ (decision 6)
src/modules/<d>/api/               query and mutation options on orval's, keys, staleness maps, services (Session)
src/modules/<d>/helpers/           the domain: pure functions, view models, search params, formats, labels, parsers
src/modules/<d>/hooks/             compose queries, feeds and local state machines (useComposeCommand, useStoreSync)
src/modules/<d>/components/        the pieces the pages are made of
src/modules/<d>/messages.ts        the module's words (decision 5), the one file at a module's root
src/modules/common/                what two modules or more share: ui/, components/, hooks/, api/, helpers/
src/libs/                          the API client, formats, preferences
```

| Layer                     | May import                                                         | Must not import                                                                                           |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `helpers/`, `messages.ts` | types and enums of `#libs/api`, `helpers/` of its own and `common` | React, `@tanstack/*`, orval's hooks/keys/fetchers, `api/`, `hooks/`, `components/`, `ui/` (types allowed) |
| `api/`                    | `#libs/api` options, keys, URLs; `helpers/`                        | React, orval's `use*` hooks, `hooks/`, `components/`                                                      |
| `hooks/`                  | `api/`, `helpers/`, `common/hooks`                                 | orval's `use*` hooks                                                                                      |
| `components/`             | everything above, `ui/`                                            | orval's `use*` hooks                                                                                      |
| a module, any layer       | its own folders, `common`, `#libs/...`                             | another module, `routes/`, the wiring; `common` imports no other module                                   |
| `routes/`                 | every module, the wiring's types                                   | orval's `use*` hooks                                                                                      |

Every one of these is a lint rule (decision 10), checked on probe files and on the violations it finds in the code.
A module goes down into `common` only when two modules really use it: the compose vocabulary (`compose-actions.ts`,
which the bell words) and the Docker changes feed (`use-docker-changes.ts`, which the Docker card follows) did. The
bell is composed by the shell, in `routes/_app/-shell/`.

**Where computations live.** In `helpers/` functions, tested without rendering. **A page component may** read the
route (`useSearch`, `useParams`), call its module's hooks and `useQuery(xQueries.y())`, hold UI state it owns (the
selection), call one view-model function, and lay out regions. **It may not** reduce, filter or sort inline, build
or invalidate a key, open a stream, or write a word that is chosen by a code or an enum.

## Decision 2: state, each kind in one place

- **Server state** lives in the query cache, and nowhere else. The keys are orval's, split by path segment with
  `override.query.shouldSplitQueryKey: true` (checked: `["api", "docker", "apps", project]`), so that
  `invalidateQueries({ queryKey: ["api", "docker"] })` matches every Docker read with no predicate.
  `DockerQueries`'s `startsWith` predicate goes.
- **One copy only.** Query data is never copied into `useState`. The one exception is a form's working copy, keyed by
  the read it started from (`<EnvForm key={dataUpdatedAt}>`, as today).
- **After a mutation**, the mutation's options say what it makes stale: `meta: { invalidates: [...] }`, typed through
  `Register.mutationMeta` and run by the client's `MutationCache.onSuccess`. That callback is awaited, so the mutation
  stays pending until the reads are done. The test "takes no typing while a save runs" passes on it. When the answer
  is the new state, `setQueryData` is used instead (env save, sync started).
- **After a stream event**, a map from event to keys sits next to the queries (`staleAfterDockerChange`), and
  everything under the feed's prefix is invalidated when the feed opens, to catch up.
- **URL state**: search params validated by the route's `validateSearch`, on the module's root functions
  (`validateAppsSearch`); the settings tab is the hash. It is read, never mirrored into state.
- **Local UI state** lives in the component or hook that owns it.
- **Preferences** stay as they are: cookies read once in `main.tsx`, jotai atoms for the theme. Rule 16 of the
  addendum replaces this: jotai goes, and the preferences become a `Preferences` instance.
- **Polling** stays only where no event exists: the store sync and the jobs, each second. Both are candidates for an
  event later.

## Decision 3: one model for quoll `Events`

The transport stays in `#libs/api/server-events.ts`, as functions: `keepEvents` (EventSource, reconnect from 1 s
doubled to 30 s), `followEvents`, and `readEvents` (fetch, POST, the `problem` event). Two hooks sit on it in
`common/hooks`. Each replaces a family:

```ts
// A feed that does not end: connected again when lost, closed while the tab is hidden, none for a null url.
// The handlers are the latest render's (useEffectEvent), so changing them does not reconnect.
useEventFeed<T>(url: string | null, { onItem, onOpen?, onDown?, onClose? }): { isDown: boolean }

// A stream that ends: its items folded into S, rendered once a frame, at most 500 items waiting for one; `end`
// gives "ended", a close before it gives "error" when requiresEnd, with no failure. read() from a click or an effect.
useEventStream<T, S>(initial, { fold, isEnd, requiresEnd?, onOpen?, onEnd? })
  : { state, setState, status, failure, read(url, seed, request?), stop }
```

- **Rule.** A feed that describes server state writes the cache: it invalidates, or calls `setQueryData`. It never
  keeps a parallel copy. Data that no query holds (stats frames, log lines, compose output) stays in the hook's state.
- **Replaced.** `use-docker-changes` went from 68 to 24 lines, `use-docker-stats` from 60 to 22, `use-compose-stream`
  from 135 to 59, and `use-log-events` from 99 to 46. The two common hooks are 202 lines, for every page to come
  (#179's stack deploy output, #178's Docker card, #177's backup runs).
- **Notifications, amended by #203 on 2026-11-27:** `use-notifications` is on `useEventFeed` too. Its URL takes a
  cursor from the first list read, kept in state, and its changes are chained in order. As every feed, it closes
  while the tab is hidden, which it did not before, and resumes from that cursor once shown: what was filed meanwhile
  comes then, and the list holds each once.
- **Not chosen:** TanStack Query's `experimental_streamedQuery`. It turns an AsyncIterable into a query, but a
  compose run is a POST started by a click, and its output belongs to no cache entry. A server-side multiplexer of all
  feeds was not chosen either: it changes the contract for no gain at this size.

## Decision 4: errors and feedback

- **Problems by code.** `describeError(error)` and `describeErrorDetail(detail)`, which were `ErrorMessage`, stay the
  one table that words a code. It is typed by the contract's `ErrorCode`, so a code with no words is a type error.
- **Toasts.** `toastSuccess(title, description)` and `toastFailure(title, error)`, in `common/components`, are called
  from the mutation's own `onSuccess` and `onError`, with words from the module's messages. No global toast on every
  failure: some failures show inline, as the config editor's refusal.
- **Regions, amended by #203 on the maintainer's decision of 2026-11-27.** A card or a widget fails alone, and the
  rest of the page stands. The component that renders the card reads with `useQuery`, and
  `<QueryRegion query failure fallback>{data => ...}</QueryRegion>` shows the result, in TanStack's order: the data
  once there is some, even when a later read failed; else the read's failure, with a Retry that reads again,
  `refetch({ cancelRefetch: false })`, joining a read in flight; else the fallback. What the data renders sits in
  TanStack Router's `CatchBoundary`, below the observer, reset when the query's `dataUpdatedAt` changes: a card that
  threw on one answer renders the next. The failure is told `cause`, `read` or `render`, as a widget says either that
  its service did not answer or that its card could not show the answer. A card that reads nothing, as the clock,
  sits in `<RenderRegion failure resetKey>`, the boundary alone. No `Suspense` and no `QueryErrorResetBoundary`. It
  needs no class component of ours, and it replaces #178's `WidgetBoundary` class and ends #150's family. A page's
  own failure is its route's `errorComponent` (#186).
  - **Why not suspense.** The record first chose `Region`, `Suspense` with `CatchBoundary` and
    `QueryErrorResetBoundary`, and `useSuspenseQuery` inside. Two reviews of #203 found the same family of bugs: a
    failed region does not come back as a query does. A reader that throws to a boundary is unmounted by it, and its
    observer with it. With no observer, query-core takes the query as inactive: an invalidation or a focus reads
    nothing, and when the last observer goes during a read that took the signal, the read is cancelled. Each patch
    (an observer kept by the failure view, found by its error; a reset of the boundary as it mounts; a subscription
    to the focus) re-created what the boundary had just destroyed, and two cases stayed open: a parent that renders
    during the read left the region failed after a 200, and the Retry and the focus sent a cancelled read then a
    second one. `useQuery({ throwOnError })` puts the reader below the boundary too. With the observer above it, in a
    component that no failure unmounts, invalidation, focus, remount and polling are query-core's own, as on main, and
    the region holds no state. The study is `hangar-region-design.md`, outside the repository. Its eleven cases are in
    `region.test.tsx`, with a `queryFn` that takes the signal; run on the suspense `Region`, six of them fail.
  - Behaviour change, accepted: a failed refetch keeps the stale data, where `/apps` shows the error alone today.
  - `useSuspenseQuery` stays for a page's critical data, awaited by its loader and failed by its route's
    `errorComponent`. None has any today.
- **401.** The `QueryCache` and `MutationCache` `onError` call `session.signedOut(router)`. The route's `beforeLoad`
  calls `context.session.require()`, which redirects. The behaviour is the same as today. The instance comes from
  decision 7.

## Decision 5: where the English words live

Each module gets a `messages.ts`: a plain `as const` object of strings and of functions of one params object, English
only. There is no `t()`, no locale and no hook. Enum labels are typed by the contract
(`status: {...} satisfies Record<ProjectStatus, string>`), so a new status is a type error. The per-code tables stay
where they are (`error-message.ts` by `ErrorCode`, `notification-text.ts` by key). Prose with markup, such as a card
description with `<code>`, may stay in its JSX until translation comes.

When translation comes, with Paraglide, `messages.ts` becomes `messages/en.json` and `appsMessages.list.title`
becomes `m.apps_list_title()`. That is mechanical, one module at a time, and the code-keyed tables keep their shape with `m.*`
inside. Without catalogs, the same work means finding every literal in every component.

This partly reverses the 2026-11-24 line "its text is written in English in its components". The cost, measured:
`apps/messages.ts` is 67 lines and `settings/messages.ts` 54 in the scratch worktree; as #204 wrote them, with the words
of their pages, their logs and their four cards, 166 and 112.

**Amended by #204, on the maintainer's decision of 2026-11-27.** The words that sit in no module go to a module's
`messages.ts` too, as no other file is added for them:

- **The shell's**, those of `routes/_app/-shell/`, `-not-found-page.tsx` and `-pending-page.tsx`, are in
  `common/messages.ts`, under `shell`: the Waku version's shell lived in `common`.
- **A page's**, those a route file writes, are in the `messages.ts` of its section's module: `/apps` and
  `/apps/:project` in `apps`, `/login` in `auth`, the dashboard in `widgets`, `/store` and its pages in `store`,
  `/settings` in `settings`.

## Decision 6: files

Amended by #207 on 2026-11-26: TanStack Router's layout, and modules kept apart, as decision 1 now says.

Amended by #210 on 2026-11-27, on the maintainer's decision: the routes are in one folder per section under `_app/`,
with no `_` escape, and the layout moves into its folder as `_app/route.tsx`. #186 had chosen TanStack's flat naming
(`apps_.$project.tsx`, `store_.$id.edit.tsx`) without that decision. Paths, search params and behaviour did not
change.

```
routes/
  __root.tsx
  login.tsx                         /login, no shell and no guard
  _app/
    route.tsx                       the layout: the session guard and the shell
    -shell/                         the shell's pieces
    index.tsx  index.test.tsx       /
    apps/
      index.tsx  index.test.tsx     /apps
      $project.tsx                  /apps/:project
    store/
      index.tsx  index.test.tsx     /store
      new.tsx                       /store/new
      $id.edit.tsx  $id.edit.test.tsx   /store/:id/edit
    settings/
      index.tsx  index.test.tsx     /settings
    cluster/
      index.tsx                     /cluster
    $.tsx                           not-found, in the frame
    -not-found-page.tsx  -pending-page.tsx
```

- **One folder per section, always**, even for a section with one page: `apps/`, `store/`, `settings/`, `cluster/`.
  A section's list is its `index.tsx`, its other pages sit beside it.
- **No layout route inside a section.** There is no `apps/route.tsx`, so `apps/index.tsx` and `apps/$project.tsx` are
  sibling pages under `_app`, and no file name needs a `_` escape (`apps_.$project.tsx`).
- **`store/$id.edit.tsx` keeps its dot**, for `/store/:id/edit`: there is no `/store/:id` page, so no `$id/` folder.
- **The layout sits in its folder**: `_app/route.tsx`, with what it uses beside it in `_app/` (`-shell/`, the
  not-found and pending pages). Nothing of `_app` stays at the routes' root.
- **A page's tests sit beside it** (`apps/index.test.tsx`), which `routeFileIgnorePattern` keeps out of the routes. A
  page's own pieces go in `-<page>/` beside it: a name that starts with `-` is no route.
- **An index page's route id ends with `/`**: `useSearch({ from: "/_app/apps/" })`, and `useNavigate({ from: "/apps/" })`
  takes its full path. Links still go `to="/apps"`, and the URL has no trailing slash.

- **By domain, and the pages by route.** The modules stay by domain, and import only `common` and `libs`. A page is
  its route file in `routes/`, the one place that composes modules: its component, its `validateSearch` from its
  module's `helpers/`, its loader, which calls `context.queryClient.ensureQueryData(appsQueries.projects())`. Its
  tests sit beside it (`routes/_app/apps/index.test.tsx`), which the route generator ignores
  (`routeFileIgnorePattern`), and `autoCodeSplitting` still loads its component with the page. What only a page uses
  and composes from several modules goes in `-<page>/` beside it, which the generator ignores as it does any name
  starting with `-`.
- **The shell** is `_app/route.tsx`, the layout route around every page but `/login`, with its pieces in
  `routes/_app/-shell/`: `app-layout`, `navbar`, `navbar-mobile`, `searchbar`, `user-menu`, `user-avatar`,
  `app-error-page`, the `navigations` they list and `use-current-path`, which only the shell uses.
  The not-found and pending pages sit beside the routes that show them, as `routes/_app/-not-found-page.tsx`.
- **The wiring** is at `src/`, with no `app/` folder: `main.tsx`, `page.ts` (`createPage`), `router.ts`
  (`createPageRouter`), `app-providers.tsx` and `theme-effects.tsx`, `routeTree.gen.ts`, and `mock/page.tsx`, the
  tests' page.
- **In a module:** `api/`, `hooks/`, `components/`, `helpers/` for the domain `.ts`, and `messages.ts`, the one file
  at its root, beside its test: lint refuses any other file directly under a module, and any file directly under
  `modules/`. Tests sit next to their code
  (`helpers/apps-view.test.ts`, `helpers/store-sync.test.ts`).
- **`libs/` against `modules/`.** `libs/` holds what has no React and no page domain: the API transport, formats,
  preferences. `modules/common/` holds what two modules or more share: `ui/`, and the generic hooks and components
  (`use-event-feed`, `use-event-stream`, `Region`, `components/toast.ts`, which was `action-toast` until #195).
- **Naming.** A file is named after its main export (`apps-view.ts` exports `appsView`). A function's name carries
  its context, as #195 says (`describeSync`, `parseSettingsTab`, `availableMemory`). The query and mutation option
  objects (`appsQueries`, `settingsMutations`) are the one object of functions allowed: it is TanStack's documented
  factory idiom, read as one, and loaders share it.

## Decision 7: classes, by the rule already decided

The lint selector `ClassDeclaration[superClass=null] > ClassBody:not(:has(> [static=false]))` finds them. It ignores
`ApiError extends Error` and `FakeEventSource`, which have instances.

**Become module functions and consts** (no state):

| Module          | Classes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps (done)     | `ComposeActions`, `ComposeOutput`, `MetricFormat`, `ProjectStatusView` (labels to messages), `CategoryBadge`, `MemoryLimit`, `AppsSearchParams`, `ProjectFilter`, `DockerQueries` (to `api/`), `LogLines`, `ComposeStreamText`, `LogStatusView`, `OperationIcons`, `ContainerPorts`, `ComposeOutputView`                                                                                                                                                                                                                                |
| settings (done) | `SettingsTab`, `StoreSyncText`, `EnvChangeSet`, `Secrets`; `JobText` (since #176)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| common (done)   | `ErrorMessage`, `ActionToast`, `TableSort`, `NameSearch`, `ToggledSet`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| libs/api (done) | `ServerEvents`, `QueryClients` (to `createQueryClient`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| left            | `Navigations`, `PreferenceCookie`, `SearchDebounce`, `ThemeColor`, `RelativeTime`, `Theme`, `UserPreferencesCookies`, `SignInMessages`, `NotificationText`, `NotificationFeed`, `NotificationToasts`, `FileTree`, `ComposeFile`, `StoreSearchParams`, `EditPageQuery`, `TreeLayout`, `ButtonFaces`; #178's `Severity`, `HealthDot`, `Usage`, `ClockFormat`, `CameraName`, `StockFormat`, `CardFormat`, `PriceCurve`, `CardPage`, `Thumbnail`, `DashboardColumns`, `Sparkline`, `WidgetIcon`, `WidgetAppearance`, `Units`, `WidgetImage` |
| routes          | `Routes` goes with #186; in the scratch rewrite, module consts and `createPageRouter`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Become instances** (state or dependencies):

- `SessionGuard` becomes `Session`, in `modules/auth/api/session.ts`, with `constructor(queryClient)`, `require()` and
  `signedOut(router)`. The root `.ts` rule moved it into `api/` on its own: it imports `@tanstack/*`.
- The `QueryClient`, the `Session` and the router are created once in `page.ts`, which `main.tsx` and the tests'
  `renderAt` both call. The router's context carries `{ queryClient, session }` to the routes:

  ```ts
  export function createPage(history?: RouterHistory) {
    const queryClient = createQueryClient(() => session.signedOut(router));
    const session = new Session(queryClient);
    const router = createPageRouter({ queryClient, session }, history);

    return { queryClient, router };
  }
  ```

- `NotificationCache.change(queryClient, ...)` is used by one hook only, which has the client. It becomes a closure
  of that hook, not a class. The corollary to write in AGENTS.md: a helper that one hook uses, and that needs what the
  hook has, is a closure of the hook.
  - _Amended by #195 on 2026-11-26:_ unless several of the hook's effects call it. It is then a module function
    beside the hook, taking what it needs, as `changeNotifications(queryClient, change)`: as a closure it would be a
    dependency of each effect, which `exhaustive-deps` asks to wrap in a `useCallback`, and the coding rules leave
    memoization to the React compiler.
- The jotai store stays created in `AppProviders`, as it is. Rule 16 of the addendum removes it.

## Decision 8: the references, and what is taken

| Reference                                                                                                                                                                                                             | Taken                                                                            | Differs                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| TanStack Query, `queryOptions` and key factories (TkDodo, ["The Query Options API"](https://tkdodo.eu/blog/the-query-options-api), ["Effective React Query Keys"](https://tkdodo.eu/blog/effective-react-query-keys)) | one options object per read, shared by `useQuery` and loaders, hierarchical keys | the keys come from orval, split by path                          |
| TkDodo, ["Automatic Query Invalidation after Mutations"](https://tkdodo.eu/blog/automatic-query-invalidation-after-mutations)                                                                                         | `meta.invalidates` run by `MutationCache.onSuccess`, awaited                     | none                                                             |
| TkDodo, ["Using WebSockets with React Query"](https://tkdodo.eu/blog/using-web-sockets-with-react-query)                                                                                                              | events invalidate, or `setQueryData`; catch up on open                           | SSE, with backoff and visibility in one hook                     |
| TanStack Query error handling, [`QueryErrorResetBoundary`](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)                                                                                    | regions with retry; global `onError` for the 401                                 | no global toast                                                  |
| TanStack Router: [router context](https://tanstack.com/router/latest/docs/framework/react/guide/router-context), `beforeLoad`, loaders with `ensureQueryData`, `errorComponent`, `CatchBoundary`, file routes         | the context carries instances; loaders warm the regions                          | modules stay outside `routes/` (#186)                            |
| [bulletproof-react](https://github.com/alan2207/bulletproof-react)                                                                                                                                                    | `api/` per domain, one-way imports by lint, no barrels                           | imports between modules are allowed; `modules/`, not `features/` |
| [Feature-Sliced Design](https://feature-sliced.design/)                                                                                                                                                               | the idea of layers with lint                                                     | too many layers for this size                                    |
| [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs)                                                                                                                                              | messages as functions of one object, ready for `m.key(params)`                   | not installed until translation comes                            |
| The Waku version itself                                                                                                                                                                                               | its layout, its catalogs, its single stream hook                                 | `api/` for `actions/`, the cache for `reload()`                  |

## Decision 9: before and after, on apps and settings

Rewritten for real in the scratch worktree: `apps` (the page and its helpers, its hooks, `api/queries.ts`,
`messages.ts`, `apps-view.ts`), `settings` (`api/queries.ts`, `hooks/use-store-sync.ts`, `messages.ts`, the three
cards, `settings-tabs.ts`, `store-sync.ts`, `env-changes.ts`), plus the common helpers, `libs/api`, `Session`,
`createPage` and `Region`.

Results:

- `tsc --noEmit` is clean.
- `vitest`: 30 files and 140 tests pass. That is the same 136 tests, untouched apart from their imports, plus
  `apps-view.test.ts` (2) and `region.test.tsx` (2). The `apps-page` and `settings-page` route tests (567 + 148 lines)
  pass with no change to what they assert.
- `eslint` passes with the new rules on `apps`, `settings`, `auth/api`, `common/hooks`, `libs/api` and `app`.
- `prettier --check` passes, and `vite build` is fine.
- On all of `web/src`, the rules flag 34 places left, all in the modules not rewritten: 18 static-only classes and 16
  imports of orval hooks.
- Before the rewrite, the same rules flag 46 static-only classes, 26 orval hook imports and 5 root `.ts` files at
  fault.

**The page: inputs, one view model, layout.**

```tsx
// before: apps-page.tsx
const { data, error, isPending, refetch, isRefetching } = useDockerProjects();
const projects = data ?? [];
const sort = AppsSearchParams.sort(search.sort);
const visible = ProjectFilter.apply(projects, {
  q: search.q ?? "",
  statuses: AppsSearchParams.statuses(search.status),
  categories: AppsSearchParams.categories(search.category),
  sort,
});
// ... AppsTotals: const sum = (count) => projects.reduce(...)
const selected = visible.map(project => project.name).filter(name => selection.has(name));
const selectionLabel = selected.length === 0 ? "No selection" : `${ComposeActions.count(selected.length)} selected`;

// after
const { data, error, isPending, refetch, isRefetching } = useQuery(appsQueries.projects());
const { isReconnecting } = useDockerChanges();
const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
const projects = data ?? [];
const view = appsView(projects, search, selection); // { sort, visible, selected, totals, containerIds }, pure, tested
const compose = useComposeCommand(view.selected);
const words = appsMessages.list;
// ... {view.selected.length === 0 ? words.noSelection : words.selected({ count: view.selected.length })}
```

**The data layer, said once.**

```ts
// apps/api/queries.ts
export const appsQueries = {
  projects: () => getDockerProjectsQueryOptions(),
  project: (project: string) => getDockerProjectQueryOptions(project),
  overview: () => getDockerOverviewQueryOptions(),
  batches: () => getComposeBatchesQueryOptions(),
};
export const dockerQueries: QueryKey = ["api", "docker"];
export const staleAfterDockerChange: Readonly<Record<DockerChange, readonly QueryKey[]>> = {
  containers: [getDockerProjectsQueryKey(), getComposeBatchesQueryKey()],
  overview: [getDockerOverviewQueryKey()],
};

// settings/api/queries.ts
const editedFile = { staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false } as const;
export const settingsQueries = {
  store: () =>
    getStoreStatusQueryOptions({
      query: { refetchInterval: q => (isSyncRunning(q.state.data?.sync) ? syncPollMs : false) },
    }),
  env: () => getEnvReadQueryOptions({ query: editedFile }),
  config: () => getConfigReadQueryOptions({ query: editedFile }),
};
export const settingsMutations = {
  saveConfig: () =>
    getConfigSaveMutationOptions({
      mutation: { meta: { invalidates: [getConfigReadQueryKey(), getStoreAppsQueryKey()] } },
    }),
  // ...
};
```

**A feed in a few lines.**

```ts
// before: use-docker-changes.ts, 68 lines: an effect, a stop variable, open/close/sync on visibilitychange,
// a startsWith predicate over URL keys, a reconnecting state.
// after: 24 lines
export function useDockerChanges() {
  const queryClient = useQueryClient();
  const invalidate = (queryKey: QueryKey) => void queryClient.invalidateQueries({ queryKey });
  const { isDown } = useEventFeed<DockerChange>(getDockerChangesUrl(), {
    onOpen: () => invalidate(dockerQueries),
    onItem: change => staleAfterDockerChange[change].forEach(invalidate),
  });

  return { isReconnecting: isDown };
}

// before: use-compose-stream.ts, 135 lines: frames, folding, status, cut short, stopRef.
// after: the fold and the end are data
const stream = useEventStream<ComposeEvent, ComposeOutputState>(() => emptyComposeOutput([]), {
  fold: applyComposeEvents,
  isEnd: event => event.kind === "end",
  requiresEnd: true,
  onOpen: readBatchesAgain,
  onEnd: readBatchesAgain,
});
```

**A mutation's staleness in its options, and its words in the catalog.**

```tsx
// before: config-settings-card.tsx
const save = useConfigSave({
  mutation: {
    onSuccess: async () => {
      setRefusal(null);
      ActionToast.success("Configuration saved", "The configuration was saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getConfigReadQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getStoreAppsQueryKey() }),
      ]);
    },
    onError: failure => {
      setRefusal(ErrorMessage.describe(failure));
      ActionToast.failure("Configuration rejected", failure);
    },
  },
});

// after
const save = useMutation({
  ...settingsMutations.saveConfig(),
  onSuccess: () => {
    setRefusal(null);
    toastSuccess(words.saved, words.savedDescription);
  },
  onError: failure => {
    setRefusal(describeError(failure));
    toastFailure(words.rejected, failure);
  },
});
```

**The store card loses its data logic** to `hooks/use-store-sync.ts`: the query, the mutation, the toast, and the
read again once the sync ended. The card is layout, from 99 lines down to 57. The `wasRunning` ref is still a flag.
The generic end of it is decision 2's event map, once the server pushes the end of a sync on a feed, as it does on
`/api/docker/changes` already.

**What breaks, and what a test must now write.** Nothing a user sees changes. Tests build the page through
`createPage(createMemoryHistory(...))`. `Session` is tested through its constructor, as #195 asks, with no module
mock. Imports change everywhere a static class was used: 26 files for the common helpers alone, done by a script.

## Decision 10: the migration

**Lint, all in core ESLint, no plugin.** typescript-eslint refuses TypeScript 7: it prints "typescript-eslint does
not support TS 7.0." when loaded, so `@typescript-eslint/no-extraneous-class`, which #195 suggests, cannot run. The
same goes for `eslint-plugin-boundaries` and `import/no-restricted-paths`: every import is a `#modules/...`
specifier, which core `no-restricted-imports` reads as a regex, with `importNamePattern` and `allowTypeImports`
(checked on probes). The rules:

1. `no-restricted-syntax` with the selector of decision 7, on `web/src`. It flags 46 classes before the change.
2. `no-restricted-imports`, on `modules/`, `routes/` and the wiring at `src/` (`app/` until #207): no `use*` from
   `#libs/api`, and no `../` import, so that the regexes see every import. The pages in `routes/` import orval's hooks
   until the data layer, as `useDockerProjects` in `routes/_app/apps.tsx`. #207 already refuses a `..` segment in
   `modules/`. Flat config does not merge a rule's options across blocks, so each block repeats the
   shared pattern.
3. On `modules/*/api/`: no React, no `hooks/` or `components/`.
4. On `modules/*/helpers/` and `modules/*/messages.ts` (tests excepted): no React, no `@tanstack/`, no
   `use|get|prefetch|create*` from `#libs/api`, and only types from `api/`, `hooks/`, `components/` or `ui/`. Amended
   by #207 on 2026-11-26: it was on `modules/*/*.ts`, a module's root, where lint now refuses any file but
   `messages.ts` and its test, as it refuses any file directly under `modules/`. #207 adds the isolation of decision
   1: on `modules/<a>/`, no `#...` import but `#libs/`, `#modules/common/` and `#modules/<a>/` (`#mock/` too in a
   test), and no `..` segment anywhere in a specifier, in an `import` or an `import()` of a string or a template with
   no expression.

One trap: `.gitignore`-style patterns in `no-restricted-imports` treat a leading `#` as a comment, so `#modules/...`
must be written with `regex`, not `group`.

**Order, in four PRs:**

1. **#195**, as written, plus `createPage` and `Session`, and the lint rules 1 and 4. One commit per module. It
   includes #178's classes if #178 merges first, and it should: converting after costs less than reworking an open
   branch. [AGENTS.md's "Classes" section](../../AGENTS.md#classes) is rewritten there, with the closure corollary of decision 7.
2. **#186**, file routes, on `createPage`. The route files hold `validateSearch` from the module's `helpers/`, and
   loaders once PR 3 gives the options. If PR 3 is not merged yet, the loaders come with it. Amended by #203 on
   2026-11-27: the loaders warm with `prefetchQuery` and wait for nothing, as [rule 15](#rule-15-route-preloading)
   says.
3. **A new issue, "web: a data layer and one stream model".** `api/` per module, `shouldSplitQueryKey`,
   `meta.invalidates`, `useEventFeed` and `useEventStream` with notifications ported, `Region` on the settings cards
   and the dashboard (closing #150 and replacing `WidgetBoundary`), and rules 2 and 3.
4. **A new issue, "web: the words in a `messages.ts` per module"**, for decision 5. It can go module by module,
   alongside the rest.

**The milestone's remaining issues:** each is written in the new form once PR 3 is merged.

- #177 (backups) is a card on an app's page with its mutations and their `invalidates`.
- #179 (swarm) is a cluster page whose stack deploy output is `useEventStream`.
- #180 (spotlight) keeps its sources in each module's `helpers/`, as pure functions over the queries' data.
- #181 (the switch) removes `src/` and the Waku TypeScript sections of AGENTS.md, which this ADR then replaces.
- #182 (terminals, WebSocket) is outside the `Events` model and keeps its own hook.

## Recommendation

**Take option A: the Waku layout, adapted, in the four PRs above.** The baseline was right on everything that does
not depend on RSC. What `web/` lacks is what RSC used to provide: a place for the cache's keys, policies and
staleness, which is `api/`, and a model for the feeds that replaced `router.reload()`, which is the two hooks.
Both were checked on the two largest modules: the existing route tests pass unchanged, the stream code shrinks by
more than half per hook, and lint holds the layers in core ESLint on TypeScript 7.

## Decisions

Accepted by the maintainer on 2026-11-26, as recommended:

- Option A, the Waku layout adapted, as the page's design
- `api/` per module with query and mutation options; orval's `use*` hooks banned outside `#libs/api`
- orval's `shouldSplitQueryKey: true`, keys by path segment
- `meta.invalidates` on mutations, run by the query client
- `useEventFeed` and `useEventStream` as the only ways to read `Events` on the page
- `Region` (Suspense, CatchBoundary, QueryErrorResetBoundary) per card and widget, with `useSuspenseQuery`, and stale data kept on a failed refetch (amended by #203 on the maintainer's decision of 2026-11-27: `QueryRegion` over the caller's `useQuery`, and `RenderRegion`, with no `Suspense`)
- `messages.ts` per module, English only, partly reversing 2026-11-24 (amended by #204 on the maintainer's decision of 2026-11-27: the shell's words in `common`, a page's in its section's module)
- `createPage` in `page.ts` (`app/page.ts` until #207) as the one place the `QueryClient`, the `Session` and the router are created
- The closure corollary: a helper of one hook that needs the hook's values is a closure, not a class (amended by #195
  on 2026-11-26: a module function beside the hook when several of its effects call it)
- The lint rules in core ESLint, not typescript-eslint or a boundaries plugin, while on TypeScript 7
- The order: #195, then #186, then the data layer, then the catalogs; #178 merged before #195

## Not checked

- Route loaders with `ensureQueryData`, and `useSuspenseQuery` inside the settings cards: their
  `refetchOnMount: "always"` and the `key={dataUpdatedAt}` form may need `gcTime` care under suspense. Only `Region`
  itself was tested. Checked by #203, and left: see the amendments of decision 4 and rule 15.
- Porting `use-notifications` to `useEventFeed`. Done by #203: see decision 3.
- Paraglide's actual import of a `messages.ts`: the shape matches its message functions, but it was not run.
- The bundle size against #186's budget: `vite build` passes, and the size was not compared.

## Addendum: forms, optimistic updates and tests against the API

- **Status:** Accepted on 2026-11-26, with the [decisions](#decisions-of-the-addendum) below
- **Date:** 2026-11-26
- **Deciders:** Thomas
- **Builds on:** decisions 1 to 10 above. They are constraints here and are not reopened: `api/` per module with options on orval's, `meta.invalidates`, `useEventFeed` and
  `useEventStream`, `Region`, `createPage`, `messages.ts` per module, the core-ESLint layer rules, and #195's rule on
  classes. This addendum continues the numbering with decisions 11 to 13 and rules 14 to 16.
- **Study:** read-only, on `origin/main` at `33a1bc7` (#176 jobs and #178 widgets merged), in a detached worktree. The
  draft's patch does not apply there (its apps, settings and common files conflict), so the code below is written in
  the draft's shape (`api/` options, functions rather than static classes) on main's code, and touches only what
  each point needs. Its code keeps main's names where decision 7 renames them (`ActionToast`, `ErrorMessage`,
  `NotificationFeed`). Its diff (21 files, `git apply` on `33a1bc7`) is kept outside the repository and is not
  committed. The OpenAPI document came from `cargo run -p hangar-api --bin openapi`, then orval 8.49.

**Results on the worktree:**

- `tsc --noEmit` is clean.
- `vitest`: 35 files and 188 tests pass. That is the 183 of main, all unchanged in what they assert, plus 5 new ones.
  The 2 new env tests fail on main's card. The 2 new notification tests pin the optimistic marks, which main already
  had by hand. The last one is a bell test through MSW's `sse()`.
- `eslint` and `prettier --check` pass on `web/src`, and `vite build` too. MSW and faker are not in `dist/`.
- The React compiler compiles both versions of the env form: `CompileSuccess` for `EnvForm`, from the compiler's own
  logger.

### Decision 11: forms

#### The case

Each form is written by hand with `useState`, and shows a refusal its own way:

| Form                    | State                                  | Where a refusal shows                             |
| ----------------------- | -------------------------------------- | ------------------------------------------------- |
| Settings, environment   | 4 `useState`, a staged `removed` list  | a toast only; nothing on the variable at fault    |
| Settings, configuration | `useYamlEditor`'s `refusal`            | under the editor, and a toast                     |
| Store, new app          | `useState` for the id, `useYamlEditor` | under the editor, and a toast, even an id refused |
| Store, app editor       | 6 `useState`, an error map by path     | under the editor of the file, and a toast         |
| Login                   | `FormData` on submit                   | an `Alert`, from `SignInMessages`                 |

The server's side is already uniform. Every refusal is one RFC 9457 problem with a stable code and its params
(decision 4). Several codes name the field at fault:

- `env.invalid_name`, `env.line_break` and `env.unwritable_value` name a variable with `{ name }`;
- `editor.invalid_app_id` and `editor.app_exists` name the id with `{ app }`;
- the `editor.*` codes name a file with `{ path }`.

`config.invalid { field, reason }` names a path inside `hangar.yml`, not a field of the form, so it belongs under the
editor. No problem carries a list of errors today.

#### What a schema would bring

- **orval's zod gives the wire, not the form.** `client: "zod"` writes `EnvSaveBody` as
  `zod.object({ remove: zod.array(zod.string()), updates: zod.record(zod.string(), zod.string()) })`. That is what the
  TypeScript types already say. The form edits rows (`{ key, value }[]` and a new name), not `EnvChanges`.
- **The rules are not in the document.** The variable name rule (`is_variable_name` in the core) and the app id rule
  are only in descriptions. In an experiment, with a `pattern` added to the document, orval wrote
  `zod.string().regex(editorCreateAppBodyIdRegExp)` and exported the `RegExp`. It ignored `propertyNames` (the env
  names).
- **The cost**, each library bundled alone by Vite 8 with React left out, minified, then gzip -9:

  | Library              | gzip    |
  | -------------------- | ------- |
  | zod 4                | 25.0 kB |
  | zod/mini             | 5.2 kB  |
  | valibot 1.5          | 1.5 kB  |
  | @tanstack/react-form | 19.8 kB |
  | react-hook-form      | 15.5 kB |

The forms have two client rules in all: the variable name and the app id. A schema library is not worth it yet.

#### One mechanism for the server's refusals, whatever the library

`modules/common/helpers/form-errors.ts` (`helpers/`: no React) places a problem in a form. A form gives, by code, the
field the code's params name. The words stay `ErrorMessage.describe`'s (decision 4):

```ts
export type FieldsByCode<Field extends string> = {
  readonly [Code in ErrorCode]?: (params: ParamsOf<Code>) => Field | undefined;
};

/** Under the field `fieldsByCode` gives for its code, else for the whole form. */
export function formErrorsOf<Field extends string>(
  error: unknown,
  fieldsByCode: FieldsByCode<Field>,
): FormErrors<Field>;

// env-settings-card.tsx: a code with no params, or a typo in one, is a type error
const fieldsByCode = (variables: readonly EnvVariable[]): FieldsByCode<ValueField> => ({
  "env.invalid_name": ({ name }) => valueOf(name),
  "env.line_break": ({ name }) => valueOf(name),
  "env.unwritable_value": ({ name }) => valueOf(name),
});
```

If the contract one day sends several errors in one problem, as RFC 9457's `errors` extension with JSON pointers,
only `formErrorsOf` reads them. The forms do not change.

#### The options, each run on the env card

**A. TanStack Form 1.33.** `useForm({ defaultValues, onSubmit })`, `form.Field` with render props, arrays with
`mode="array"` and `removeValue`. A refusal goes in with `formApi.setErrorMap({ onSubmit: formErrorsOf(...) })`,
which spreads `{ form, fields }` over the fields. That is the shape `formErrorsOf` returns.

**B. react-hook-form 7.92.** `register`, `useFieldArray`, `useWatch`. A refusal goes in with `setError(field, ...)` and
`setError("root.server", ...)`.

**C. No library.** `useState` per form, as today, with `formErrorsOf` for the refusals. Not written: each form keeps
its own submit, pending, dirty and error bookkeeping. That is the drift being fixed.

| Point                           | A. TanStack Form                                        | B. react-hook-form                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle, in the app              | +15.5 kB gzip on the entry chunk (275.8 → 291.3 kB)     | +17.4 kB gzip (→ 293.2 kB)                                                                                                                                                             |
| React compiler                  | compiled; no API to avoid                               | compiled with `useWatch`; `watch()` is on the compiler's list of incompatible APIs, and the component that calls it is skipped (checked: `CompileError … Use of incompatible library`) |
| A refusal on a field            | `setErrorMap({ onSubmit: { form, fields } })`, one call | one `setError` per field, plus `root.server`                                                                                                                                           |
| Cleared when the field changes  | yes (tested)                                            | yes, by its re-validation on change after a submit (tested)                                                                                                                            |
| Controlled widgets (CodeMirror) | `field.handleChange`                                    | needs `Controller`                                                                                                                                                                     |
| Schemas                         | Standard Schema validators                              | `@hookform/resolvers` (`standard-schema`)                                                                                                                                              |
| Trap met                        | `validateField` returns an array or a promise           | `await trigger()` resolves after a Save clicked right after Add: the new variable was not sent. Fixed by checking at once                                                              |
| Same idioms as Query and Router | yes: options objects, typed deep keys                   | no                                                                                                                                                                                     |
| Env card                        | 261 lines (193 before)                                  | 245 lines                                                                                                                                                                              |

Both versions pass the same 13 settings tests: the 11 of main, unchanged, and 2 new ones. The 2 new ones fail on
main's card:

- "shows a refusal of the server under the variable it names, until that value changes": `env.line_break` on `KEPT`
  lands in the `aria-describedby` of `KEPT`'s input, once, and goes when the value changes;
- "refuses a new name compose does not take, before any save": `1BAD` is refused under the new name, and no `PUT` is
  sent.

#### Before and after (A)

```tsx
// before: four pieces of state, and a refusal said in a toast only
const [values, setValues] = useState(variables);
const [removed, setRemoved] = useState<string[]>([]);
const [newKey, setNewKey] = useState("");
const save = useEnvSave({ mutation: {
  onSuccess: written => { queryClient.setQueryData(getEnvReadQueryKey(), written); ActionToast.success(...) },
  onError: failure => ActionToast.failure("Save failed", failure),
} });
// <Button onClick={() => save.mutate({ data: EnvChangeSet.create(variables, values, removed) })}>

// after: the values in the form, a refusal under the field it names
const save = useMutation(settingsMutations.saveEnv()); // its setQueryData lives in api/
const form = useForm({
  defaultValues: envFormValues(read), // { variables: { key, value }[], newKey: "" }
  onSubmit: async ({ value, formApi }) => {
    try {
      await save.mutateAsync({ data: envChanges(read, value.variables) });
      ActionToast.success("Environment saved", "The global environment was saved.");
    } catch (failure) {
      formApi.setErrorMap({ onSubmit: formErrorsOf(failure, fieldsByCode(value.variables)) });
    }
  },
});
// <form.Field name={`variables[${index}].value`}>{field => <Input aria-invalid … /><FieldError … />}</form.Field>
// <form.Field name="newKey" validators={{ onSubmit: ({ value, fieldApi }) => newVariableError(value, …) }}>
```

`removed` is no longer state: it is the read's variables that the rows no longer hold (`envChanges`, in
`env-variables.ts`, beside `newVariableError` and `withVariable`, all pure).

#### Implications

- **What users see changes.** A refusal shows where it is fixed, not in a toast. A new variable name is checked before
  it is added. The inputs carry `aria-invalid` and `aria-describedby`.
- **Configuration keeps a toast and an inline refusal.** Its test asserts both, and it was not changed. The rule
  "a form's refusal shows in the form, with no toast; an action's in a toast" would change that test from 2 matches
  to 1. That is decision 11c below.
- **Fields are named by index, not by key.** `values.${key}` would read a variable named `A.B` as a nested path. The
  form holds `{ key, value }[]` instead. A server code is placed by looking its `name` up among the rows.
- **Forms get longer, not shorter.** What the lines buy is field-level refusals and client checks, which the hand
  versions did not have.
- **Still to port.** The new app's id takes `editor.invalid_app_id` and `editor.app_exists`. The login form takes
  `auth.*` as a form error. The app editor is a set of drafts, not a form, and keeps its error map by path, which
  `formErrorsOf` can fill.

### Decision 12: optimistic updates

#### The case

- The bell is already optimistic, by hand. `NotificationCache.change` cancels a read in flight, then writes the cache
  before the call is sent. A failure reads the list again.
- Everything else waits for the answer, then reads again: run again and cancel a job, install, uninstall, compose.
- The env save takes its answer into the cache. The config save waits for its reads.

The draft's `meta.invalidates` covers "read again on success". The Events feeds also write the cache. The question is
how an optimistic write, the server's answer and a feed event meet.

#### The family, and what each needs

| Change                              | Outcome known before the answer?             | Others write the same entry? | Kind                                       |
| ----------------------------------- | -------------------------------------------- | ---------------------------- | ------------------------------------------ |
| mark seen, mark every one read      | yes, and the answer carries nothing          | the notifications stream     | optimistic, in the cache                   |
| run a job again                     | no: a run already waiting is reused          | polling                      | wait; read again whatever the outcome      |
| cancel a run                        | no: `jobs.ended`                             | polling                      | wait; read again whatever the outcome      |
| install, uninstall, compose up/down | no: long, with side effects, may fail midway | `/api/docker/changes`        | wait, with a pending face ("Installing…")  |
| save env, config, a file, a new app | no: the server validates                     | none                         | never optimistic                           |
| delete a file (no route yet)        | no: paths may be refused                     | none                         | wait, the row pending in place             |
| theme, Up's options                 | local only, no server                        | none                         | not a mutation (`Preferences`, `useState`) |

#### Three ways, each run on the bell's tests (7: the 5 of main and 2 new)

**A. In the cache, with `onMutate`.** The options live in `notifications/api/notifications.ts`. In TanStack Query
5.108, `onMutate` gets `{ client }`, so the options need no component.

```ts
export const notificationsMutations = {
  readAll: () =>
    getNotificationsReadMutationOptions({
      mutation: {
        onMutate: (_variables, { client }) => changeNotifications(client, NotificationFeed.read),
        onError: readAgain, // not a snapshot put back: it would drop what the stream brought meanwhile
      },
      request: { keepalive: true },
    }),
  markSeen: () =>
    getNotificationsSeenMutationOptions({
      mutation: {
        onMutate: ({ data }, { client }) =>
          changeNotifications(client, recent => NotificationFeed.seen(recent, data.ids)),
        onError: readAgain,
      },
    }),
};
// the hook: const { mutate: markRead } = useMutation(notificationsMutations.readAll()); … markRead();
```

`changeNotifications(client, change)` is main's `NotificationCache.change` as a function: cancel the read in flight,
then `setQueryData`. The stream and the marks both write through it. `use-notifications.ts` goes from 134 to 117
lines. It loses the class, the `onError` it wrote twice, and the two cache writes before each `mutate`.
**7 of 7 pass.**

**B. The `variables` of the pending mutation.** No cache write; the hook shows `isPending ? 0 : unread`, and the
mutation has `meta.invalidates: [list]`. **3 of 7 fail:**

- a notification the stream files during the call is hidden: "Notifications, 1 unread" is not found;
- a failure reads nothing again;
- after success, the count depends on the read again.

**C. React 19's `useOptimistic`** over the cache's list, in a `startTransition` around `mutateAsync`. **4 of 7 fail.**
The optimistic view ends with the transition, and the cache still holds the list unread. The reducer "every one read"
is applied again to every new base, so a notification the stream files during the call shows as read. The test "shows
the list read as the bell closes, before the server answers" fails too. Its cause was not investigated.

#### Races, with the reason for each part of A

- **A read of the list in flight** would put back what the write took out: cancel it first. Main's test "keeps what
  the stream brought over a read of the list that was in flight" covers it.
- **A feed event during the call** must stay. The new test "keeps unread what the stream brings while the list is
  being marked read" holds the answer, files #3 on the stream, then answers: still "1 unread".
- **A failure** reads the list again rather than restoring a snapshot. A snapshot taken in `onMutate` would erase the
  events the feed brought meanwhile. Main's test "reads the list again when marking it read fails" covers it.
- **A success** reads nothing again when a feed keeps the entry. That read would race the feed for nothing.
- **Concurrent marks of the same kind** are idempotent here. The `isMutating` check before reading again, from
  TkDodo's ["Concurrent Optimistic Updates"](https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query), is not needed until a mutation is not idempotent.

#### How this fits `meta.invalidates`

- **It stays success-only, as drafted.** Checked by a run: with the client's `onSettled` instead of `onSuccess`, the
  refused config save reads `hangar.yml` again, `key={dataUpdatedAt}` remounts the editor, and 200 ms later the
  refusal under it is gone (the test fails). So "read again whatever the outcome" (install, run, cancel) stays in
  those mutations' own `onSettled`.
- **The config card is ported** to `useMutation({ ...settingsMutations.saveConfig(), onSuccess, onError })`, with
  `meta.invalidates`. Its test "takes no typing while a save runs" passes on it.
- **Optimistic mutations do not use `meta.invalidates`.**
- **One trap, from the docs, not run:** a component that spreads an option object and sets its own `onError` replaces
  the read-again. UI callbacks of an optimistic mutation go on `mutate(variables, { onSuccess, onError })`, which run
  after the options' callbacks instead of replacing them.

#### The rule

Be optimistic only when all three hold:

- the server cannot refuse the change for a reason the page cannot see;
- the answer carries nothing the page needs;
- the change is cheap to undo by reading again.

Today that is the bell's marks, and later toggles of the same kind (a dismiss, a pin). Write it in the cache, with
`onMutate` in the module's `api/`, through the same function the feeds use. Cancel the reads in flight first, read
again on failure, never put back a snapshot, and read nothing again on success when a feed keeps the entry. Anything
the server validates, anything with side effects that take time, and anything with an id the server assigns waits for
its answer. It shows its pending state in place (the button's face, the row dimmed), then reads again or takes the
answer into the cache. `useOptimistic` is not used: it covers one component for one transition, while the cache
covers every reader.

### Decision 13: tests against the API

#### The case

`mock/page.tsx`'s (`app/mock/page.tsx` until #207) `serve({ "PUT /api/env": body => ... })` stubs `fetch` with string
keys, answers 404 to anything it does not list, and stubs `EventSource` with `FakeEventSource`. It is shared, but it is
not typed. Run with a probe, `serve({ "GET /api/envs": () => Response.json({ variable: {} }) })` compiles. The silent
404 hid calls in every module ported here:

- every settings test also calls `GET /api/notifications`, the navbar's bell;
- `/apps` calls `GET /api/docker/compose` and `GET /api/docker/changes`;
- the config save reads `GET /api/store/apps` again.

While writing the port, a hand-written body for `/api/store/apps`, `{ apps, installed, notInstalled }`, was wrong: the
contract's is `{ apps, counts }`. This is the drift a hand fake allows.

#### The options

**A. orval's MSW handlers and msw at the network (recommended).** orval writes `generated.msw.ts`, one handler per
operation, from `mock: { generators: [{ type: "msw" }] }`. Each handler answers its 2xx body with its status from the
contract (202 for the sync, 204 for the config save), typed, or faked from the schema when given nothing. Tests call
`network.use(...)` on one `setupServer`.

**B. A typed hand fake per module**, `fakeSettingsApi({ env, onSave })` over `serve`, typed by orval's types. Bodies
are checked, but routes, statuses and methods are still written by hand per module. It is a second contract to keep
in step.

**C. As today.**

#### What A takes, all checked

- **msw is at 3.0.8, not v2.** `listen({ onUnhandledFrame: "error" })`: v2's `onUnhandledRequest` is a type error
  there. With `"error"`, a call no handler answers fails the test loudly: that is how the hidden calls above came out.
  The network's defaults are what the shell calls on every page: the session, the auth options, an empty bell, and its
  quiet stream.
- **orval 8.49's mocks do not typecheck under TS 7.** 21 errors of `TS2698: Spread types may only be created from
object types`, from a string enum spread. An orval `afterAllFilesWrite` hook prepends `// @ts-nocheck`. orval's
  `header` option cannot do it, as it writes a JSDoc block. The file is gitignored, and ignored by eslint and
  Prettier, like `generated.ts`.
- **An entry point, not the barrel.** `#libs/api/mock` re-exports the handlers, as AGENTS.md wants for test doubles.
  MSW and faker are dev dependencies and stay out of `dist/`.
- **One answer overridden.** `getEnvReadMockHandler({ variables: { KEPT: "1" } })`, or a function of the request.
- **A refusal.** The handlers answer only the 2xx body, so a test throws the problem, which msw sends:
  `getEnvSaveMockHandler(async ({ request }) => { saved.push(await request.json()); throw problem(400, "...") })`.
  `request.json()` is typed `EnvChanges`, and the path params are typed (`params.id` of `/api/jobs/:id/run`).
- **The requests sent.** Captured in the handler, or with `network.events.on("request:start")`. msw's request loses
  `keepalive`: the bell's test spies on `fetch` (`vi.spyOn(globalThis, "fetch")`, which calls through) to assert
  `keepalive: true`.
- **Events (SSE).**
  - orval's handlers for `text/event-stream` routes answer `faker.word.sample()` as text, which is useless. Tests use
    msw's `sse()` instead: `client.send({ data: event })` serializes the event, and `sse<{ message: NotificationEvent }>`
    types it.
  - `sse()` needs a global `EventSource`, and happy-dom has none (Node 22's is behind `--experimental-eventsource`).
    The `eventsource` 5 package, on `fetch`, is set once in the setup file with `globalThis.EventSource ??=`, not
    stubbed, so `vi.unstubAllGlobals()` gives it back.
  - Relative URLs resolve against happy-dom's location.
- **Coexistence.** The setup file and `serve`'s stubs work together: the 183 tests of main still pass with msw
  listening. Modules can move one at a time.
- **Staying aligned.** A route renamed in the contract fails `tsc` in the test: `TS2724: '"#libs/api/mock"' has no
exported member named 'getEnvsReadMockHandler'. Did you mean 'getEnvReadMockHandler'?`. A body that changed fails
  too: `TS2353: Object literal may only specify known properties, and 'variable' does not exist in type
'GlobalVariables | ...'`.

#### Before and after (the settings tests, 11 tests ported, 2 added)

```ts
// before
serve({
  "GET /api/env": () => Response.json({ variables: { KEPT: "1", SAME: "2", OLD: "3" } }),
  "PUT /api/env": body => {
    saved.push(body);
    return problem(400, "invalid variable name: 1BAD");
  },
});

// after: the contract's handlers, typed; anything else the page calls is an error
network.use(
  getEnvReadMockHandler({ variables: { KEPT: "1", SAME: "2", OLD: "3" } }),
  getEnvSaveMockHandler(async ({ request }) => {
    saved.push(await request.json()); // EnvChanges
    throw problem(400, "invalid variable name: 1BAD");
  }),
);

// a stream, in the bell's test
const handler = sse<{ message: NotificationEvent }>("*/api/notifications/events", ({ client, request }) => {
  urls.push(new URL(request.url).search); // "?since=2&epoch=first"
  send = event => client.send({ data: event });
});
```

#### Implications

- **The tests get longer**: the settings file is 319 lines with `serve`, and 354 with msw. The added lines are the
  imports and the handlers the page really calls.
- **What breaks:** tests that leaned on the 404 for a route they did not list. They now say which route.
- **Faker answers** are random. They are only for bodies a test never reads, such as `getStoreAppsMockHandler()`
  after a config save.
- **`FakeEventSource` stays** for the tests that drive a lost stream and its reconnection (`fail()`, `open()`), until
  msw's `client.error()` and `client.close()` are shown to replace it. Not checked.
- **Noise:** msw 3 prints `Error: socket hang up` (`ECONNRESET`, from its socket interceptor) when the page closes a
  mocked stream on unmount. The tests pass. The cause was not traced.

**Amended by #205 on 2026-11-27, a factual correction of what the port found.**

- **`onUnhandledFrame: "error"` alone fails no test.** msw only rejects the call, and prints why: a page shows the
  failure as a failed card, and its test passes. The setup file, `mock/setup.ts`, fails it, by a check that does not
  depend on timing. `trackedFetch` (`mock/network.ts`) checks each call of the global `fetch`, the only calls checked,
  against the handlers in place at the moment the page makes it, before anything can abort it: msw's public
  `listHandlers()` and each handler's `test({ request })`, quiet, as msw picks one, a request `bypass()` marked and a
  common asset let through as msw does. The check needs no network. A `fetch` call that no handler in place matched
  fails the first check after it is made: `afterEach` fails its test, the calls an unmount aborted included; a call
  made after that, as by a timer of the page, fails the next test; one made after the last test's check fails the
  file, in `afterAll`. A call made after the file's `afterAll` is checked by nothing. The handlers are those in place
  when the call is made: a call made before the test adds its handler fails the check, though msw answers it.
  `network.test.ts` runs a fixture through Vitest's Node API and asserts which of its tests, and its file, fail.
- **msw writes a string `data` as it is.** `client.send({ data: "overview" })` sends `data: overview`, which the page's
  `JSON.parse` refuses. The server sends every item as JSON, so `feed<T>(path)` sends `JSON.stringify(item)`.
- **The head of a stream waits for its first frame.** happy-dom's `fetch`, through msw's socket, gives the page no
  answer until the first bytes of the body, as a proxy does: quoll's server sends an empty comment with the head for
  that reason. A stream that ends starts its body with `:\n\n`, as `events(items)` does. msw's `sse()` client cannot
  write a comment, so `feed()` sends a `retry: 3000` field, which dispatches nothing, as the stream opens.
- **The `socket hang up` noise is happy-dom's.** Its `fetch` prints the error of every request it ends, with no test's
  name, a request the page aborted included (a stream closed on unmount, a read cancelled). msw answers every call in
  the process, so a hang-up can only be such an abort: `setup.ts` leaves out exactly that one, and prints every other.

### Rule 14: long lists

Do not virtualize today, and reach for TanStack Virtual only for a list whose DOM rows can pass about a thousand and
cannot be capped. Every list of the page is capped:

- a log keeps 5,000 lines and compose 2,000 per app, each rendered as one text node in a `<pre>`, which the browser
  lays out cheaply;
- jobs show 50 runs, the bell 30, the file tree 500 at most, and the apps table tens of rows.

Virtualizing the text outputs would cost find-in-page, the selection of a range that scrolls, and measuring each
wrapped line (`measureElement`), for no gain at these sizes. When a list does need it, such as a table of every
container of a swarm or a log whose lines become components with links, keep the virtualizer in a leaf component that
takes plain props. `useVirtualizer` is on the React compiler's list of incompatible APIs, and the component calling it
is not compiled (checked: `CompileError … Use of incompatible library`, "TanStack Virtual's `useVirtualizer()` API
returns functions that cannot be memoized safely").

### Rule 15: route preloading

With #186's file routes, set `defaultPreload: "intent"` and `defaultPreloadStaleTime: 0` on the router. Give each
route a loader that only calls `context.queryClient.ensureQueryData(xQueries.y())` with the options of its module's
`api/`. Hovering or focusing a link then warms the cache, and the router never keeps a copy of its own: Query alone
decides freshness, and the region's `useSuspenseQuery` (decision 4) finds its data. Two exceptions:

- **The edited files** (env, config, an app's file) are read with `refetchOnMount: "always"`, so a preload would read
  them twice. Their routes do not preload them.
- **Feeds and streams** open in components, never in loaders, as a preload must not open a connection the reader may
  never use.

Not checked: preloading was not run in this study.

**Amended by #203 on 2026-11-27, the last point on the maintainer's decision of 2026-11-27.** A loader warms with
`void context.queryClient.prefetchQuery(...)` and waits for nothing. Today only `/settings` (the store's status and
the jobs) and `/store/new` (the template) have one:

- **Not `ensureQueryData`.** Its failure would be the route's, the whole page down through `errorComponent` where a
  card or an alert says why, and the navigation would wait for the retries of a server that answers 502.
- **A warmed read keeps a `staleTime` at least the warm one,** in its options, so that the loader and the card's
  `useQuery` both take it: a second for the store's status and the jobs, `Infinity` for the template. With a
  `staleTime` of 0 the read is made twice, by the loader, then again as the card mounts, and a third time on the
  click that follows a hover, as `defaultPreloadStaleTime: 0` runs the loader again (counted by `settings.test.tsx`).
  `useSuspenseQuery` hid it: it takes a read as fresh for a second at least. The dashboard's placements and the
  store's apps have no loader.

### Rule 16: client global state

No client store library: jotai goes (decided by the maintainer, 2026-11-26). On main it holds two atoms, `themePaletteAtom` and `colorModeAtom`, seeded once from the cookies in `AppProviders`, read by `theme-effects` alone and written by nothing: a dependency for two constants.

- **Preferences** are an instance, by the rule of decision 7: a `Preferences` class in `#libs/preferences` holds the current `UserPreferences`, writes their cookies on `set`, and notifies its subscribers. `createPage()` creates it from `document.cookie` and hands it down through a context; `usePreferences()` reads it with `useSyncExternalStore`. A test passes its own instance. #180's theme switch calls `set`.
- **Never server state** on the client outside the query cache: no copy of a query's data, no derived list, no "selected app" that a URL or a component owns. A copy would go stale the moment a feed or a mutation changes the cache, and would need the bookkeeping decision 2 forbids.
- What the URL can say goes in search params (`validateSearch`). What one component tree owns stays in its `useState`. What a form holds is in the form (decision 11). A new shared value that no server or URL holds becomes an instance like `Preferences`, created in `createPage`, not a store library.

### Recommendations

1. **Forms.** TanStack Form, with `formErrorsOf` and a `FieldsByCode` table per form, and no schema library for now.
   It works with the React compiler with no API to avoid, its `setErrorMap` takes `{ form, fields }` as the server's
   problem gives it, and it shares the idioms of Query and Router. Port the five forms in one issue, env first, as in
   the patch.
2. **Optimistic updates.** Only the bell's marks, in the cache through `onMutate` in `api/`. Read again on failure,
   never restore a snapshot, and read nothing again on success while a feed keeps the entry. Everything else waits
   and shows its pending state. `meta.invalidates` stays success-only, as drafted.
3. **Tests.** orval's MSW handlers on one msw 3 `setupServer`, with `onUnhandledFrame: "error"`, `sse()` and
   `eventsource` for the streams, ported module by module beside `serve` until `serve` is gone.

### Decisions of the addendum

Accepted by the maintainer on 2026-11-26, as recommended:

- TanStack Form for every form of the page (react-hook-form not taken)
- `formErrorsOf` and a `FieldsByCode` table per form, in `modules/common/helpers/form-errors.ts`
- A form's refusal shows in the form (field or form error), with no toast; a toast is for an action outside a form
- No schema library for now; the client checks are plain functions in its module's `helpers/`
- Optimistic only for the bell's marks and changes like them, by the rule of decision 12
- Optimistic changes in the cache through `onMutate` in `api/`, read again on failure, never a snapshot
- `meta.invalidates` success-only; "read again whatever the outcome" stays in the mutation's own `onSettled`
- An optimistic mutation's UI callbacks on `mutate(...)`, not by overriding its options
- msw 3 with orval's handlers (`#libs/api/mock`), `onUnhandledFrame: "error"`, replacing `serve` module by module
- The `// @ts-nocheck` hook on orval's mocks until orval fixes TS2698
- `eventsource` as the tests' `EventSource`, and `FakeEventSource` kept only for reconnection tests
- No virtualization until a list can pass a thousand rows uncapped; then TanStack Virtual in a leaf component
- `defaultPreload: "intent"`, `defaultPreloadStaleTime: 0`, loaders of `ensureQueryData` only, the edited files and feeds left out (amended by #203: loaders of `prefetchQuery`, on reads whose options keep a `staleTime` at least the warm one, a second or more)
- No client store library (jotai removed): preferences in a `Preferences` instance created by `createPage`, read with `useSyncExternalStore`

Left open, with no recommendation: a `pattern` in the contract for the rules the server holds (the app id), or not. It
is decided when the new app's form is ported.

**Decided with the maintainer on 2026-11-27, as the forms were ported (#205):**

- **No `pattern` in the contract.** The new app's id gets a client check, `appIdError` in `store/helpers/app-id.ts`,
  which copies the core's rule (`AppId::regex()`), as the env form's `newVariableError` copies the variable name's. The
  server's `editor.invalid_app_id` and `editor.app_exists` still land under the id's field.
- **The app editor is no form.** Its drafts stay as they are, and nothing of it moves to TanStack Form. A save's refusal
  shows under the editor of the file saved, as an alert, with no toast: in `describeError`'s words, as the core's
  refusal of a file always names the file written (`refusal()` in `crates/core/src/store/files.rs`), so a table by path
  would place nothing elsewhere. A refused new file shows why under its path's input, which stays open, in plain local
  state.
- **The login form is not ported** in #205, whose text names the other four.
- The YAML editor of the configuration and of the new app is a component, `YamlEditor`
  (`common/components/yaml-editor.tsx`), whose value the form holds: `useYamlEditor`, which held it, is gone.
- **A refusal does not stop the next submit.** TanStack Form keeps the server's refusal in the form's `onSubmit` errors,
  which a form with no validator of its own never clears, and refuses every submit after it: a retry after a 500 would
  send nothing. Each form submits through `submitAfterRefusal` (`form-errors.ts`), which clears it first; the client
  checks are the fields' `onSubmit` validators, run again by the submit.
- **A refusal belongs to its variable, not to its row.** The env form keeps the server's refusal of a variable in a map
  by its name, in the form's own state: set from `formErrorsOf` when a save is refused, an entry dropped when that
  variable's value changes or it is removed. TanStack Form's meta is per field, and a field is a row's place, which
  moves as variables are added or removed: kept there, a refusal was dropped or shifted with the rows. The rows are
  keyed by the variable's name, added in their place by name and removed by name. The form's own refusal, of no
  variable, stays in TanStack's `onSubmit` errors, and a new name's check in its field's validator.

### Not checked

- `useOptimistic` failing to show the marks before the answer: the cause was not traced.
- A `keepalive` mark sent one microtask later, as `onMutate` awaits `cancelQueries` before the call, when a
  notification's link unloads the page in a real browser. The test of the link passes.
- msw's `client.error()` and `client.close()` against `ServerEvents.keep`'s reconnection, and the `socket hang up`
  noise.
- Route preloading (rule 15), and the bundle once #186 splits it per route: today everything is in one entry chunk.
- Whether importing only the `RegExp` that orval's zod output exports leaves zod out of the bundle.
- The login form on TanStack Form: left as it is by #205. The new app and the configuration were ported there, with no
  toast for their refusals; the app editor, which is no form, shows its save's refusal under the file saved, with no
  toast.
