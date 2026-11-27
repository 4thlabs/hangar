---
name: hangar-web
description: How Hangar's page in web/ is built, from ADR 0002. Its layout (routes are the pages, one folder per section, _app/route.tsx and _app/-shell/ the shell, the wiring at src/, modules apart with api/, helpers/, hooks/ and components/), the query and mutation options on orval's, useEventFeed and useEventStream, QueryRegion and RenderRegion, createPage, Preferences, forms on TanStack Form with formErrorsOf, the optimistic rule, tests on orval's MSW handlers, the words in Paraglide's messages/en.json called as m.<id>(), and no class made only of statics. Use it for any work under web/, the Rust server's Vite SPA - a page, a component, a hook, a query, a mutation, a route, a form, a test - and to review or plan such work.
---

# Hangar's page in `web/`

`web/` is a Vite SPA: React with its compiler, TanStack Router, TanStack Query on the hooks and options orval writes
from the server's OpenAPI document, quoll `Events` streams, and shadcn components. Its design is
[ADR 0002](../../../docs/adr/0002-web-design.md), accepted on 2026-11-26. This skill gives its rules in short. The ADR
gives the why, the options weighed and the measures.

**The code is moving to it.** The ADR lands in four PRs: #195 (no class made only of statics, `createPage`,
`Session`), #186 (file routes), #203 (the data layer, the two stream hooks and the regions), then #204 (the words in
`messages.ts`), which #214 moved to Paraglide's `messages/en.json`.

- Write new code in this shape with the pieces that exist.
- Do not port code an issue is not about: AGENTS.md's scope rule holds.
- Where this skill and the code disagree, the code is the old shape, not a new rule.

Also read [`docs/web/CODING_RULES.md`](../../../docs/web/CODING_RULES.md): the language, React, readability and test
rules, and the two linters, ESLint at the root and oxlint's type-aware rules in `web/`. And AGENTS.md: the import
mapping and the Rust section's "Errors the page shows". Load the other skills it lists (`react-query`,
`vercel-react-best-practices`, `vercel-composition-patterns`, and TanStack Router's through `intent`), with what
AGENTS.md says does not apply.

## The layout, and what each part may import

TanStack Router's own layout (its examples `kitchen-sink-react-query-file-based`, `authenticated-routes`,
`start-trellaux`), with modules kept apart, as #207 and #210 amended ADR 0002's decisions 1 and 6:

```
src/main.tsx, page.ts, router.ts   the wiring: createPage, the router, the providers (app-providers.tsx,
                                   theme-effects.tsx); mock/page.tsx, the tests' page; no app/ folder
src/routes/                        one file per route = its page: path, validateSearch, beforeLoad, loader, and the
                                   component that composes the modules; one folder per section under _app/, whose
                                   route.tsx is the shell, its pieces in _app/-shell/ (below)
src/modules/<d>/api/               query and mutation options on orval's, keys, what a change makes stale, Session
src/modules/<d>/helpers/           the domain: pure functions, view models, search params, formats, parsers;
                                   <d>-labels.ts, the labels of its enums, which call m
src/modules/<d>/hooks/             compose queries, feeds and local state machines
src/modules/<d>/components/        the pieces the pages are made of
src/modules/common/                what two modules or more share: ui/, components/, hooks/, api/, helpers/
src/libs/                          the API client, formats, preferences
src/paraglide/                     what Paraglide compiles from messages/en.json: generated and gitignored
```

| Layer               | May import                                                                        | Must not import                                                                                                |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `helpers/`          | types and enums of `#libs/api`, `helpers/` of its own and `common`, `#paraglide/` | React, `@tanstack/*`, orval's hooks, keys and fetchers, `api/`, `hooks/`, `components/`, `ui/` (types allowed) |
| `api/`              | `#libs/api` options, keys, URLs; `helpers/`                                       | React, orval's `use*` hooks, `hooks/`, `components/`                                                           |
| `hooks/`            | `api/`, `helpers/`, `common/hooks`                                                | orval's `use*` hooks                                                                                           |
| `components/`       | everything above, `ui/`                                                           | orval's `use*` hooks                                                                                           |
| a module, any layer | its own folders, `common`, `#libs/...`, `#paraglide/...`                          | another module, `#routes/`, the wiring; `common` imports no other module                                       |
| `routes/`           | every module, the wiring's types                                                  | orval's `use*` hooks                                                                                           |

- orval's `use*` hooks are never imported outside `#libs/api`. Call `useQuery(xQueries.y())` and
  `useMutation(xMutations.z())`.
- Modules by domain, pages by route. **A module never imports another**: the route files compose them. What two
  modules really share goes down into `common` (the compose vocabulary, the Docker changes feed), and only then.
- No barrel. Tests sit next to their code; a page's beside its route file (`routes/_app/apps/index.test.tsx`).
- No file sits directly under a module, nor directly under `modules/`: ESLint refuses them.
- `libs/` holds what has no React and no page domain.
- A file is named after its main export: `apps-view.ts` exports `appsView`.
- The ADR's lint rules, which come with its PRs, are core ESLint (`no-restricted-syntax`, `no-restricted-imports`):
  typescript-eslint does not load on TypeScript 7. In `modules/`, import with `#modules/...`, never `../`, so that the
  rules see every import: ESLint refuses a `..` segment there.

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
// common/api/docker-queries.ts: common's, as the apps' pages and the dashboard's Docker card both read Docker
export const dockerQueries = {
  projects: () => getDockerProjectsQueryOptions(),
  project: (project: string) => getDockerProjectQueryOptions(project),
  overview: () => getDockerOverviewQueryOptions(),
};
export const allDockerQueries: QueryKey = ["api", "docker"];
export const staleAfterDockerChange: Readonly<Record<DockerChange, readonly QueryKey[]>> = {
  containers: [getDockerProjectsQueryKey(), getComposeBatchesQueryKey()],
  overview: [getDockerOverviewQueryKey()],
};

// settings/api/settings-queries.ts
export const settingsQueries = {
  // warmed by the route's loader: a staleTime at least the warm one (see the loaders below)
  jobs: () => getJobsListQueryOptions({ query: { staleTime: warmedFor, refetchInterval: query => jobsPollDelay(query.state.data ?? []) } }),
};
export const settingsMutations = {
  saveConfig: () =>
    getConfigSaveMutationOptions({
      mutation: { meta: { invalidates: [getConfigReadQueryKey(), getStoreAppsQueryKey()] } },
    }),
};
```

- `xQueries` and `xMutations` are the one object of functions allowed as a namespace: TanStack's factory idiom. A
  table keyed by a code or an enum, as `wordsByCode` or `appsLabels.status`, is data, not a namespace.
- A mutation whose answer is the new state writes it with `setQueryData`, in its options, instead of `invalidates`.
- `meta.invalidates` is for success only. "Read again whatever the outcome" (install, run, cancel) goes in that
  mutation's own `onSettled`. A key is a prefix: `getStoreAppsQueryKey()` covers the editor's reads of each app,
  under `["api", "store", "apps", id]`.
- Every read is orval's options, which `useQuery`, `prefetchQuery` and `ensureQueryData` take. Only
  `useSuspenseQuery` refuses them under `exactOptionalPropertyTypes`, as they type their function as possibly
  `skipToken`: a page's critical read, if one ever comes, is built with TanStack's `queryOptions` on orval's key and
  fetcher.
- A component adds its toasts beside the options' callbacks, never over one of them:
  `useMutation({ ...storeMutations.install(), onSuccess, onError })` when the options set only `onSettled`. When the
  options' own `onSuccess` or `meta.invalidates` remounts the component (a form keyed by its read), it awaits
  `mutateAsync` instead, as the callbacks of `mutate` go with the component.

### `helpers/`: the domain, pure and tested without rendering

Every computation a page needs: filter, sort, count, totals, the search params, the labels.

```ts
// apps/helpers/apps-view.ts
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
// common/hooks/use-docker-changes.ts
export function useDockerChanges() {
  const queryClient = useQueryClient();
  const invalidate = (queryKey: QueryKey) => void queryClient.invalidateQueries({ queryKey });
  const { isDown } = useEventFeed<DockerChange>(getDockerChangesUrl(), {
    onOpen: () => invalidate(allDockerQueries),
    onItem: change => staleAfterDockerChange[change].forEach(invalidate),
  });

  return { isReconnecting: isDown };
}
```

A helper that one hook uses, and that needs what the hook has, is a closure of the hook, not a class.

### The page reads its inputs, calls one view model, lays out

```tsx
const { data, error, isPending } = useQuery(dockerQueries.projects());
const { isReconnecting } = useDockerChanges();
const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
const view = appsView(data ?? [], search, selection);
// ... {view.selected.length === 0 ? m.apps_list_no_selection() : m.apps_list_selected({ count: view.selected.length })}
```

A page component **may** read the route (`useSearch`, `useParams`), call its module's hooks and queries, hold the UI
state it owns, call one view-model function and lay out regions. It **may not** reduce, filter or sort inline, build
or invalidate a key, open a stream, or write a word chosen by a code or an enum.

### Routes: each file is its page

```tsx
// routes/_app/apps/index.tsx
/** `/apps`, the installed apps, filtered by its search. */
export const Route = createFileRoute("/_app/apps/")({
  validateSearch: validateAppsSearch,
  staticData: { searchable: true },
  component: AppsPage,
});

/** The installed apps, ... */
function AppsPage() {
  const search = useSearch({ from: "/_app/apps/" });
  // ... reads the modules' queries and hooks, lays out their components
}
```

A route's loader only warms, and waits for none of it: the page shows its own skeletons and failures.

```ts
loader: ({ context }) => {
  void context.queryClient.prefetchQuery(settingsQueries.storeStatus());
  void context.queryClient.prefetchQuery(settingsQueries.jobs());
},
```

- Not `ensureQueryData`: its failure would be the route's, the whole page down where a card or an alert says why,
  and the navigation would wait for the retries of a server that answers 502.
- A warmed read keeps a `staleTime` at least the warm one, in its options, so that the loader and the card's
  `useQuery` both take it: `warmedFor`, a second, in `settings-queries.ts`, or `Infinity` for a read that does not
  change. With 0, the card reads again what the loader just read, and the click that follows a hover reads it a third
  time (`defaultPreloadStaleTime: 0` runs the loader again). ADR 0002, rule 15, as #203 amended it.

- One file per route under `web/src/routes/`, `export const Route = createFileRoute(...)`. The generator writes the
  path from the file's name: move the file, never edit the string. The tree, the maintainer's decision of 2026-11-27
  (#210):

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

- One folder per section, always, even for a section with one page. No layout route inside a section (no
  `apps/route.tsx`): its pages are siblings under `_app`, so no file name needs a `_` escape (`apps_.$project.tsx`).
  `store/$id.edit.tsx` keeps its dot, for `/store/:id/edit`. A new page goes in its section's folder; a new section
  gets its folder and its `index.tsx`.
- `_app/route.tsx` is the shell, a layout route with no path of its own, whose `beforeLoad` requires the session for
  every page under `_app/`. What it uses sits beside it in `_app/`, nothing of it at the routes' root: its pieces in
  `_app/-shell/` (`app-layout`, `navbar`, `navbar-mobile`, `searchbar`, `user-menu`, `user-avatar`, `app-error-page`,
  `navigations`, `use-current-path`), and `_app/$.tsx`, the not-found page of any other path, with
  `_app/-not-found-page.tsx` its component.
- A route file is its page: it defines its component, not exported, and composes the modules' components and hooks.
  `autoCodeSplitting` moves the component, and what only it uses, into a chunk of its own, loaded with the page. Only
  `validateSearch`, `beforeLoad`, `loader` and `staticData` stay in the entry. A route file exports `Route` alone.
- A page's own pieces, which only it uses and which compose several modules, go in `-<page>/` beside it: a name that
  starts with `-` is no route. Its tests sit beside it, `routes/_app/apps/index.test.tsx`, which
  `routeFileIgnorePattern` in `tsr.config.json` keeps out of the routes.
- A component reads its route by id: `useSearch({ from: "/_app/apps/" })`, `useParams({ from: "/_app/apps/$project" })`.
  An index page's id and full path end with `/`, so `useNavigate({ from: "/apps/" })`; a link still goes `to="/apps"`,
  and the URL has no trailing slash.
- `src/routeTree.gen.ts` is generated and gitignored. `src/router.ts` has `createPageRouter` and the `Register`
  declaration.
- `_app/route.tsx` has an `errorComponent`, `AppErrorPage`, in the frame: a session the server could not read, or a page
  that failed with no `errorComponent` of its own. Its retry calls `session.forgetFailure()`, then `router.invalidate()`.
- The build fails when what a signed-in page loads before its own code passes `firstLoadBudgetKb` in
  `vite.config.ts`: the entry, the component of `_app` (`_app/route.tsx`, the frame), the chunks they import, and their CSS. A change
  that passes it loads what it added from a route's component, or raises the budget and says why.
- The router has `defaultPreload: "intent"` and `defaultPreloadStaleTime: 0`: Query alone decides freshness.
- A loader only warms, with `prefetchQuery`, as above.
- The edited files (env, config, an app's file) are read with `refetchOnMount: "always"`, shown from a read of this
  mount alone, and their routes do not preload them. A settings card keeps the `dataUpdatedAt` its mount found, in
  `useState`, and gives it to its `QueryRegion` as `readAfter`: a copy cached by an earlier visit shows neither while
  the file is read nor when that read fails, which shows the failure and its Retry instead. Not `isFetchedAfterMount`,
  which a failed read sets too.
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

`page.ts` creates, once, what the page is built on. `main.tsx` and the tests' `renderAt` both call it:

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

- `describeError(error)` and `describeErrorDetail(detail)` (`common/helpers/error-message.ts`) are the one table that
  words a server code. A code with no words is a type error.
- `toastSuccess(title, description)` and `toastFailure(title, error)` are called from the mutation's own `onSuccess`
  and `onError`, with words from `m`. No global toast on every failure.
- A 401 goes through the caches' `onError` to `session.signedOut(router)`.
- **Regions** (`common/components/region.tsx`) wrap each card and widget, so that it fails alone. The component that
  renders the card reads with `useQuery`, above the region, and `<QueryRegion query failure fallback>` shows it: the
  data once there is some, even when a later read failed; else the read's failure, with a Retry; else the fallback.
  What the data renders sits in TanStack Router's `CatchBoundary`, reset when the query's `dataUpdatedAt` changes: a
  card that threw on one answer renders the next. A card that reads nothing, as the clock, sits in
  `<RenderRegion failure resetKey>`. ADR 0002, decision 4, as #203 amended it.
- No `Suspense`, no `useSuspenseQuery`, no `throwOnError` and no `QueryErrorResetBoundary` in a region: a reader that
  throws to a boundary is unmounted by it, and its observer with it, so an invalidation or a focus would read nothing
  and the region would not come back. With the observer above the region, the query comes back as any `useQuery`
  does: a feed's or a mutation's invalidation, a focus, a remount, polling, and the Retry, which reads again with
  `refetch({ cancelRefetch: false })`.
- `failure` is the title of an alert with a Retry, which says why only for the server's `ApiError`, or a render of its
  own, `({ cause, error, retry }) => ...`, with a `RetryButton`. `cause` is `read` when the query failed with no data,
  `render` when the card threw: a widget says either that its service did not answer or that its card could not show
  the answer (`WidgetFailure`).
- A read again that fails keeps the data on screen. A card that says so reads `query.error` beside its data.
- `useSuspenseQuery` stays for a page's critical data, awaited by its loader and failed by its route's
  `errorComponent`. None has any today.

```tsx
export function JobsSettingsCard() {
  const jobs = useQuery(settingsQueries.jobs());

  return (
    <QueryRegion query={jobs} failure={m.settings_jobs_read_failed()} fallback={<Skeleton className="h-24 w-full" />}>
      {runs => <JobRuns runs={runs} error={jobs.error} />}
    </QueryRegion>
  );
}

export function DockerCard() {
  const look = widgetLook("docker-general-stats");
  const overview = useQuery(dockerQueries.overview());
  const { data: projects } = useQuery(dockerQueries.projects());

  useDockerChanges();

  return (
    <QueryRegion
      query={overview}
      fallback={<WidgetSkeleton look={look} />}
      failure={failure => <WidgetFailure look={look} {...failure} />}
    >
      {host => <DockerHost overview={host} projects={projects ?? []} />}
    </QueryRegion>
  );
}
```

## Forms: TanStack Form, and `formErrorsOf`

Every form uses TanStack Form, but two: the login form, left as it is by the maintainer's decision of 2026-11-27, and
the app editor, which is no form. There is no schema library: a client check is a plain function in its module's
`helpers/`. The server's refusal goes under the field its code names, through `formErrorsOf`
(`modules/common/helpers/form-errors.ts`) and a `FieldsByCode` table per form:

```tsx
// routes/_app/store/new.tsx: a refusal goes under the field its code names, else under the form
const fieldsByCode: FieldsByCode<"id" | "compose"> = {
  "editor.invalid_app_id": () => "id",
  "editor.app_exists": () => "id",
  "editor.compose_rejected": () => "compose",
};

const create = useMutation(storeMutations.createApp());
const form = useForm({
  defaultValues: { id: "", compose: source },
  onSubmit: async ({ value, formApi }) => {
    try {
      await create.mutateAsync({ data: value });
    } catch (failure) {
      formApi.setErrorMap({ onSubmit: formErrorsOf(failure, fieldsByCode) });
    }
  },
});
// <form onSubmit={event => { event.preventDefault(); void submitAfterRefusal(form); }}>
// <form.Field name="id" validators={{ onSubmit: ({ value }) => appIdError(value) }}>
```

A list's items are no fields of their own: an array's field is a place, which moves as items are added or removed. The
env form keeps the server's refusal of a variable by its name, in its own state, and only the form's own refusal in
TanStack's errors:

```tsx
// settings/components/env-settings-card.tsx
const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(new Map());
// in onSubmit's catch, the table giving a variable's name:
const { form: formError, fields } = formErrorsOf(failure, fieldsByCode(value.variables));

setRefusals(new Map(Object.entries(fields)));
formApi.setErrorMap({ onSubmit: { form: formError, fields: {} } });
// a row, keyed by its variable: error = refusals.get(variable.key), dropped as its value changes or it is removed
```

- A form's refusal shows in the form, under a field or for the whole form, with no toast. A toast is for an action
  outside a form.
- A field of an array is named by index (`variables[${index}].value`), never by a key: `A.B` would read as a nested
  path. Its row is keyed by its item.
- The inputs carry `aria-invalid` and `aria-describedby`.
- A client check is a plain function in its module's `helpers/`, run by the field's `onSubmit` validator:
  `newVariableError`, `appIdError`, which copies the core's app id rule (no `pattern` in the contract). A YAML file is a
  field, edited in `YamlEditor`, its refusal under it.
- The app editor is no form: its drafts stay in `useAppFiles`, a save's refusal under the editor of the file saved, as
  an alert, a refused new file under its path's input.
- A form submits through `submitAfterRefusal(form)`, never `form.handleSubmit()` alone: TanStack Form keeps the
  server's last refusal in the form's `onSubmit` errors, and would refuse a retry.
- A refusal that belongs to an item of a list, not to a place in it, is kept by the item's name in the form's own state,
  as the env form's refusals by variable: TanStack's meta is per field, and a field of an array is a place, which moves.
  The rows are keyed by the item, and removed by it.

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

- One msw 3 `setupServer`, `network` in `mock/network.ts`, which `mock/setup.ts` starts for every test file. msw's
  `"error"` alone only rejects a call no handler answers, so `trackedFetch` checks each call of the global `fetch`
  against the handlers in place as the page makes it, and a call none matched fails the first check after it: its
  test's (an awaited call, one on the last line, one an unmount aborts), else the next test's (a timer's), else the
  file's `afterAll`. Add a test's handlers before the page calls them.
- Its defaults are what the shell calls on every page: the session, the auth options, an empty bell and its quiet
  stream.
- A test adds what its page calls, from orval's handlers in `#libs/api/mock`, typed by the contract. A renamed route or
  a changed body is a `tsc` error in the test. msw answers with the first handler that matches, and each
  `network.use` goes before the last: a test's own handlers, added after a page's defaults, win.
- A refusal is thrown from the handler: `problem(status, detail)`, or `coded(status, error)`, typed by the contract.
- An `Events` route that does not end is `feed<T>(path)`, on msw's `sse()`: orval's handler for it is useless. One
  that ends, read with `fetch` (a log, a compose run), is orval's handler with `events(items)` as its body.
- `countCalls()` counts the calls the page made, by `METHOD /path`.

```ts
const bell = feed<NotificationEvent>("/api/notifications/events");

network.use(
  getEnvReadMockHandler({ variables: { KEPT: "1", OLD: "3" } }),
  getEnvSaveMockHandler(async ({ request }) => {
    saved.push(await request.json()); // EnvChanges
    throw problem(400, "invalid variable name: 1BAD");
  }),
  bell.handler,
);
// ... bell.urls is ["/api/notifications/events?since=2&epoch=first"] once the page opened it
bell.send({ kind: "filed", notification });
```

- To assert `keepalive`, spy on `fetch`: msw's request loses it.
- `FakeEventSource` stays only for the tests that drive a lost stream and its reconnection: `stubEventSource()` puts it
  in place, and the rest is still answered by the network.
- Faker's answers are random: use them only for bodies the test never reads.
- Test the domain's `helpers/` directly, without rendering. Name a test after the behaviour it checks.

## The words: Paraglide, in English

Every word is a message of Paraglide JS 3 in `web/messages/en.json`, flat, English only, in Paraglide's typical Vite
setup with its defaults (ADR 0002, decision 5, as #214 amended it). There is no `t()` and no locale switch.

```
web/
  project.inlang/settings.json         base locale en, locales [en], the message format plugin from node_modules
  project.inlang/paraglide.config.ts   Paraglide's options: outdir alone, which its Vite plugin has no default for
  messages/en.json                     every message, flat
  src/paraglide/                       what Paraglide compiles: generated and gitignored, like orval's generated.ts
```

`paraglide-js init` writes the jsDelivr URL; Hangar loads the plugin from `node_modules`, pinned by the lockfile, so
that builds work offline, in CI and locally.

```json
{
  "apps_list_title": "Apps",
  "apps_logs_title": "Logs of {name}",
  "apps_list_selected": [
    {
      "declarations": ["input count", "local countPlural = count: plural"],
      "selectors": ["countPlural"],
      "match": { "countPlural=one": "{count} app selected", "countPlural=other": "{count} apps selected" }
    }
  ]
}
```

```ts
import { m } from "#paraglide/messages.js";

m.apps_list_title();
m.apps_list_selected({ count: view.selected.length });

// apps/helpers/apps-labels.ts: an enum's labels, typed by the contract
export const appsLabels = {
  status: {
    running: m.apps_status_running,
    partial: m.apps_status_partial,
    stopped: m.apps_status_stopped,
    unhealthy: m.apps_status_unhealthy,
  } satisfies Record<ProjectStatus, () => string>,
};
// <Badge>{appsLabels.status[project.status]()}</Badge>
```

- **Ids**: `<module>_<group>_<message>`, `snake_case`, three parts, the module whose pages show it first:
  `apps_logs_reconnect`, `common_shell_home_link`. A part may take several words (`apps_totals_running_containers`);
  no group nests in another; a message with no group gets one (`common_actions_retry`). The shell's are `common_`, a
  page's its section's module's.
- **Calls**: `m.<id>()` where the words are shown. No alias of a group (`const words = …`), no call at a module's top
  level: a table holds `m`'s functions. No `m[key]()`: `tsc` refuses it (TS7053), and every message would ship.
- **Params**: one object. No message is built from another's words: a compose outcome is one variant of
  `common_compose_outcome` on the operation and its two options, not fragments joined. A standalone label, a name or a
  whole sentence may be a param. A list of names is joined by the caller with `Intl.ListFormat`.
- **Types**: `tsc` checks the ids, the params' names and the missing ones, and types a selector of exact variants by
  them (`pull: "false" | "true"`). Any other param is `NonNullable<unknown>`: a wrong type compiles.
- **Plurals**: a message that counts takes the number; its forms are variants on it (`countPlural=one`, `=other`),
  and an exact `countExact=0` variant where English says 0 apart. No caller picks a form. A grouped number is
  `{count: number maximumFractionDigits=0}`.
- **Tables**: an enum's labels in the module's `helpers/<d>-labels.ts`, `satisfies Record<Enum, () => string>`. The
  tables keyed by code keep their place and call `m`: `error-message.ts` by `ErrorCode`, `notification-text.ts` by
  key, `upFlagSpecs`, `widgetLook`.
- **Adding one**: write it in `messages/en.json` beside its module's, then call it. The Vite plugin compiles it in
  `vite` and the tests, as virtual modules; `typecheck`, `lint` and `build` run `paraglide-js compile` first, to disk,
  so a missing id or param is a `tsc` error. Nothing imports `messages/en.json` itself: ESLint refuses it.
- **Options**: Paraglide's defaults, none written at its default value. The default strategy gives `en` and writes the
  cookie `PARAGLIDE_LOCALE`. An empty catalog (a plugin that does not load) fails `npm run build` at its `tsc`.
- **A second locale** keeps `setLocale`'s reload of the page: the React compiler caches what `m.x()` returned.
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
- ESLint's `no-restricted-syntax` flags a class made only of statics, and `no-restricted-imports` what a module's
  `helpers/` may not import (ADR rules 1 and 4), any import of another module, and any of `messages/en.json`.

## Lists

Do not virtualize: every list of the page is capped (a log at 5,000 lines, the bell at 30, the file tree at 500).
Reach for TanStack Virtual only for a list that can pass about a thousand rows uncapped. Then keep `useVirtualizer` in
a leaf component that takes plain props: the React compiler skips the component that calls it.
