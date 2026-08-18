# AGENTS.md

A fork of HomeBox. `backend/` (Go) and `frontend/` (Nuxt 4 SPA) have their own
AGENTS.md with language-specific rules, and `frontend/components/` has one for
component authoring. Read every nested file that applies to the paths you are
inspecting or changing.

## Answering

Lead with the answer or the command, then explain in proportion to what is being
asked: a routine change needs a sentence, a review or a diagnosis needs its
evidence. Do not recite this repo's machinery back to the reader.

Stay in the scope asked. If you notice unrelated breakage, give it one line and
offer to look; do not investigate it and report the root cause unprompted.

## Task runner

**mise, in monorepo mode.** There is no Makefile and no Taskfile. Tasks are
addressed by config root: `//backend:test`, `//frontend:lint`, `//:pr` for root
tasks. `mise tasks --all` is the full surface. `mise run '//...:test'` fans a
bare task name across roots. Prefer an existing task over invoking the
underlying tool directly.

Always use the fully qualified name — a bare `test:ci` resolves against the
current config root and may run a different task.

Several tasks set `raw_args = true`, which **appends** your arguments to the
task's own command rather than replacing them. `mise run //backend:test --
./pkgs/set` does not narrow to that package — the task's baked-in `./...` is
still there, so the two patterns union and everything runs. To scope a command,
bypass the task and use `mise exec` (see `backend/AGENTS.md`).

Other mise behaviour worth knowing:

- `sources`/`outputs` resolve against the task's `dir`, so use absolute
  `{{config_root}}` paths. A relative path matches nothing and makes the task
  consider itself permanently up to date.
- `mise run --force` bypasses mise's freshness check but does **not** clear tool
  caches. Use the relevant `clean` task when testing from a cold cache.
- `mise tasks validate` loads only one config root and reports cross-root
  dependencies as missing. Confirm cross-root tasks with `mise tasks --all` and
  by running them.

## Codegen

`mise run //:generate` runs three generators whose order is load-bearing:

    //backend:db:generate  (ent)  →  //:swag  (swagger/openapi)  →  //:typescript-types

swag parses `internal/data/repo`, which imports generated ent code; the frontend
types are generated from swagger's output. mise runs `depends` entries in
parallel and ignores list order, so the chain is enforced by `depends` edges on
`:swag` and `:typescript-types` — not by the order they appear in `//:generate`.
Do not "simplify" that into one depends list.

**Generated output is checked in and must never be hand-edited:**

- `backend/internal/data/ent/**` — except the hand-written `ent/generate.go` and `ent/schema/`
- `backend/app/api/static/docs/**`
- `docs/public/api/**`
- `frontend/lib/api/types/data-contracts.ts` — its sibling `non-generated.ts` is hand-written

Provenance is **per file, not per directory**. `lib/api/types/` holds a generated
file beside a hand-written one, and `frontend/components/ui/` mixes shadcn
registry components with first-party files in the same directories. Before
treating a file as generated, check the generator's `outputs` or run `git log` on
it — the directory name is not the signal.

Skipping regeneration fails silently: the backend still builds and the frontend
still typechecks, just against stale contracts. The required backend lint and PR
lanes regenerate first; `mise run //:generated-check` then fails on generated
output that is unstaged or untracked. The check cannot detect a generator that
never ran, and it never regenerates or stages anything itself — so **stage
generated output deliberately**: review the diff, then add it. Re-running
`//:generate` will not clear the check when the output is legitimately new.

Keep the dependency edges. `//backend:build:with-frontend` depends on
`//:generate` because the SPA imports `lib/api/types`; drop that edge and the
frontend builds against whatever happens to be on disk.

## Gates

**pre-commit** (lefthook, automatic) runs the checks below against the staged
paths. Run the same set by hand when you commit outside the hook:

| Staged paths | Required checks |
|---|---|
| `backend/**/*.go` | `mise run //backend:lint`, then `mise run //:generated-check` |
| `frontend/**`, excluding `**/*.md` and `**/*.toml` | `mise run //frontend:gate` |
| anything else | none |

- **Deeper backend gate**: `mise run //backend:check` — tidy check, lint, build, race coverage and the real-password tests. The pre-commit hook does not run it; run it yourself on backend work before committing.
- **Full local gate**: `mise run //:pr`. Its stage order matters: `lint:fix` rewrites the files `typecheck` reads, so they are deliberately not parallel. It runs generation and frontend fixes, so inspect the working tree afterward.

After a fresh clone or `git worktree add`, run `mise run //:setup` (deps + git
hooks) and `mise run //:link-skills`.

## Environment

Config is `ardanlabs/conf` with an `HBOX` prefix. Run everything through mise:
`go run ./app/api` outside mise **fails at startup** because
`HBOX_AUTH_API_KEY_PEPPER` must be at least 32 bytes, and on macOS the missing
`TMPDIR=/tmp` / `GOTMPDIR=/tmp` break unix-socket tests and Nuxt's vite-node
socket (104-byte `sun_path` limit).

Two variables are deliberately **per-task, never global** — do not promote them
to the root `[env]`:

- `UNSAFE_DISABLE_PASSWORD_PROJECTION` makes hashing a plaintext no-op. As a global it silently opted the whole Go suite out of argon2id.
- `HBOX_DEMO` 403s change-password, reset-password, user delete, wipe and import. As a global it broke the integration suite, which asserts 204 from change-password.

Ports: **7745** backend everywhere, **3000** Nuxt dev (proxies `/api` → 7745, so
the frontend alone is not enough).

## Dev servers

- `mise run //:dev` — both halves, Ctrl-C stops both. This is the browsable full stack.
- `mise run //:dev:background` — **backend only**, returns once the API answers. Use this when you need the shell back. Nuxt cannot be backgrounded from inside a mise task (the task's shell cleanup takes the vite-node socket with it); run `mise run //frontend:dev` in a process you own.
- `mise run //:dev:stop` — `pkill -TERM -x api`. It cannot tell your server from one someone started by hand, so inspect the port first and stop only processes you started.
- `//backend:ci` is a **demo-mode dev server**, not a test lane, despite the name.

Dev-server tasks enable demo mode and bypass password hashing. Do not use them
to validate authentication, password handling, or destructive operations — the
lane that exercises those is `//:test:e2e`, which runs with `HBOX_DEMO=false`.

## Git safety

This is a shared workspace. Preserve unrelated working-tree changes, staged
changes, and stashes. Do not use `git stash`, `git checkout`, `git switch`,
`git restore`, or an equivalent operation without the user's explicit permission
for the exact operation and target.

`mise run //:sync-main` updates `upstream-main` within that rule — it fetches and
moves the ref with `git update-ref`, never checking the branch out.

## Discovered defects

Fix a discovered defect in the current change only when it is directly related,
small, low-risk, and covered by the same validation. Otherwise report it; create
an issue only when tracking is useful and within the task's scope.

## Default scope

Focus on backend and frontend behavior. Docs-site source and non-English
translation content are out of scope unless explicitly requested. Generated API
artifacts are not docs-site work.

## Working conventions

- **Branching**: stack work on the current fork branch. `harrisons-fork-point` is this fork's root branch.
- **Issues**: `br` (beads, in the gitignored `.beads/`) is part of the normal change workflow — use the `br` skill to find ready work and update status. Never the retired `bd` client. Keep an issue's status and material requirements accurate while you are actively working it; do not rewrite, comment on, or close an issue merely because it was inspected. Read the [label taxonomy](fork/labels.md) before creating a bead or changing its labels.
- **Commits**: Conventional Commits with scopes (`fix(frontend):`, `build:`, `docs(fork):`). Convention only — nothing enforces it. Do **not** mention `br`, `bd`, beads, or bead IDs in commit messages or PR descriptions; describe the change itself.
- **Skills** live in `.agents/skills/` (tracked). `.claude/skills/` holds symlinks generated by `mise run //:link-skills`; `.claude/` is gitignored except `.claude/agents/`, so never put a durable file there.

## Documentation references

When work touches one of the libraries below, read its relevant `llms.txt` before
changing code or choosing an approach. Follow links as needed, and verify examples
against the installed version before building on them. Never guess a documentation URL.

- Nuxt: <https://nuxt.com/llms.txt>
- Nuxt full guidance: <https://nuxt.com/llms-full.txt>
- Vue Router: <https://router.vuejs.org/llms.txt>
- Vitest: <https://vitest.dev/llms.txt>
- Vite: <https://vite.dev/llms.txt>
