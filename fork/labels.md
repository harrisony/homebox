# Beads Issue Label Taxonomy

Labels follow a strict colon-namespace scheme. Every issue gets exactly one
mandatory `area:` label; everything else is optional and scoped under a
prefix so a label's family is always visible in its name. No bare labels,
no synonyms — each concept has exactly one home.

**Mandatory — exactly one `area:` (the layer):**

| Label | Maps to |
|------|---------|
| `area:backend` | `backend/` — handlers, services, repos, ent, pkgs, sys, web |
| `area:frontend` | `frontend/` — pages, components, stores, composables, lib |
| `area:ci` | `mise.toml` task wiring (root, backend, frontend, docs), `mise-tasks/`, remaining `.github/workflows/`, Dockerfile variants |
| `area:docs` | `AGENTS.md`, `CLAUDE.md`, `fork/`, swaggo annotations, README |

**Optional — zero or more `scope:` (sub-kind under a layer):**

| Under | Labels |
|-------|--------|
| `area:backend` | `scope:handlers` `scope:services` `scope:repo` `scope:ent` `scope:web` `scope:sys` `scope:pkgs` `scope:migrations` |
| `area:frontend` | `scope:pages` `scope:components` `scope:stores` `scope:composables` `scope:lib` |
| `area:ci` | `scope:docker` `scope:github` `scope:mise` |
| `area:docs` | `scope:swag` `scope:agent` |

**Optional — zero or more `kind:` (nature of the change):**

`kind:test` · `kind:fix` · `kind:refactor` · `kind:feature` · `kind:dep-upgrade` · `kind:audit` · `kind:chore` · `kind:dead-code`

**Optional — zero or more `testing:` (when `kind:test` needs scoping):**

`testing:unit` · `testing:component` · `testing:integration` · `testing:e2e` · `testing:fuzz` · `testing:mutation` · `testing:coverage` · `testing:harness` · `testing:parallel`

Replaces the old bare `e2e`, `playwright`, `mutation-testing`, `coverage`, `fuzz`, `flakiness`, `harness`, `race` labels.

`testing:unit` and `testing:component` are both Vitest lanes; when the frontend gate is enabled,
both run in it, but they are different lanes and the distinction is the useful one. `testing:unit` is the `node`
environment: pure logic in `lib/`, `composables/` and `stores/`, no DOM, milliseconds.
`testing:component` is the `nuxt` environment: `mountSuspended`, happy-dom, `registerEndpoint`,
booting Nuxt from a `beforeAll` at roughly 4s warm and up to 120s cold. A `.vue` file that needs
the Nuxt Vite pipeline can only live in the second, and 84% of first-party components do.
Use `scope:components` for where the code lives, `testing:component` for which lane runs it.

**Optional — zero or more `concern:` (cross-cutting quality attributes):**

`concern:security` · `concern:observability` · `concern:privacy` · `concern:multitenancy` · `concern:performance` · `concern:accessibility`

`otel`/`metrics`/`pprof`/`health`/`slo` → `concern:observability`. `oidc`/`auth` security aspects → `concern:security`.

**Optional — zero or more `topic:` (the business domain):**

`topic:auth` · `topic:group` · `topic:entities` · `topic:attachments` · `topic:maintenance` · `topic:exports` · `topic:notifiers` · `topic:templates` · `topic:statistics` · `topic:reporting` · `topic:barcode` · `topic:tui`

Drawn straight from ent schema names and handler route groups.

**Optional — zero or one `track:` (provenance):**

`track:hardening` · `track:migration` · `track:audit` · `track:entity-refactor` · `track:e2e-baseline`

Where the work originated. `track:review-deferred` for deferred-decision work.

**Optional — zero or more `needs:` (the issue's claim is not yet witnessed):**

| Label | Means |
|-------|-------|
| `needs:runtime-witness` | The issue's **core claim** cannot be confirmed or refuted from source. Settling it needs a production build, a real browser, or an executed test lane. **Do not close, do not size, and do not cite as established** until a dynamic pass has run it. |
| `needs:measurement` | The **mechanism** is proven from source and is not in doubt; only the **magnitude** is unknown — bytes, request counts, milliseconds, or a site count derived from a multiplier rather than an edit. The defect is real and may be worked; its estimate and priority are unverified. |

Both compose with any `area:`/`kind:`/`concern:`. Remove the label when the witness exists and record the
measurement on the issue; do not re-label. Introduced by the 2026-08-06 frontend audit, which read the code
and ran no build, no browser and no test lane: see `fork/frontend-dynamic-pass-prompt.md` for the work order
that clears them.

**Optional — zero or one bare `human` (needs a person, not an agent):**

`human`

Marks work an agent must not simply pick up and complete: a design decision, a
judgment call, or anything that needs an opinion the tracker cannot supply.
Distinct from `track:review-deferred`, which records only that a decision was
postponed. A bead can carry both, meaning the call was deferred and is still
yours to make.

## Labeling rules

1. **Always assign an `area:`** — an issue without one is incomplete.
2. **Pick `scope:` only when it adds signal** — not every backend issue needs `scope:repo`. Use it when the layer alone is too coarse for a useful filter.
3. **`kind:` is what the PR does**, not the issue type — a `bug`-type issue whose fix is a test addition gets `kind:test`.
4. **`testing:` only with `kind:test`** — never standalone.
5. **`concern:` spans layers** — security/observability/privacy cross backend and frontend; `topic:` stays within a layer.
6. **`track:` is provenance only** — never use it as a substitute for a real `area:`/`kind:`/`topic:`.
7. **No bare labels, no synonyms** — if a concept seems to need a new label, place it under the right prefix: `testing:<name>`, `topic:<name>`, `concern:<name>`, `needs:<name>`. The prefix makes the family obvious and prevents drift. `human` is the single sanctioned exception, left unprefixed so it stands out in a list; do not add a second one.
8. **`needs:` is about evidence, not effort** — it says the issue's claim is unwitnessed, never that the work is large or blocked. An issue can be ready to pick up and still carry `needs:measurement`.
9. **Compose freely** — `br list --labels area:backend,scope:repo,kind:test` finds all repo-layer backend tests.
