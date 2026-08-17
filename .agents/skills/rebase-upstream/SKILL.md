---
name: rebase-upstream
description: Rebase the current branch onto the latest upstream/main and migrate any upstream Taskfile.yml changes into mise.toml. Use when the user says "rebase from upstream", "rebase on upstream", "sync with upstream", "update from upstream", or asks to pull in upstream changes.
---

# Rebase from Upstream

Sync the current branch with `upstream/main`, rebasing our commits on top and migrating any upstream changes to `Taskfile.yml` into our mise configuration.

## Prerequisites

- Remote `upstream` must be configured (pointing at sysadminsmedia/homebox)
- Working tree must be clean (stash or commit before running)

## Workflow

- [ ] 1. **Fetch upstream**
  ```bash
  git fetch upstream
  ```

- [ ] 2. **Identify divergence**
  ```bash
  git merge-base HEAD upstream/main
  git log --oneline <merge-base>..HEAD           # our commits
  git log --oneline <merge-base>..upstream/main   # upstream commits
  ```

- [ ] 3. **Check for Taskfile changes from upstream**
  ```bash
  git diff <merge-base>..upstream/main -- Taskfile.yml
  ```
  If the diff is empty, skip to step 5.

- [ ] 4. **Migrate Taskfile changes to mise.toml**

  Compare upstream's Taskfile.yml against our `mise.toml` for each hunk in the diff:
  - **New env vars** → add to `[env]` section in `mise.toml`. Exception: anything that
    changes server behaviour (`HBOX_DEMO`) or weakens security (`UNSAFE_DISABLE_PASSWORD_PROJECTION`)
    goes on the individual tasks that need it, never in the global `[env]`.
  - **New tasks** → add as `[tasks.<name>]` in the appropriate mise config (root, `backend/mise.toml`, `frontend/mise.toml` or `docs/mise.toml` based on `dir:` field)
  - **Modified task commands** → update the corresponding `run = [...]` in mise
  - **Modified task env** → update the `env = {...}` on the mise task
  - **Removed tasks** → remove from mise
  - **New `go install`/`npx`/`pnpm dlx` tools** → add to `[tools]` in `mise.toml` (see step 4b)
  Translation reference:

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
  | `{{ .CLI_ARGS }}` | add `raw_args = true` to task |

  **Task naming.** Upstream has one flat Taskfile, so it prefixes names by project
  (`go:test`, `ui:dev`). Our config roots already namespace, so those prefixes are
  dropped: upstream `go:test` is our `//backend:test`, upstream `ui:dev` is our
  `//frontend:dev`. Keep the upstream name as an `alias` on the task. Bare names are
  what make `mise run '//...:test'` and `'//...:lint'` reach both projects.

  **Ordering.** mise runs every `depends` entry in parallel and ignores list order.
  Sequencing comes from the dependency graph or from a `run` list. Two tasks that
  touch the same files (`lint:fix` rewriting what `typecheck` reads) must not share a
  `{ tasks = [...] }` parallel group.

- [ ] 4b. **Audit mise tools coverage**

  Compare upstream's `go install` / `npx` / `pnpm dlx` invocations against our `[tools]` in `mise.toml`:
  ```bash
  git show upstream/main:Taskfile.yml | grep -E 'go install|npx |pnpm dlx'
  grep -E '"go:|"npm:' mise.toml
  ```

  Every upstream tool must have a corresponding mise entry. Common mappings:

  | Taskfile pattern | mise `[tools]` entry |
  |---|---|
  | `go install github.com/foo/bar@v1.2` | `"go:github.com/foo/bar" = "v1.2"` |
  | `npx -y -p pkg-name bin-name` | `"npm:pkg-name" = "latest"` |
  | `pnpm dlx pkg-name` | `"npm:pkg-name" = "latest"` |

  If upstream added a new tool, add it to `[tools]` and update the relevant task's `run` to call the binary directly instead of going through `npx`/`pnpm dlx`.

- [ ] 5. **Rebase onto upstream**
  ```bash
  GIT_EDITOR=true git rebase upstream/main
  ```

- [ ] 6. **Resolve modify/delete conflicts**

  This fork deletes upstream's entire non-mise run surface, so any upstream commit
  touching one of these files conflicts as modify/delete. Resolve every one with `git rm`:

  | File | Why it is gone here |
  |---|---|
  | `Taskfile.yml` | replaced by the mise configs |
  | `CONTRIBUTING.md` | replaced by the contributor docs under `docs/` |
  | `.devcontainer/` | installed go-task and a second pnpm |
  | `flake.nix`, `flake.lock` | second tool manager, drifted from `[tools]` |
  | `.gitlab-ci.yml` | `task`-based, and this fork has no CI server |
  | `.github/workflows/{pull-requests,partial-backend,partial-frontend,e2e-partial}.yaml`, `copilot-setup-steps.yml` | same |

  ```bash
  git rm <conflicting-path>
  ```

  If you made mise.toml changes in step 4, stage them:
  ```bash
  git add mise.toml backend/mise.toml frontend/mise.toml docs/mise.toml
  ```

  Continue:
  ```bash
  GIT_EDITOR=true git rebase --continue
  ```

  Repeat for each conflicting commit. Use `GIT_EDITOR=true` for all `rebase --continue` calls — interactive editors don't work in this environment.

- [ ] 7. **Verify result**
  ```bash
  git log --oneline -10
  mise tasks --all                     # every task loads, across all four config roots
  mise run --dry-run pr                # ordering is still what you expect
  ```

  Confirm:
  - Our commits sit on top of upstream/main
  - `Taskfile.yml` does not exist
  - All upstream Taskfile changes are reflected in mise config
  - `mise tasks --all` lists all expected tasks without errors

## Rollback

If anything goes wrong mid-rebase:
```bash
git rebase --abort
```
