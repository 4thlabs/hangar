---
name: hangar-web
description: How Hangar's page in web/ is built, from ADR 0002. Its layers (#libs/api, a module's api/, root .ts, hooks/, components/, routes), the query and mutation options on orval's, useEventFeed and useEventStream, Region, createPage, Preferences, forms on TanStack Form with formErrorsOf, the optimistic rule, tests on orval's MSW handlers, the words in messages.ts, and no class made only of statics. Use it for any work under web/, the Rust server's Vite SPA - a page, a component, a hook, a query, a mutation, a route, a form, a test - and to review or plan such work.
---

# Hangar's page in `web/`

`web/` is a Vite SPA: React with its compiler, TanStack Router, TanStack Query on the hooks and options orval writes
from the server's OpenAPI document, quoll `Events` streams, and shadcn components. Its design is
[ADR 0002](../../../docs/adr/0002-web-design.md), accepted on 2026-11-26. This skill gives its rules in short. The ADR
gives the why, the options weighed and the measures.

**The code is moving to it.** The ADR lands in four PRs: #195 (no class made only of statics, `createPage`,
`Session`), #186 (file routes), the data layer and the two stream hooks, then the words in `messages.ts`. Until they
merge, some names below do not exist yet (`Region`, `useEventFeed`, `formErrorsOf`...).

- Write new code in this shape with the pieces that exist.
- Do not port code an issue is not about: AGENTS.md's scope rule holds.
- Where this skill and the code disagree, the code is the old shape, not a new rule.

Also read [`docs/web/CODING_RULES.md`](../../../docs/web/CODING_RULES.md): the language, React, readability and test
rules, and the two linters, ESLint at the root and oxlint's type-aware rules in `web/`. And AGENTS.md: the import
mapping and the Rust section's "Errors the page shows". Load the other skills it lists (`react-query`,
`vercel-react-best-practices`, `vercel-composition-patterns`, and TanStack Router's through `intent`), with what
AGENTS.md says does not apply.

## The layers, and what each may import

```
#libs/api                orval's generated.ts, apiFetch and ApiError, createQueryClient, the Events transport
modules/<d>/api/         query and mutation options on orval's, keys, what a change makes stale, Session
modules/<d>/*.ts         the domain: pure functions, view models, search params, formats, messages.ts
modules/<d>/hooks/       compose queries, feeds and local state machines
modules/<d>/components/  render; the route's component is the page
routes/                  path, validateSearch, beforeLoad, loader, component: thin
```

| Layer         | May import                                                | Must not import                                                                                                |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| root `.ts`    | types and enums of `#libs/api`, other modules' root `.ts` | React, `@tanstack/*`, orval's hooks, keys and fetchers, `api/`, `hooks/`, `components/`, `ui/` (types allowed) |
| `api/`        | `#libs/api` options, keys, URLs; root `.ts`               | React, orval's `use*` hooks, `hooks/`, `components/`                                                           |
| `hooks/`      | `api/`, root `.ts`, `common/hooks`                        | orval's `use*` hooks                                                                                           |
| `components/` | everything above, `ui/`                                   | orval's `use*` hooks                                                                                           |

- orval's `use*` hooks are never imported outside `#libs/api`. Call `useQuery(xQueries.y())` and
  `useMutation(xMutations.z())`.
- Modules by domain, not by route. A module may import another. No barrel. Tests sit next to their code.
- `modules/common` holds the shell, `ui/`, and the generic hooks and components (`use-event-feed`, `use-event-stream`,
  `Region`, the toasts). `libs/` holds what has no React and no page domain.
- A file is named after its main export: `apps-view.ts` exports `appsView`.
- The ADR's lint rules, which come with its PRs, are core ESLint (`no-restricted-syntax`, `no-restricted-imports`):
  typescript-eslint does not load on TypeScript 7. In `modules/` and `app/`, import with `#modules/...`, never `../`,
  so that the rules see every import.

### `#libs/api`: the client, said once

`createQueryClient(onUnauthorized)` builds the one client. Its `MutationCache.onSuccess` reads again what a mutation's
`meta.invalidates` names, and awaits it, so the mutation stays pending until the reads are done:

```ts
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { invalidates?: readonly QueryKey[] };
  }
}

mutationCache: new MutationCache({
  onError,
  onSuccess: async (_data, _variables, _context, mutation) => {
    const stale = mutation.meta?.invalidates ?? [];

    await Promise.all(stale.map(queryKey => client.invalidateQueries({ queryKey })));
  },
}),
```

orval splits its keys by path segment (`shouldSplitQueryKey: true`): `["api", "docker", "apps", project]`. So
`invalidateQueries({ queryKey: ["api", "docker"] })` matches every Docker read, with no predicate.

### `modules/<d>/api/`: options, keys, staleness

One options object per read, shared by components and loaders. A query's policy is written here, never at a call
site:

```ts
// apps/api/queries.ts
export const appsQueries = {
  projects: () => getDockerProjectsQueryOptions(),
  project: (project: string) => getDockerProjectQueryOptions(project),
};
export const dockerQueries: QueryKey = ["api", "docker"];
export const staleAfterDockerChange: Readonly<Record<DockerChange, readonly QueryKey[]>> = {
  containers: [getDockerProjectsQueryKey(), getComposeBatchesQueryKey()],
  overview: [getDockerOverviewQueryKey()],
};

// settings/api/queries.ts
export const settingsMutations = {
  saveConfig: () =>
    getConfigSaveMutationOptions({
      mutation: { meta: { invalidates: [getConfigReadQueryKey(), getStoreAppsQueryKey()] } },
    }),
};
```

- `xQueries` and `xMutations` are the one object of functions allowed: TanStack's factory idiom.
- A mutation whose answer is the new state writes it with `setQueryData`, in its options, instead of `invalidates`.
- `meta.invalidates` is for success only. "Read again whatever the outcome" (install, run, cancel) goes in that
  mutation's own `onSettled`.

### Root `.ts`: the domain, pure and tested without rendering

Every computation a page needs: filter, sort, count, totals, the search params, the labels.

```ts
// apps/apps-view.ts
/** What the apps page shows: the projects the search keeps, in its order, and what is selected of them. */
export function appsView(projects: readonly DockerProject[], search: AppsSearch, selection: ReadonlySet<string>) {
  const sort = parseAppsSort(search.sort);
  const visible = filterProjects(projects, { q: search.q ?? "", sort });
  const selected = visible.map(project => project.name).filter(name => selection.has(name));

  return { sort, visible, selected, totals: projectTotals(projects) };
}
```

`validateAppsSearch` sits here too, for the route's `validateSearch`.

### `hooks/`: queries, feeds and state machines composed

```ts
// apps/hooks/use-docker-changes.ts
export function useDockerChanges() {
  const queryClient = useQueryClient();
  const invalidate = (queryKey: QueryKey) => void queryClient.invalidateQueries({ queryKey });
  const { isDown } = useEventFeed<DockerChange>(getDockerChangesUrl(), {
    onOpen: () => invalidate(dockerQueries),
    onItem: change => staleAfterDockerChange[change].forEach(invalidate),
  });

  return { isReconnecting: isDown };
}
```

A helper that one hook uses, and that needs what the hook has, is a closure of the hook, not a class.

### `components/`: the page reads its inputs, calls one view model, lays out

```tsx
const { data, error, isPending } = useQuery(appsQueries.projects());
const { isReconnecting } = useDockerChanges();
const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
const view = appsView(data ?? [], search, selection);
// ... {view.selected.length === 0 ? words.noSelection : words.selected({ count: view.selected.length })}
```

A page component **may** read the route (`useSearch`, `useParams`), call its module's hooks and queries, hold the UI
state it owns, call one view-model function and lay out regions. It **may not** reduce, filter or sort inline, build
or invalidate a key, open a stream, or write a word chosen by a code or an enum.

### Routes: thin

```ts
// routes/_app/apps.tsx
export const Route = createFileRoute("/_app/apps")({
  validateSearch: validateAppsSearch,
  staticData: { searchable: true },
  loader: ({ context }) => context.queryClient.ensureQueryData(appsQueries.projects()),
  component: AppsPage,
});
```

- One file per route under `web/src/routes/`, `export const Route = createFileRoute(...)`. The generator writes the
  path from the file's name: rename the file, never the string. `_app.tsx` is the frame, with no path of its own,
  whose `beforeLoad` requires the session for every page under `_app/`. `_app/$.tsx` is the not-found page of any
  other path.
- A page beside another at a longer path is `x_.y.tsx` (`apps_.$project.tsx`, `store_.new.tsx`): `x.y.tsx` would be a
  child of `x.tsx`, rendered in its `Outlet`, which a page has not.
- A route file imports its components from `modules/` and defines none: `autoCodeSplitting` moves each route's
  components into a chunk of their own, loaded with its page. Only `validateSearch`, `beforeLoad`, `loader` and
  `staticData` stay in the entry.
- A component reads its route by id: `useSearch({ from: "/_app/apps" })`, `useParams({ from: "/_app/apps_/$project" })`.
- `src/app/routeTree.gen.ts` is generated and gitignored. `src/app/router.ts` has `createPageRouter` and the
  `Register` declaration.
- The build fails when the entry, with the chunks it imports, passes `entryBudgetKb` in `vite.config.ts`. A change
  that passes it loads what it added from a route's component, or raises the budget and says why.
- The router has `defaultPreload: "intent"` and `defaultPreloadStaleTime: 0`: Query alone decides freshness.
- A loader only calls `ensureQueryData` with its module's options.
- The edited files (env, config, an app's file) are read with `refetchOnMount: "always"`, and their routes do not
  preload them.
- Feeds and streams open in components, never in loaders.
- A page's own failure is its route's `errorComponent`.

## State, each kind in one place

- **Server state** is in the query cache, and nowhere else. Never copy a query's data into `useState`. The one
  exception is a form's working copy, keyed by the read it started from (`<EnvForm key={dataUpdatedAt}>`).
- **URL state** is the route's search params, read, never mirrored into state. The settings tab is the hash.
- **Local UI state** is in the component or hook that owns it. **A form's values** are in the form.
- **No client store library** (jotai goes). A shared value that no server or URL holds is an instance created in
  `createPage`, like `Preferences`.
- **Polling** only where no event exists: the store sync and the jobs.

## `createPage`, `Session`, `Preferences`

`app/page.ts` creates, once, what the page is built on. `main.tsx` and the tests' `renderAt` both call it:

```ts
/** The preferences `document.cookie` holds, their cookies renewed for another year, defaults included. */
function loadedPreferences(): Preferences {
  const preferences = Preferences.fromCookies(document.cookie);

  preferences.renew();

  return preferences;
}

export function createPage({ history, preferences = loadedPreferences() }: PageOptions = {}) {
  const queryClient = createQueryClient(() => session.signedOut(router));
  const session = new Session(queryClient);
  const router = createPageRouter({ queryClient, session }, history);

  return { queryClient, session, router, preferences };
}
```

- The router's context carries `{ queryClient, session }` to the routes.
- `Session` (`modules/auth/api/session.ts`) takes the client in its constructor and has `require()`, which redirects,
  and `signedOut(router)`. A test builds it with `new`, with no module mock.
- `Preferences` (`#libs/preferences`) holds the user's preferences, writes their cookies on `set` and notifies its
  subscribers. `createPage` creates it from `document.cookie` and calls `renew()`, which writes every cookie again,
  defaults included, for a year: nothing else renews them. `AppProviders` hands it down through a context.
  `usePreferences()` (`common/hooks/use-preferences.ts`) reads it with `useSyncExternalStore`. A test passes its own
  instance, or the cookies it sets.

## `Events`: two hooks, on one transport

The transport is `#libs/api/server-events.ts`: `keepEvents`, `followEvents`, `readEvents`. Only these two hooks of
`common/hooks` use it:

```ts
// A feed that does not end: connected again when lost, closed while the tab is hidden, none for a null url.
// The handlers are the latest render's (useEffectEvent): changing them does not reconnect.
useEventFeed<T>(url: string | null, { onItem, onOpen?, onDown?, onClose? }): { isDown: boolean }

// A stream that ends, as a compose run: its items folded into S, rendered once a frame. `read()` from a click or an effect.
const stream = useEventStream<ComposeEvent, ComposeOutputState>(() => emptyComposeOutput([]), {
  fold: applyComposeEvents,
  isEnd: event => event.kind === "end",
  requiresEnd: true,
  onOpen: readBatchesAgain,
  onEnd: readBatchesAgain,
});
// stream: { state, setState, status, failure, read(url, seed, request?), stop }
```

- A feed about server state writes the cache: it invalidates, or calls `setQueryData`. It never keeps a copy of its own.
- The data no query holds (stats frames, log lines, compose output) stays in the hook's state.
- On open, a feed invalidates everything under its prefix, to catch up on what it missed.
- Terminals (WebSocket) are outside this model and keep their own hook.

## Errors, toasts and regions

- `describeError(error)` and `describeErrorDetail(detail)` (`common/error-message.ts`) are the one table that words a
  server code. A code with no words is a type error.
- `toastSuccess(title, description)` and `toastFailure(title, error)` are called from the mutation's own `onSuccess`
  and `onError`, with words from the module's messages. No global toast on every failure.
- A 401 goes through the caches' `onError` to `session.signedOut(router)`.
- **`Region`** wraps each card and widget. It combines `Suspense`, TanStack Router's `CatchBoundary` and
  `QueryErrorResetBoundary`. It fails alone, and its retry asks its failed queries again. A query inside a region uses
  `useSuspenseQuery`, warmed by the route's loader. A failed refetch keeps the stale data on screen.

```tsx
<Region failure="Could not show the widget" fallback={<CardSkeleton />}>
  <DockerCard />
</Region>
```

## Forms: TanStack Form, and `formErrorsOf`

Every form uses TanStack Form. There is no schema library: a client check is a plain function in the form's root
`.ts`. The server's refusal goes under the field its code names, through `formErrorsOf`
(`modules/common/form-errors.ts`) and a `FieldsByCode` table per form:

```tsx
const fieldsByCode = (variables: readonly EnvVariable[]): FieldsByCode<ValueField> => ({
  "env.invalid_name": ({ name }) => valueOf(name),
  "env.line_break": ({ name }) => valueOf(name),
});

const save = useMutation(settingsMutations.saveEnv());
const form = useForm({
  defaultValues: envFormValues(read),
  onSubmit: async ({ value, formApi }) => {
    try {
      await save.mutateAsync({ data: envChanges(read, value.variables) });
      toastSuccess(words.saved, words.savedDescription);
    } catch (failure) {
      formApi.setErrorMap({ onSubmit: formErrorsOf(failure, fieldsByCode(value.variables)) });
    }
  },
});
```

- A form's refusal shows in the form, under a field or for the whole form, with no toast. A toast is for an action
  outside a form.
- Fields are named by index (`variables[${index}].value`), never by a key: `A.B` would read as a nested path.
- The inputs carry `aria-invalid` and `aria-describedby`.

## Optimistic updates: rarely

Be optimistic only when all three hold:

- the server cannot refuse the change for a reason the page cannot see;
- the answer carries nothing the page needs;
- the change is cheap to undo by reading again.

Today that is the bell's marks, and later toggles of the same kind (a dismiss, a pin). How:

- Write it in the cache, with `onMutate` in the module's `api/`, through the same function the feed writes with.
- Cancel the reads in flight first.
- On failure, read again. Never put back a snapshot: it would drop what the feed brought meanwhile.
- On success, read nothing again when a feed keeps the entry. No `meta.invalidates`.
- Put a component's own callbacks on `mutate(variables, { onSuccess, onError })`. Spreading the options and setting
  `onError` would replace the read-again.
- No `useOptimistic`: it covers one component for one transition, while the cache covers every reader.

```ts
markSeen: () =>
  getNotificationsSeenMutationOptions({
    mutation: {
      onMutate: ({ data }, { client }) => changeNotifications(client, recent => withSeen(recent, data.ids)),
      onError: readAgain,
    },
  }),
```

Everything else waits for its answer: what the server validates, what takes time, what gets an id from the server. It
shows its pending state in place (the button's face, the row dimmed), then reads again or takes the answer into the
cache.

## Tests: on orval's MSW handlers

- One msw 3 `setupServer`, `network` in `app/mock/network.ts`, listening with `onUnhandledFrame: "error"`: a call no
  handler answers fails the test.
- Its defaults are what the shell calls on every page: the session, the auth options, an empty bell and its quiet
  stream.
- A test adds what its page calls, from orval's handlers in `#libs/api/mock`, typed by the contract. A renamed route or
  a changed body is a `tsc` error in the test.
- A refusal is thrown as a problem from the handler.
- An `Events` route uses msw's `sse()`. orval's handler for it is useless.

```ts
network.use(
  getEnvReadMockHandler({ variables: { KEPT: "1", OLD: "3" } }),
  getEnvSaveMockHandler(async ({ request }) => {
    saved.push(await request.json()); // EnvChanges
    throw problem(400, "invalid variable name: 1BAD");
  }),
  sse<{ message: NotificationEvent }>("*/api/notifications/events", ({ client }) => {
    send = event => client.send({ data: event });
  }),
);
```

- To assert `keepalive`, spy on `fetch`: msw's request loses it.
- `FakeEventSource` stays only for the tests that drive a lost stream and its reconnection.
- Faker's answers are random: use them only for bodies the test never reads.
- The old `serve({...})` fake goes module by module. Do not add to it.
- Test the domain's root `.ts` directly, without rendering. Name a test after the behaviour it checks.

## The words: `messages.ts`, in English

Each module's words are in its `messages.ts`, a plain `as const` object, English only. There is no `t()`, no locale
and no hook:

```ts
export const appsMessages = {
  title: "Apps",
  noSelection: "No selection",
  selected: ({ count }: { count: number }) => `${count} selected`,
  status: {
    running: "Running",
    partial: "Partial",
    stopped: "Stopped",
    unhealthy: "Unhealthy",
  } satisfies Record<ProjectStatus, string>,
} as const;
```

- A label of an enum is typed by the contract, so a new value is a type error.
- The tables keyed by code stay where they are: `error-message.ts` by `ErrorCode`, `notification-text.ts` by key.
- Prose with markup (a description with `<code>`) may stay in its JSX until translation comes.

## Classes: none made only of statics

- What has no state is module functions and consts: `filterProjects`, `describeSync`, `parseSettingsTab`. A
  function's name carries its context.
- What has state or dependencies is a class, created with `new`, with its dependencies as constructor arguments. Its
  one instance is created in `createPage` (`Session`, `Preferences`).
- A helper of one hook that needs the hook's values is a closure of the hook. One that several of its effects call is
  a module function beside it, taking what it needs (`changeNotifications(queryClient, change)`), not a closure the
  effects would list, which `exhaustive-deps` asks to wrap in a `useCallback`.
- `static` stays only for a real factory or constant of a class with instances: `Preferences.fromCookies`.
- `ApiError extends Error` and test doubles with instances are classes as before.
- ESLint's `no-restricted-syntax` flags a class made only of statics, and `no-restricted-imports` what a module's root
  `.ts` may not import (ADR rules 1 and 4).

## Lists

Do not virtualize: every list of the page is capped (a log at 5,000 lines, the bell at 30, the file tree at 500).
Reach for TanStack Virtual only for a list that can pass about a thousand rows uncapped. Then keep `useVirtualizer` in
a leaf component that takes plain props: the React compiler skips the component that calls it.
