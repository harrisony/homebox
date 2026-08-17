# Taskfile → mise migration reference

Upstream drives everything from one flat `Taskfile.yml`. This fork deleted it and split
the surface across four mise config roots. Every hunk of an incoming Taskfile diff needs
a counterpart here.

## Translation

| Taskfile | mise |
|----------|------|
| `env:` (top-level) | `[env]` in root `mise.toml` |
| `dir:` | `dir = "..."` on task |
| `cmds:` single command | `run = "..."` |
| `cmds:` multiple commands | `run = ["...", "..."]` |
| `deps:` | `depends = ["..."]` |
| `silent: true` | `silent = true` |
| `sources:` | `sources = [...]` |
| `task: name` reference | `{ task = "name" }` in run list |
| `{{ .CLI_ARGS }}` | `raw_args = true` on the task |

A new task goes in the config root matching its `dir:` — root, `backend/`, `frontend/`
or `docs/`.

## Env vars

Env vars go in the root `[env]`, except anything that changes server behaviour
(`HBOX_DEMO`) or weakens security (`UNSAFE_DISABLE_PASSWORD_PROJECTION`) — those go on
the individual tasks that need them. As globals they silently opted the whole Go suite
out of argon2id and broke the integration suite's change-password assertions.

## Names

Upstream prefixes task names by project (`go:test`, `ui:dev`) because it has one flat
file. Our config roots already namespace, so the prefix is dropped — upstream `go:test`
is our `//backend:test` — and the upstream name is kept as an `alias`. The bare names
are what let `mise run '//...:test'` reach both projects.

## Tools

Upstream installs tools inline; we declare them in `[tools]`. Audit after any Taskfile
change:

```bash
git show upstream-main:Taskfile.yml | grep -E 'go install|npx |pnpm dlx'
grep -E '"go:|"npm:' mise.toml
```

| Taskfile pattern | `[tools]` entry |
|---|---|
| `go install github.com/foo/bar@v1.2` | `"go:github.com/foo/bar" = "v1.2"` |
| `npx -y -p pkg-name bin-name` | `"npm:pkg-name" = "latest"` |
| `pnpm dlx pkg-name` | `"npm:pkg-name" = "latest"` |

A new upstream tool gets a `[tools]` entry, and the task's `run` calls the binary
directly rather than going through `npx`/`pnpm dlx`.

## Files this fork deleted

Upstream keeps its entire non-mise run surface, so any upstream commit touching one of
these conflicts as modify/delete. Resolve every one with `git rm`.

| File | Why it is gone here |
|---|---|
| `Taskfile.yml` | replaced by the mise configs |
| `CONTRIBUTING.md` | replaced by the contributor docs under `docs/` |
| `.devcontainer/` | installed go-task and a second pnpm |
| `flake.nix`, `flake.lock` | second tool manager, drifted from `[tools]` |
| `.gitlab-ci.yml` | `task`-based, and this fork has no CI server |
| `.github/workflows/{pull-requests,partial-backend,partial-frontend,e2e-partial}.yaml`, `copilot-setup-steps.yml` | same |
