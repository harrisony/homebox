# frontend/AGENTS.md

Nuxt 4 SPA (`ssr: false`, so `build` is `nuxt generate`) with Vue 3 and
TypeScript. Read the root `AGENTS.md` first for mise, codegen and env rules;
component authoring conventions live in [`components/AGENTS.md`](components/AGENTS.md).

Top-level dirs are Nuxt-3-style — there is no `app/` directory flip.
Tailwind 3 + shadcn-vue, Pinia, vue-i18n, `@vite-pwa/nuxt`.

pnpm 11 comes from corepack via the `packageManager` field, which is the single
source of truth — do not add pnpm to `[tools]`.

## Critical constraints

- `lib/api/types/data-contracts.ts` is generated from the backend swagger — never
  edit it; run `mise run //:generate`. Hand-written API types go in its sibling
  `non-generated.ts`, which sits beside it and is yours to edit, or beside their
  consumers.
- Add new translation keys to `locales/en.json` only. Weblate manages the other
  locale files.
- Composables are available through Nuxt auto-imports, but explicit imports are
  also used. Follow the surrounding file.
- Components are **not** auto-imported. Every component outside `components/ui`
  needs an explicit import.
- ShadCN components under `components/ui` are globally registered and used
  without imports. Add registry components with
  `mise run //frontend:shadcn -- add <name>` rather than hand-writing them, and
  leave registry files' formatting alone (see Lint). First-party files live
  *inside* those registry directories, so the directory name is not the signal —
  check a file's provenance before editing it.
- `mise run //frontend:lint:fix` runs ESLint and Prettier across the entire
  frontend, not just changed files, and can rewrite unrelated dirty work. Use it
  deliberately, and inspect the working-tree diff afterward.
- Add a frontend mise task for any new manually invoked `package.json` script.
  Lifecycle scripts do not need standalone tasks.

## API clients

Use `useUserApi()` for authenticated requests. Use `usePublicApi()` for login,
registration, and status requests.

## Code conventions

- Use `<script setup lang="ts">` and the Composition API.
- Export composables and utilities as named function declarations. Use named
  module exports except where Nuxt requires a default export.
- Use theme tokens instead of raw Tailwind colors. Prefer Tailwind utilities;
  write custom CSS only when utilities cannot express the behavior.

## Lint, types, format

`mise run //frontend:gate` is the required check for frontend application
changes.

    mise run //frontend:lint       # check
    mise run //frontend:lint:fix   # eslint --fix + prettier --write
    mise run //frontend:typecheck

`typecheck` runs `nuxt prepare` first, and the ESLint flat config extends
`.nuxt/eslint.config.mjs`, so **`nuxt prepare` must have run** before either
works in a fresh checkout.

**ESLint suppressions baseline**: `.eslint-suppressions.json` records known
violations so the gate can fail on *new* ones. `lint:fix` passes
`--prune-suppressions`, which drops entries you fixed. **Do not run
`lint:baseline` to silence errors you just introduced** — it re-suppresses
everything. Fix the underlying issue, or add a specific
`eslint-disable-next-line` with a reason.

Typed linting sits at `recommended-type-checked`, not the strict tier — a
recorded decision, not an oversight. The gate also enforces the Playwright rules.

`components/ui/**` is mostly registry-generated: Prettier ignores it, and ESLint
exempts it from `tailwindcss/classnames-order`, `tailwindcss/enforces-shorthand`
and `vue/require-default-prop`, because enforcing project style there would
rewrite every file on the next `shadcn-vue add`. Only those style rules are off —
correctness linting stays on, which is what covers the first-party files mixed in.

Config blocks in `eslint.config.mjs` are **named** (`homebox/*`) — target them by
name, never by array index.

Prettier runs standalone, not through ESLint; config is
`frontend/prettier.config.mjs`.

## Test lanes

Vitest 4 uses three projects in `test/vitest.config.ts`; Playwright is the
separate E2E lane. **The filename decides the lane** — get it wrong and the test
silently never runs.

| Lane | Command | Files | Needs |
|---|---|---|---|
| Unit | `mise run //frontend:test:unit` | `*.test.ts` co-located under `lib/`, `composables/`, `stores/` | node; nothing running |
| Component | `mise run //frontend:test:component` | `*.nuxt.test.ts` under `components/` and `test/nuxt/` | real Nuxt + happy-dom; nothing running |
| Integration | `mise run //frontend:test:integration` | `lib/api/__test__/**/*.test.ts` | live **non-demo** backend on `:7745` |
| E2E | `mise run //:test:e2e` | `test/e2e/**/*.spec.ts` | built combined binary on `:7745` |

`.spec.ts` belongs to Playwright and is deliberately excluded from the Vitest
ESLint plugin's scope — never name a Vitest test `.spec.ts`.

    mise run //frontend:test                      # unit + component, nothing running
    mise run //frontend:test:unit -- lib/api/base/base-api.test.ts -t "name"
    mise run //frontend:test:component -- components/Foo/Foo.nuxt.test.ts
    mise run //frontend:test:integration          # start //backend:run:test elsewhere first
    mise run //:test:e2e -- test/e2e/items.browser.spec.ts --project=chromium

Other lanes: `//frontend:test:coverage` (unit coverage with v8),
`//frontend:test:ci` (all Vitest projects, requires a backend),
`//frontend:test:local` (the same lanes, but it takes file filters), and
`mise run //:test:ci`, which builds and starts the backend first. Address that
one as `//:test:ci`, never bare: a bare `test:ci` from `frontend/` resolves to
`//frontend:test:ci`, which starts no backend.

For the integration lane standalone, run `mise run //backend:run:test` in
another terminal — it is non-demo with its own isolated data dir. No Vitest lane
stops a server it did not start; `//:test:ci` signals only the PID it recorded.

Vitest aliases (`@`, `~`, `~~`) are hand-declared in `test/vitest.config.ts` on
purpose; `vite-tsconfig-paths` was tried and rejected (broke `~/lib`).

A lane dying while it loads `test/vitest.config.ts` (typically
`ERR_MODULE_NOT_FOUND` on `@nuxt/test-utils`) usually means stale `node_modules`
rather than a broken test — run `mise run //frontend:install` first. The lane
tasks depend on `:install`, but pnpm 11 aborts with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` when it must purge the modules dir
without a TTY, so run it from a real terminal (or prefix `CI=true`). A fresh
worktree hits this until it is installed once.

### Lane selection

- Use **unit** for requests, utilities, formatters, stores, and composable logic that does
  not need Nuxt or the DOM. Stub the typed client or `globalThis.fetch` directly.
- Use **component** for rendering that needs Nuxt injection, auto-imports, ShadCN UI,
  `useNuxtApp`, or i18n.
- Use **integration** for the typed API client against the real backend.
- Use **E2E** for full-stack user journeys. Do not replace it with
  `@nuxt/test-utils/playwright`.

Unit and component tests sit beside the code they test, except component tests not
tied to one component, which live under `test/nuxt/`. Integration tests live under
`lib/api/__test__/`; E2E tests live under `test/e2e/`.

### Component tests

Use:

- `mountSuspended(Comp, { props })` for async setup and Nuxt injection.
- `registerEndpoint("/api/...", handler)` for native Nitro API mocks. Do not add MSW.
- `mockNuxtImport("useFoo", factory)` and `mockComponent(...)` for auto-imports or heavy
  child components.

Keep `environment: "nuxt"` scoped to the component project. Applying it globally would
also boot Nuxt for the unit and integration projects. The lane's `hookTimeout` is a
ceiling for a cold Nuxt boot, not a delay — do not lower it.

### E2E and browser validation

Use helpers exported by `test/e2e/helpers/` and import `{ test, expect }` from
`./helpers`. Each test receives an isolated user and API seeder. Browser authentication
uses server-set session cookies; API fixture setup uses its bearer token separately.

`workers: 2` in `test/playwright.config.ts` is a hard cap: SQLite is a single writer, and
more workers make registration and fixture setup flake. `serviceWorkers: "block"` because
the PWA service worker breaks `page.route()` on firefox/webkit.

`mise run //:test:e2e` is the canonical lane. mise builds the frontend into the backend and
compiles the combined binary; Playwright's `webServer` block starts it, waits on
`/api/v1/status`, and stops it. It does not need Nuxt on `:3000`. Playwright refuses to
start over an existing server rather than adopting one (`reuseExistingServer: false`), so a
stray server on `:7745` fails the run with `:7745 is already used` instead of silently
supplying demo-mode responses.

That server runs with `HBOX_DEMO=false`, so E2E reaches the endpoints demo mode blocks:
wipe-inventory, change-password, reset-password, user delete and import. Do not mock those
to work around a 403. Demo-mode behaviour is asserted in the backend handler tests, and a
spec that needs the frontend's demo branch mocks `/api/v1/status` (see
`test/e2e/wipe-inventory.browser.spec.ts`).

Set `E2E_BASE_URL` only to point at a server you started yourself; it switches the
`webServer` block off, leaving the lifecycle entirely to you. That is the route for
debugging against the Nuxt dev server on `:3000`: start `mise run //frontend:dev` in a
long-running process you own, run the backend separately, and inspect `:3000` first. Stop
only processes you started. The mise task supplies the required temporary-directory setup.

For manual browser validation, exercise the changed interaction and its relevant error,
empty, and edge states. Inspect the browser console, and apply the root
[Discovered defects](../AGENTS.md#discovered-defects) policy.

## Build

`mise run //frontend:build` runs `nuxt generate` and produces the static frontend used by
the combined backend application.
