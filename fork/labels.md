# HomeBox issue label rules

This file extends the issue-tracking rules in `AGENTS.md` with the canonical
labels used by HomeBox. Use it whenever creating an issue or changing its labels.
Labels classify work. They do not replace issue type, status, priority, assignee,
or dependencies.

For general tracker operation, run `br robot-docs guide`. This file contains
HomeBox label policy only.

## Routine path

For a leaf implementation issue, assign exactly one `area:` and one `kind:`.
Add other classification labels only when they improve a recurring query. Use
only labels listed here. Before claiming or closing, obey any `needs:`, `review:`,
or `human` restriction.

## Required behavior

1. Use only labels listed in this file. Do not invent a label because its prefix
   looks valid.
2. Label every new or actively maintained issue according to this contract. Do
   not relabel tombstones.
3. Label each issue independently. Parent labels do not automatically apply to
   child issues.
4. Do not add, remove, or rewrite labels merely because you inspected an issue.
5. Apply this contract in every worktree. An issue ID prefix or worktree name
   does not create a separate label vocabulary.

## Native tracker fields

Use native tracker fields before labels. Labels add classification or agent
control that the native model does not express.

| Native field | Relationship to labels |
|---|---|
| `issue_type` | Describes the tracker object. Canonical values are bug, task, feature, epic, chore, question, and docs; the schema also permits configured or forward-compatible strings. `kind:` describes the primary delivered change and may differ. A bug resolved by adding a missing test is `issue_type=bug` with `kind:test`. |
| `status` | Describes lifecycle. A control label may forbid closure, but it does not create a new status. |
| `priority` | Describes urgency. Do not encode urgency in a label. Treat priority based on an unknown magnitude as provisional while `needs:measurement` applies. |
| `estimate` | Describes expected effort. Do not size an unwitnessed claim carrying `needs:runtime-witness`. |
| `defer_until` or deferred status | Schedules when work returns to the queue. `review:deferred` records deferred maintainer review; it is not a scheduling substitute. |
| `assignee` | Records ownership. `review:in-depth` requests maintainer review but does not assign the issue. |
| Dependencies | Record structural blockers. `needs:` and `human` constrain agent behavior but do not replace dependencies. |

## Selection procedure

Apply labels in this order:

1. Classify the issue as an implementation issue, coordinating epic, or
   question/decision.
2. Select the required `area:` label. Use multiple areas only for a coordinating
   epic.
3. Select one primary `kind:` when the issue delivers an implementation change.
4. Add `scope:`, `testing:`, `concern:`, `topic:`, and `track:` labels only when
   they improve a useful query.
5. Apply `needs:`, `review:`, or `human` when they change what an agent may claim,
   assert, or close.
6. Check cardinality and compatibility before writing.

| Issue class | `area:` | `kind:` |
|---|---:|---:|
| Leaf implementation issue | Exactly one | Exactly one |
| Coordinating epic | One or more | Zero or one |
| Question or decision | Exactly one | Zero or one |

An implementation issue is a leaf issue whose deliverable changes code, tests,
configuration, generated artifacts, or documentation. A coordinating epic may
carry multiple `area:` labels when its children belong to different layers.
Keep implementation children single-area. If a leaf issue has two independent
primary areas, split it.

## Label family contract

| Family | Cardinality | Lifecycle | Purpose |
|---|---:|---|---|
| `area:` | Defined above | Persistent | Primary ownership layer |
| `scope:` | Zero or more | Persistent | Location within an area |
| `kind:` | Defined above | Persistent | Primary outcome of the work |
| `testing:` | Zero or more | Persistent | Test lane or test property affected |
| `concern:` | Zero or more | Persistent | Cross-cutting quality attribute |
| `topic:` | Zero or more | Persistent | Product domain or bounded surface |
| `track:` | Zero or more | Persistent | Initiative or investigation that originated the work |
| `needs:` | Zero or more | Remove when witnessed | Evidence missing from the issue's claim |
| `review:` | Zero or one | Maintainer-managed | Requested maintainer review state |
| `human` | Zero or one | Remove after the decision | Agent execution boundary |

Persistent means the label remains useful after the issue closes. A transient
label must have an explicit removal event recorded on the issue.

## Areas

Choose the primary owner of the deliverable, not every directory that a change
might touch incidentally.

| Label | Use for |
|---|---|
| `area:backend` | `backend/`: API, handlers, services, repositories, Ent, packages, system integrations, and migrations |
| `area:frontend` | `frontend/`: pages, components, stores, composables, client libraries, and frontend tooling |
| `area:ci` | Build, test, release, container, and automation wiring in `mise.toml`, `mise-tasks/`, `.github/workflows/`, and Dockerfile variants |
| `area:docs` | Repository prose and agent guidance, including `AGENTS.md`, `CLAUDE.md`, `README`, `fork/`, and Swagger annotations |

Generated API artifacts follow the task that owns their generation. Do not add a
second area only because a generator updates another directory.

## Scopes

Use a scope only when it makes an area query materially more precise. A scope is
valid only with an area listed in the same row. Coordinating epics should usually
leave scopes to their children.

| Area | Allowed scopes |
|---|---|
| `area:backend` | `scope:app-api` `scope:routes` `scope:handlers` `scope:services` `scope:repo` `scope:ent` `scope:web` `scope:sys` `scope:pkgs` `scope:migrations` |
| `area:frontend` | `scope:pages` `scope:components` `scope:stores` `scope:composables` `scope:lib` `scope:tooling` |
| `area:ci` | `scope:docker` `scope:github` `scope:mise` |
| `area:docs` | `scope:swag` `scope:agent` |

Backend scope boundaries:

| Label | Boundary |
|---|---|
| `scope:app-api` | API application bootstrap and runtime under `backend/app/api/`, excluding a more specific child scope when one is sufficient |
| `scope:routes` | Route registration, routing middleware, or route-level integration behavior |
| `scope:handlers` | HTTP controllers and request/response handling |
| `scope:services` | Business services and orchestration |
| `scope:repo` | Persistence repositories and query behavior |
| `scope:ent` | Ent schemas, hooks, policies, and generated Ent behavior |
| `scope:web` | Backend web or embedded static-serving behavior |
| `scope:sys` | Operating-system and process integration |
| `scope:pkgs` | Reusable backend packages that do not fit a narrower scope |
| `scope:migrations` | Database schema or data migrations |

Frontend and operational scopes map directly to the named directory or tooling
surface. `scope:tooling` covers frontend-local compiler, linter, bundler, and
package-manager configuration. Use `area:ci` instead when the primary deliverable
is repository-wide automation.

## Kinds

Choose exactly one primary outcome for an implementation issue. Tests added as
part of a fix do not make the issue `kind:test`; use `testing:` to record the
affected lane.

| Label | Use when the primary deliverable is |
|---|---|
| `kind:fix` | Correcting behavior that is wrong |
| `kind:feature` | Adding user-visible or operator-visible capability |
| `kind:refactor` | Restructuring while preserving intended behavior |
| `kind:test` | Adding or changing tests, fixtures, or test infrastructure |
| `kind:dep-upgrade` | Changing dependency versions and required compatibility work |
| `kind:audit` | Producing findings, measurements, or a triage result |
| `kind:chore` | Maintenance with no intended behavior change and no more specific kind |
| `kind:dead-code` | Removing unreachable, unused, or obsolete code |

## Testing

`testing:` is independent of `kind:`. Add it whenever the affected test lane or
property is useful to query.

| Label | Use for |
|---|---|
| `testing:unit` | Isolated logic tests without a Nuxt runtime or external service |
| `testing:component` | Vue or Nuxt component tests that require the Nuxt Vite pipeline or DOM environment |
| `testing:integration` | Tests across application boundaries or against a live backend/database |
| `testing:e2e` | Browser-driven, full-stack user flows |
| `testing:fuzz` | Fuzz targets and fuzz-discovered behavior |
| `testing:mutation` | Mutation testing and surviving-mutant work |
| `testing:coverage` | Closing an identified behavioral coverage gap |
| `testing:harness` | Test setup, fixtures, runners, orchestration, or environment ownership |
| `testing:parallel` | Parallel execution, isolation, ordering, or shared-state behavior |
| `testing:race` | Race-detector execution or a test specifically exposing a data race |
| `testing:flakiness` | Nondeterministic test behavior and its diagnosis |

For frontend tests, use `testing:unit` for the `node` lane: pure logic in
`lib/`, `composables/`, and `stores/`, with no DOM, Nuxt runtime, or backend.
Use `testing:component` for the Nuxt and happy-dom lane, including
`*.nuxt.test.ts`, `mountSuspended`, and `registerEndpoint`. The component lane
boots Nuxt and is materially slower and more cold-cache-sensitive. Do not use it
when the unit lane can express the behavior.

Use `scope:components` for where component code lives and `testing:component`
for the lane that exercises it. They are independent dimensions.

## Concerns

Concerns cross ownership layers. Add more than one when each is material to the
issue's acceptance criteria or risk.

| Label | Includes |
|---|---|
| `concern:security` | Authentication, authorization, OIDC security, secrets, injection, and unsafe trust boundaries |
| `concern:observability` | Logs, metrics, OpenTelemetry, profiling, health checks, and service-level signals |
| `concern:privacy` | Personal data collection, exposure, retention, and deletion |
| `concern:multitenancy` | Collection, account, or tenant isolation |
| `concern:performance` | Latency, throughput, memory, allocation, bundle size, and request volume |
| `concern:accessibility` | Keyboard, screen-reader, contrast, semantics, and assistive-technology behavior |

Do not replace a product topic with a concern. An authentication issue may carry
both `topic:auth` and `concern:security` when both dimensions matter.

## Topics

Topics describe the product domain or bounded user-facing surface. They may be
used with backend, frontend, CI, or docs areas.

| Label | Boundary |
|---|---|
| `topic:auth` | Login, sessions, credentials, OIDC, API keys, and password recovery |
| `topic:users` | User profile, account settings, account lifecycle, and user identity data outside authentication mechanics |
| `topic:group` | Collections, membership, invitations, and group settings |
| `topic:entities` | Items, locations, tags, entity types, and their relationships |
| `topic:attachments` | Attachment upload, storage, retrieval, and deletion |
| `topic:maintenance` | Maintenance entries, schedules, and status |
| `topic:exports` | Import, export, backup, and restore flows |
| `topic:notifiers` | Notification destinations and delivery configuration |
| `topic:templates` | Entity templates and template fields |
| `topic:statistics` | Computed counts, summaries, and dashboard statistics |
| `topic:reporting` | Reports and report generation |
| `topic:barcode` | Barcodes, QR codes, scanning, and label generation |
| `topic:tui` | The terminal interface surface, not general frontend work |

Topics are controlled product groupings, not one label per Ent schema, handler
file, or route segment. Use these canonical mappings:

| Source term | Canonical topic |
|---|---|
| Tags, locations, entity types, asset IDs | `topic:entities` |
| User profile and account settings | `topic:users` |
| API keys, tokens, passwords, login, sessions | `topic:auth` |
| Group invitations and membership | `topic:group` |
| Imports, exports, backups, restores | `topic:exports` |

For work spanning two material domains, apply both topics. For a one-off source
term that fits an existing product grouping, reuse the grouping rather than
minting a source-shaped label. If no listed topic fits, omit `topic:` and keep the
domain detail in the title or description. Do not invent a topic during issue
creation.

## Tracks

Tracks record durable provenance. Multiple tracks are allowed when an issue was
genuinely produced by more than one initiative.

| Label | Provenance |
|---|---|
| `track:hardening` | Proactive correctness, reliability, or security hardening |
| `track:migration` | Migration from an older implementation, tool, or architecture |
| `track:audit` | A structured audit or review produced the issue |
| `track:entity-refactor` | The entity-model refactor initiative |
| `track:e2e-baseline` | The browser-test baseline initiative |

Review state is not provenance. Use `review:` labels for maintainer review state.

## Agent control labels

These labels change what an agent may do. Apply their rules even when the issue
is otherwise ready.

Labels restrict otherwise-authorized work. They never grant permission to
implement, commit, mutate external state, or expand task scope.

| Label | Investigation | Label-specific implementation restriction | Closure rule | Removal |
|---|---:|---:|---:|---|
| `needs:runtime-witness` | Obtain the witness | Do not implement the alleged fix before the core claim is witnessed | Do not close until witnessed and normal closure criteria pass | Remove after recording executed evidence |
| `needs:measurement` | Measure the magnitude | None | Close only when normal closure criteria also pass | Remove after recording the measurement |
| `review:in-depth` | Allowed within task scope | None | Agent must not close | Maintainer removes after review |
| `review:deferred` | Allowed within task scope | None unless `human` also applies | Agent must not close | Maintainer replaces or removes when review resumes |
| `human` | Read-only investigation; do not make the decision | Do not implement work that depends on the decision | Agent must not close | Maintainer removes after supplying the decision |

### Evidence labels

Use `needs:runtime-witness` when the issue's core claim cannot be confirmed or
refuted from source. The required witness may be a production build, a real
browser, a live service, or an executed test lane. Do not size the work, cite the
claim as established, or close the issue until the witness exists.

Use `needs:measurement` when the mechanism is established but its magnitude is
not. The unknown may be bytes, requests, milliseconds, allocations, or affected
sites. The issue may be implemented, but estimates and priority based on the
unknown magnitude remain provisional.

When evidence exists, add a comment containing the command or procedure, result,
environment, and relevant measurement. Then remove the applicable `needs:`
label. Do not replace one evidence label with the other unless the new label's
definition independently applies.

### In-depth review handoff

`review:in-depth` does not prohibit claiming, implementation, validation, or an
otherwise-authorized commit. It does not grant any of those actions. The agent
must not close the issue. Before handing it back, add a comment containing:

- The commit or exact diff to review.
- The behavior changed.
- Validation commands and results.
- Material design decisions.
- Residual risks, known gaps, and intentional non-changes.

Only the maintainer removes `review:in-depth` and closes the issue, or explicitly
authorizes an agent to do so after review. Leave completed work in progress while
it waits for that review unless the maintainer directs another status.

`review:deferred` means the maintainer postponed review. It is not part of the
active review queue. Combine it with `human` when work cannot proceed without the
postponed decision.

## Reserved labels

`human` is the only permitted bare label. `doctor:*` is reserved for tracker
diagnostics. Do not add or remove a `doctor:` label outside the diagnostic
workflow that owns it.

## Machine output contracts

Do not guess the JSON envelope returned by a `br` read command. Ask the installed
binary for its current parse contract:

```sh
br schema commands --format json |
  jq '.commands | {list, show, label_list: .["label list"]}'
```

Each command entry reports `shape`, `jq_filter`, `items_at`, `item_schema`, and
whether structured errors appear on stderr. When an entry names an item schema,
inspect that definition only when its field contract matters:

```sh
br schema all --format json | jq '.schemas.IssueWithCounts'
```

These schemas describe the installed binary and may change with `br`. Query them
at runtime instead of copying their full contents into this file. The label
queries below match the currently installed contracts.

## Label queries

Query with AND semantics by repeating `--label`:

```sh
br list \
  --label area:backend \
  --label scope:repo \
  --label kind:test \
  --json |
  jq '.issues[]'
```

Query the complete in-depth review queue, including closed and deferred records:

```sh
br list --all --deferred --label review:in-depth --json |
  jq '.issues[]'
```

Inspect one issue's labels. The label-list contract is an array:

```sh
br label list <issue-id> --json | jq '.[]'
```

Inspect the project label inventory:

```sh
br label list-all --json
```

## Examples

| Work | Labels |
|---|---|
| Backend handler bug with a regression test | `area:backend` `scope:handlers` `kind:fix` `testing:unit` |
| Frontend component test coverage | `area:frontend` `scope:components` `kind:test` `testing:component` `testing:coverage` |
| Cross-layer feature epic | `area:backend` `area:frontend` `kind:feature` |
| Bundle-size mechanism proven, magnitude unknown | `area:frontend` `kind:audit` `concern:performance` `needs:measurement` |
| Implementation the maintainer wants to inspect closely | Required area and kind labels plus `review:in-depth` |
| Design decision an agent cannot make | Required area plus `human`; add `review:deferred` only if the maintainer postponed it |

## Validation before finishing

For every issue whose labels were created or changed:

1. Run `br label list <issue-id> --json`.
2. Confirm its issue class, area cardinality, and kind cardinality.
3. Confirm every scope is valid for an assigned area.
4. Confirm no unauthorized bare label remains.
5. Confirm each transient label has the required evidence, review, or removal
   behavior recorded.
6. Run `br label list-all --json` and report any newly introduced label not listed
   in this file.

When adding a new label to this taxonomy, define its family, exact meaning,
cardinality, lifecycle, incompatible labels, and query value before applying it
to an issue.

Use this decision procedure before adding one:

1. Identify the query that the new label must enable. If no recurring query
   needs it, keep the detail in the issue description.
2. Search every status for an existing label with the same meaning. Reuse or
   broaden that label when the distinction is not operationally important.
3. Confirm the concept belongs to the proposed family. Do not use `track:` for
   workflow state or `topic:` for a source directory.
4. Require a stable meaning that applies to more than one plausible issue. Do
   not mint labels for one finding, branch, file, or temporary condition.
5. Add the label to this file before applying it.
6. Compare the canonical vocabulary with the live corpus and report unknown
   labels across relevant open, deferred, and closed records.

The live corpus is evidence, not authority. `br label list-all --json` may expose
drift, unknown values, or tool-managed labels. Never regenerate the canonical
vocabulary by automatically accepting every observed label. Validate observed
labels against this contract and report unknown values.
