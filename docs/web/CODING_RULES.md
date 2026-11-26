# Web coding rules

The Rust server's page is in `web/`: a Vite SPA in TypeScript 7, React with its compiler, TanStack Router and Query
on the hooks orval writes from the server's contract. Its design is [ADR 0002](../adr/0002-web-design.md): the layers,
where each kind of state lives, the streams, the errors, the forms and the tests against the API. This file does not
repeat it. The `hangar-web` skill gives the ADR in short.

The coding-team plugin's `lang-typescript` skill is the generic base: naming, the Handbook's rules, the traps. This
file says what Hangar adds to it or decides. Where the two differ, this file wins, and the ADR wins over both.

## Tooling

- **TypeScript 7**, `web/tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `verbatimModuleSyntax`. `npm run typecheck --prefix web` passes.
- **Prettier**, the root's config, which also sorts the imports. `npm run format` writes it, `npm run format:check`
  checks it.
- **ESLint**, the root's `eslint.config.js`, on Babel's parser: typescript-eslint refuses TypeScript 7. It holds the
  rules that need no types:
  - the blank lines of [Readability](#readability), which Prettier cannot add;
  - `eslint-plugin-react-hooks`, its `recommended-latest` set: the rules of hooks, `exhaustive-deps`, and the React
    compiler's rules (`purity`, `refs`, `set-state-in-effect`, `immutability`...);
  - core rules: `curly`, `eqeqeq` (`== null` allowed), `no-console` (`warn` and `error` allowed),
    `no-implicit-coercion`, `no-param-reassign` and `prefer-const`.

  `npm run lint` at the root runs it on `src/` and `web/src`, warnings as errors, and `npm run lint:fix` fixes what
  it can.

- **oxlint**, `web/.oxlintrc.json`, pinned with its `oxlint-tsgolint`. Its type-aware mode runs on typescript-go, the
  compiler of TypeScript 7. It holds its `correctness` category, with the type-aware rules in it (`no-base-to-string`,
  `no-redundant-type-constituents`...), and the rules that read types: `no-floating-promises`, `no-misused-promises`,
  `await-thenable`, `no-explicit-any`, `no-unnecessary-type-assertion`, `prefer-promise-reject-errors` and
  `switch-exhaustiveness-check`. It also holds `no-unused-vars`, since the core rule on Babel sees neither a name used
  in JSX nor one used only as a type, and `unbound-method`, as a method passed by reference loses its `this`.
  `npm run lint --prefix web` runs it, warnings as errors. It needs orval's `generated.ts`, so it runs after
  `cargo quoll gen`: CI's `web` job runs it after `cargo quoll build`.
- One rule, one tool: a rule is in ESLint or in oxlint, never in both.
- A rule is turned off only on the line that needs it, with its reason, in the comment of the tool that runs it. Never
  for a whole file.
  - An ESLint rule: `// eslint-disable-next-line react-hooks/purity -- <why>`.
  - An oxlint rule: `// oxlint-disable-next-line typescript/no-floating-promises -- <why>`. ESLint ignores that
    comment. An `eslint-disable` comment would silence oxlint too, but ESLint then fails on a rule it does not
    define.
- The ADR's own rules come with the PRs that make the code pass them (decision 10), in ESLint's core rules:
  - rule 1, `no-restricted-syntax`, on `web/src`: no class made only of static members;
  - rule 4, `no-restricted-imports`, on a module's root `.ts` (`modules/*/*.ts`, tests excepted): no React, no
    `lucide-react`, no `@tanstack/`, from `#libs/api` only the names that start with a capital (its types, enums and
    `ApiError`: orval's hooks, fetchers and keys and the transport's functions start with a lowercase letter), and only
    types from `api/`, `hooks/`, `components/` or `ui/`, by `#modules/...` or `./`; and `no-restricted-syntax`, on the
    same files, refuses an `import()` of those folders;
  - rules 2 and 3, the orval hooks and the `api/` imports, come with the data layer.

## Language

- **No `any`.** A value whose type is not known is `unknown`, narrowed before use.
- **No cast where the type can be narrowed.** Narrow with `typeof`, `in`, a type guard, `satisfies`, or a generic
  parameter where the API takes one: `screen.getByRole<HTMLButtonElement>("button")`, not
  `screen.getByRole("button") as HTMLButtonElement`. `as const` is no cast. A cast the checker cannot prove says why
  in a comment, as `use-widget-data.ts`'s on a generic union.
- **The boundary.** What the server sends is typed by the contract, through orval: never cast it to something else.
  What comes from elsewhere (`JSON.parse`, a cookie, storage, the URL, an `EventSource` frame) is `unknown` until a
  check reads it.
- **No non-null `!` on input.** A value from the server, the URL, the user or storage is narrowed, with its missing
  case handled. `!` is for what the code itself guarantees, as an index it just found.
- **Errors are typed and never swallowed.**
  - Throw `Error` or a subclass (`ApiError`). TanStack Router's `throw redirect(...)` is the one other thing thrown,
    as its API asks.
  - A `catch` narrows its `unknown` before reading it. It shows the failure (`describeError`, a form's
    error), logs it with `console.error` and what was being done, or throws it again. Never an empty `catch`.
- **Every promise is awaited, returned, or its rejection handled.** An async event handler catches its own failures
  and is passed as `event => void handleSubmit(event)`: `void` says that nothing waits for it, and the handler is
  where the failure goes. No `array.forEach(async ...)`.
- **A `switch` on a union writes every case.** A `default` does not stand for the ones left out, so that a value
  added to the union is a lint error at each `switch` on it. A lookup table typed `Record<Union, ...>` does the same
  for a value per case.
- **Modules.** ES modules, named exports. A default export only where a tool loads the file by it (`vite.config.ts`).
  `import type` for an import used only as a type, which `verbatimModuleSyntax` enforces.

## Modules and classes

As decided with ADR 0002 (decision 7), reversing the "Classes" section of AGENTS.md for `web/`:

- **What has no state is module functions and consts**: `filterProjects`, `describeSync`, `parseSettingsTab`. A
  function's name carries its context. There is no class made only of static members: lint rule 1 holds it.
- **What has state or dependencies is a class**, created with `new`, its dependencies as constructor arguments:
  `new Session(queryClient)`. Its one instance is created in `createPage`, and a test builds its own with `new`,
  with no module mock.
- **A helper of one hook that needs the hook's values is a closure of the hook**, not a class. One that several of
  its effects call is a module function beside it, taking what it needs (`changeNotifications(queryClient, change)`),
  rather than a closure each effect would list, which `exhaustive-deps` asks to wrap in a `useCallback`.
- `static` stays only for a real factory or constant of a class that has instances: `Preferences.fromCookies`,
  `WidgetIcon.dashboard`.
- `ApiError extends Error` and the test doubles with instances are classes as before.
- The layers, what each may import, and where the code of a page goes are the ADR's decision 1.

## React

- **The compiler is on** (`babel-plugin-react-compiler`, through `vite.config.ts`, in the build and in the tests). It
  memoizes every component and hook. There is no `useMemo`, `useCallback` or `memo` written for speed: they only
  add noise.
- **Its rules are errors.** A component that breaks one is compiled wrong, or not at all, so the lint rule is fixed,
  not turned off:
  - Render is pure. No `Math.random()` or ref read during render.
  - **No function called during render reads the clock**, the component's own code or a helper it calls. The
    compiler keeps what a call returned for as long as its arguments stay the same: a time written from a clock read
    in render stops moving. A function that writes a time relative to now takes `now` as a required argument, as
    `relativeTime(at, now)`, with no `Date.now()` default. A component passes it `useNow()`
    (`common/hooks/use-now.ts`), the clock as state, read again every 15 seconds; a test or code outside React passes
    an explicit time. One `useNow()` for a card or a list, handed to its rows, not one per row.
  - An effect synchronizes with something outside React. It does not set state in its body: state that starts over
    when an input changes is reset during render, by comparing with the input it was for (as `use-log-events.ts`
    does), or by a `key` on the component.
- **The rules of hooks hold.** A hook is called at the top level of a component or a hook, in the same order at each
  render: never in a condition, a loop, a callback or after an early return.
- **An effect lists what it reads** (`exhaustive-deps`). A handler it calls without reconnecting when the handler
  changes is a `useEffectEvent`.
- One tree, never one per breakpoint: AGENTS.md's "Responsive layouts".

## Readability

Moved here from AGENTS.md, for `web/` and, until #181 removes it, `src/`. Write code for the next human reader.
Clarity beats cleverness and brevity.

- Follow the project first: match existing conventions, naming, structure and tooling; run the formatter and linter
  before finishing.
- Names: say what and why (`elapsedDays`, `isEligibleForRefund`). No `data`, `tmp`, `util`, `manager`, invented
  abbreviations, or misleading names. One word per concept. The context is said once: a module function carries it
  in its name (`describeError`), a class member in its class and the method the action (`session.require()`, not
  `session.requireSession()`).
- Functions: small, one job, one level of abstraction; ≤ 3–4 parameters; no boolean flags that switch behavior.
- Control flow: early returns, nesting ≤ 3, complex conditions extracted into named variables. No nested ternaries
  or clever one-liners. Every `if`, `else` and loop body is a braced block on its own lines, even a lone `return`
  (`curly`).
- Blank lines: one after a multi-line statement, after a group of declarations, and before a `return` that is not
  alone in its block. `npm run lint:fix` applies them; Prettier sorts the imports.
- Structure: put code where a newcomer would look for it; no god files or growing `utils`; dependencies flow one
  way.
- Duplication: one place per rule or constant, but no premature abstraction; a little repetition beats a helper full
  of options.
- Comments: explain why, never what. No commented-out code, no stale comments, no TODO without context. Document
  public APIs: every export has a JSDoc comment with a one-line summary.
- Data: explicit types and shapes; named constants instead of magic numbers or strings.
- Errors: never swallow them; add context; keep the happy path readable.
- Scope: change only what the task needs; keep refactors separate from behavior changes.

## Tests

- Vitest, with happy-dom and Testing Library. A test sits next to its code, as `name.test.ts` or `name.test.tsx`.
- A test's name says the behavior it checks: "reads the log again from its tail on Reconnect", not "reconnect
  works".
- Its setup is visible in the test: what the server answers, the clock, the route. A shared fixture is a plain value
  or a function the test calls, not a `beforeEach` that hides what the test depends on.
- The domain's root `.ts` is tested directly, without rendering.
- The API is answered at the network, by orval's MSW handlers, as the ADR's decision 13 says: a call no handler
  answers fails the test. Until the data layer brings them, tests use `app/mock/page.tsx`'s `serve`, which is not
  extended.
- The clock is the fake timers' (`vi.useFakeTimers({ now })`), not a prop added for the test.
- A fixed bug gets the test that fails without its fix.
