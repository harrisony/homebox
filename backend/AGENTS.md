# backend/AGENTS.md

Go backend, module `github.com/sysadminsmedia/homebox/backend`. Read the root
`AGENTS.md` first for mise, codegen and env rules.

Layout is not `cmd/`-style: `app/api` is the server main, `app/tools/typegen` a
generator; `internal/{core,data,sys,web}` and `pkgs/` hold the rest. Chi,
zerolog, ent, goose, otel, testify.

## Architecture

HTTP → chi router → handler → service → repository → Ent → database.

- Handlers live in `app/api/handlers/v1/`. Use the adapters in
  `internal/web/adapters` when an endpoint matches their command, action, or
  query shapes. Add Swagger comments to documented HTTP handlers; WebSocket
  handlers are not Swagger operations.
- Use `services.Context` for operations that require request user or tenant
  identity. Auth and background operations may intentionally use
  `context.Context`; follow the existing service boundary.
- Edit Ent schemas under `internal/data/ent/schema`, not generated Ent files.

## Key constraints

- Add both SQLite and PostgreSQL versions of every database migration.
- Scope tenant-owned repository queries by `GID` (group ID). Global or shared
  operations, including user identity lookup, token lookup, and cleanup sweeps,
  are intentionally not GID-scoped. Preserve the scope used by the model and
  caller.
- Keep fork-only tooling, mise task names, and Beads references out of Go source,
  comments, and package documentation.

## Running tests

`mise run //backend:test` is the canonical full-suite lane: `-count=1` (no
cached false greens) with **real Argon2/bcrypt**. It and `//backend:test:password`
are the only lanes that hash for real. The coverage, PostgreSQL, mutation,
dev-server and CI lanes all set `UNSAFE_DISABLE_PASSWORD_PROJECTION` — including
`test:postgresql`, so no PostgreSQL lane ever exercises argon2.

**Scope with `mise exec`, not the task.** `//backend:test` bakes in `./...` and
`raw_args` appends, so it cannot be narrowed to a package.

For focused diagnosis, run from the backend config root:

    mise exec -C backend -- go test -count=1 -run TestFoo ./internal/data/repo

`mise exec` keeps the mise environment (`GOTMPDIR=/tmp`,
`HBOX_DATABASE_DRIVER=sqlite3`, the pepper), which a bare `go test` does not —
without `GOTMPDIR` on macOS, `app/api/listener_test.go` fails with EINVAL
because the socket path overruns `sun_path`. Focused runs are for diagnosis;
they do not replace the required validation above.

Two things `mise exec` does **not** do, unlike the task:

- It skips the `//:generate` dependency. After an ent schema edit, run `mise run //backend:db:generate` first or you are testing a stale client. (Regenerating is not enough on its own — see migrations below.)
- It does not protect you from an empty filter. `go test -run` exits 0 when nothing matches, so a typo prints `ok` — and this fork merged items and locations into **`Entity`**, so `-run Item` looks green while matching almost nothing. Confirm the filter selected something before trusting a pass.

`//backend:test:password` selects **by package, never by `-run` name** — keep it
that way. An earlier hand-written name allowlist let a rename silently drop tests
from the only lane running real hashing while every gate stayed green.

`//backend:check` is the full local backend gate, and it does **not** include
PostgreSQL. The PostgreSQL lanes (`test:postgresql`, `coverage:postgresql`) need
a live server on `:5432`, which `docker-compose.yml` does **not** provide. Run
them for migrations and dialect-sensitive database changes:

    docker run --rm -e POSTGRES_USER=homebox -e POSTGRES_PASSWORD=homebox \
      -e POSTGRES_DB=homebox -p 5432:5432 postgres:17

## Writing tests

- `internal/data/dbtest` gives each test **binary** its own disposable database, built from the real goose migrations and dropped at teardown, with the driver read from `HBOX_DATABASE_DRIVER`. It wraps `go.uber.org/goleak` via `CheckLeaks`.
- testify `assert`/`require`, table-driven, plain test functions. There is no `testify/suite` anywhere — do not introduce one.
- `paralleltest` is enabled, so new tests are expected to call `t.Parallel()` unless they share fixtures. `ignore-missing-subtests` is on because dbtest isolates per binary, not per test.

## Lint

`mise run //backend:lint` is the check for Go changes. **Do not run
`golangci-lint run --fix`**: it ignores the configured merge-base filter and can
rewrite unchanged code. See [Backend Lint
Troubleshooting](LINT_TROUBLESHOOTING.md) for complete diagnostics and
attribution.

golangci-lint v2 with `default: none`; every linter is enabled explicitly.
`issues.fix: false` — the linter never rewrites your code.

`issues.new-from-merge-base: harrisons-fork-point` filters what is **reported**:
linters still analyse whole packages, but only findings new relative to that
merge base surface. Pre-existing problems in code you touched stay hidden. The
local `harrisons-fork-point` branch must exist or lint behaviour changes.

The enabled set is stricter than ordinary Go — whitespace, comment punctuation,
struct tag order, banned imports — but each linter names itself and the fix in
its own message, so read the output rather than guessing.

What the output cannot tell you: `dupl`, `forbidigo` and `gosec` are off in
`*_test.go`, and `internal/data/ent` is excluded entirely. A clean run over
those paths means nothing was checked, not that nothing was wrong.

## Formatting

`mise run //backend:fmt` rewrites in place; `//backend:lint` runs the same thing
with `--diff` to check. Both apply gofmt, **gofumpt with `extra-rules: true`**
(stricter than plain gofmt), goimports, and swaggo (swagger annotation comments).

**Do not run a bare `golangci-lint fmt`.** Unlike `run`, it has no
`--new-from-merge-base` and no `--new-from-rev`, so it reformats the whole tree —
about 35 files of upstream code this fork has no other reason to diverge in, and
that divergence would have to be re-applied on every upstream resync. This is the
same hazard as `run --fix` above. `//backend:fmt` exists to supply the scope
golangci-lint does not: it reads `new-from-merge-base` out of `.golangci.yml` and
passes only the Go files changed since that merge base, working tree included.

The consequence worth knowing: formatting is scoped per **file**, not per line
like the linter, so the first time you touch an untouched upstream file its whole
formatting diff lands in your commit. That is intended — divergence then tracks
the files you actually work in.

## Schema and migrations

- **ent**: schema sources and templates live under `internal/data/ent/schema/`; `internal/data/ent/generate.go` is the hand-written generator entrypoint. Edit those sources, then run `mise run //backend:db:generate`; the remaining Ent files are generated.
- **goose**: migrations are embedded in the server and applied at startup. SQL lives in `internal/data/migrations/{sqlite3,postgres}` — **both dialects need the migration**, and the test suite builds its schema from them, so it covers dialect divergence. The goose CLI is pinned in mise for authoring only.
- Changing swagger annotations on handlers requires regeneration (`mise run //:swag`, or `//:generate`). `//:generated-check` cannot see a generator you never ran — it only reports drift in generated files. Pre-commit still catches it, because `//backend:lint` depends on `//:generate` and runs first.

## SQLite safety

If the development database is locked, identify and stop the process using it.
Do not delete SQLite sidecar files from a live database.
