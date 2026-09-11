# Plan: Reduce duplication in `src/app`

## Context

`src/app` contains several likely parallel implementations, notably authentication forms and navbar/sidebar search controls. The goal is to identify genuine duplication, extract reusable behavior or presentation at the narrowest useful boundary, and preserve current routes, UX, accessibility, and server/client behavior.

Confirmed hotspots:

- `login-form.tsx` and `register-form.tsx` repeat the auth card shell, error alert, submit state, email/password fields, and alternate-route footer.
- All five app pages repeat the same layout classes on their route-owned `<main>`. The `<main>` elements and route-specific content should remain in each page, while their shared direct-child styling belongs in `(app)/_layout.tsx`.
- The two theme preference rows in `theme-settings-card.tsx` have identical dropdown composition.
- `InstallAppResult` and `StoreActionResult` are structurally identical; worse, the server action currently imports its result type from a client component.
- Store installation and store synchronization duplicate result/catch toast handling.
- A complete sidebar navigation, its search box, the generated sidebar UI primitive, and the mobile hook are currently unreachable; this overlaps the active navbar navigation rather than representing a second live caller.
- Framework route `getConfig` exports and desktop/mobile navigation rendering are similar but intentional: Waku discovers config per route, while each navigation uses different accessible UI primitives.

## Approach

1. Keep semantic `<main>` elements in each route, but move their common direct-child layout styling into `src/app/pages/(app)/_layout.tsx`; keep route-specific titles, headings, descriptions, and content in each page.
2. Extract the repeated theme preference dropdown row as a private, typed component in the existing settings module.
3. Establish one app-layer store mutation result type and one toast helper for store actions; keep transition state and post-success state updates local to each card.
4. Remove unreachable legacy sidebar/starter code and its orphaned shadcn sidebar primitive/mobile hook, rather than coupling dead code to the active navbar through a premature abstraction.
5. Preserve intentional repetition in per-route Waku configuration and the distinct desktop/mobile navigation renderers.
6. Do not modify `src/libs`, generated `pages.gen.ts`, or active shadcn primitives.

## Files to modify

Expected changes:

- `src/app/components/auth/login-form.tsx`
- `src/app/components/auth/register-form.tsx`
- New `src/app/components/auth/auth-form-card.tsx`
- `src/app/pages/(app)/_layout.tsx`
- `src/app/pages/(app)/index.tsx`
- `src/app/pages/(app)/apps.tsx`
- `src/app/pages/(app)/store.tsx`
- `src/app/pages/(app)/settings.tsx`
- `src/app/pages/(app)/user/settings.tsx`
- `src/app/components/settings/theme-settings-card.tsx`
- `src/app/actions/install-app.ts`
- `src/app/actions/manage-store.ts`
- New `src/app/actions/store-action-result.ts`
- `src/app/components/store/store-app-card.tsx`
- `src/app/components/settings/store-settings-card.tsx`
- New `src/app/components/store/store-action-toast.ts`

Files to remove:

- `src/app/components/sidebar/sidebar.tsx`
- `src/app/components/sidebar/searchbar.tsx`
- `src/app/components/sidebar/sidebar-header.tsx`
- `src/app/components/ui/sidebar.tsx`
- `src/app/hooks/use-mobile.ts`
- `src/app/components/header.tsx`
- `src/app/components/footer.tsx`

## Reuse

Existing reuse points identified so far:

- `src/app/components/card/accent-card.tsx`
- UI primitives in `src/app/components/ui/`, including `field.tsx`, `input-group.tsx`, `alert.tsx`, `spinner.tsx`, and `card.tsx`

Concrete reuse decisions:

- Continue composing `Card`, `FieldGroup`, `Alert`, `Button`, and `Spinner` from the installed shadcn primitives rather than reproducing their markup.
- Keep using `Card` from `src/app/components/card/accent-card.tsx` as the common branded card surface.
- Keep `navigations` from `src/app/navigations.ts` as the single source of navigation labels, routes, and icons; do not unify distinct desktop tabs and mobile sheet markup.
- Keep the active `NavbarSearch` shared by desktop and mobile navbar contexts.

## Steps

- [x] Keep `<main>` in each of the five app pages, move the repeated `flex flex-1 flex-col gap-6` behavior to the existing `(app)/_layout.tsx` content container via direct-child styling, and remove only the duplicated `className` values from the pages. Keep each page’s `<title>`, optional heading/description, content, and the dashboard’s lack of a visible heading local to the route; do not add page-shell components.
- [x] Extract an `AuthFormCard` shell for the repeated header, error alert, pending submit button, and alternate-auth link; leave login/register FormData parsing, password confirmation, auth-client calls, and route text in their feature files.
- [x] Add explicit `AuthEmailField` and `AuthPasswordField` components alongside `AuthFormCard`, parameterized only by pending state and password autocomplete mode; do not build a schema/config-driven universal form.
- [x] Replace the two duplicated theme dropdown blocks with a private typed `ThemePreferenceField`, retaining the existing atoms and validation guards.
- [x] Move the common `{ success, installed, message }` contract into `src/app/actions/store-action-result.ts` and consume it from both server actions and both client cards, eliminating the action-to-component type dependency.
- [x] Extract store action toast formatting/transport-failure handling into an app-layer helper while leaving pending transitions and `installed` state updates in each card.
- [x] Delete the unreachable sidebar implementation/search/header stub, Waku starter header/footer, and the `ui/sidebar.tsx` plus `use-mobile.ts` files used only by that dead implementation.
- [x] Format touched files consistently (including existing quote/semicolon drift in auth route files) and update imports without changing behavior.
- [x] Add focused tests only for extracted logic with meaningful branching; avoid snapshot tests for thin composition components.

## Verification

- Run TypeScript/LSP diagnostics on all changed files.
- Run `npm test` (project uses Vitest); no snapshot-only tests will be added for thin composition components.
- Run `npm run build` to validate Waku server/client boundaries, deleted-module references, and generated route integration.
- Search for imports of every deleted file to confirm no references remain.
- Manually verify login and registration (success, API error, password mismatch, and pending states); desktop/mobile navbar navigation and search; store install/sync success and failure feedback; all app-page headings; theme palette/mode selection; loading and empty states.
