---
name: git-history-rewriting
description: >
  Rewrite git history correctly in this fork: resyncing with upstream ("rebase from
  upstream", "sync with upstream", "update from upstream"), interactive rebase, rebase
  --onto / cherry-pick onto a moved or previously-squashed base, squash, fixup,
  autosquash, amend, reordering or renaming commits, consolidating commits into
  concerns, or restacking child branches. Read it before any command against the
  `upstream` remote, and verify every replayed commit rather than trusting a clean apply.
---

# Git history rewriting

A `rebase --onto` / cherry-pick applies each commit as a 3-way merge against its
**immediate parent**, not the target's full ancestry. If the target squashed or
consolidated history, a later commit that re-adds content the squash already placed
applies as a **clean, conflict-free addition** that git will not flag. A clean apply is
not evidence of correctness — it is a signal to verify. (Observed failures during a
homebox `tests`-onto-`harrisons-fork-point` resync: duplicated `AGENTS.md` sections, a
duplicate `[tasks.clean]` key, and commits that kept subject/author but lost a hunk.)

Upstream is sysadminsmedia/homebox and it **squash-merges**, so an upstream resync is
this hazard by construction, not an edge case.

History rewriting is allowed only when the user has authorized it. Treat every other
branch, worktree, staged change, untracked file, and stash as protected unless the user
names it as part of the operation.

Layout and fork-point handling belong to the **`git-machete`** skill.

## Before rewriting

Record the tips of the target, its parent, and every managed child that may need
restacking, plus each relevant worktree's status:

```bash
git status --short --branch
git worktree list --porcelain
git log --graph --decorate --oneline --all
git machete status --list-commits --color=never | cat
```

Do not use `git stash`, `git checkout`, `git switch`, `git restore`, or an equivalent
in a shared workspace without authorization for the exact operation and target.

Map each commit to the files it ACTUALLY touches — never infer from the subject (a
commit named "mise-only" has been seen editing test files):

```bash
git show --stat --oneline <commit>
git show --name-status <commit>
git log --oneline --all -- <path>
```

A commit that touches a file created by a LATER commit cannot move ahead of that commit.
Order fixes after the commits that add the files they touch. Reordering is what breaks
things; squashing adjacent neighbors is low-risk.

## Hard rules during the rewrite

1. **Verify every replayed commit, not just the tip.** `git rebase -i --onto <base>
   <base> <branch> -x '<repo check>'` builds each commit, and `git diff
   <original-tip> <branch>` must be empty.
2. **After any `--onto` past a squash, run the duplicate-content check.** For each file
   both sides touch, diff line counts or `git show --stat` each replayed commit against
   its target-side counterpart — a clean apply can silently re-add content the squash
   already placed.
3. **Never `git add -A` mid-rebase.** It sweeps untracked agent-state dirs (`.pi/`,
   `.rpiv/`, `.serena/`) into commits. Stage resolved files explicitly.
4. **Disable `rerere` before redoing a failed rebase** (`git config rerere.enabled
   false`) so earlier botched resolutions aren't replayed silently.
5. **Never `git rebase --skip`, or accept "already applied", on judgment alone.** Run
   `git cherry -v` / patch-id first; if the patch-id changed, compare `git show --stat`
   against the original — a same message/author/timestamp commit can still be missing a
   hunk.
6. **Parser-less files fail silently.** A duplicate Markdown heading or `.gitignore`
   line errors on nothing; TOML may hard-error on a duplicate key. Grep the shared set
   for duplicate headings/keys after a rewrite.

Use `GIT_EDITOR=true` for every `rebase --continue`; interactive editors do not work
here.

## Resyncing with upstream

### 1. Move the base

Record where `upstream-main` was, then fast-forward it:

```bash
PREV=$(git rev-parse upstream-main)
mise run //:sync-main
```

`//:sync-main` never checks the branch out and refuses when local `upstream-main` holds
commits `upstream/main` lacks. `upstream-main` is the root of the machete layout, so it
is what we rebase **onto** — rebasing onto `upstream/main` leaves the layout's fork
points describing a base that is no longer ours. Resolve any yellow edge before
rebasing (`git-machete`, rule 7).

### 2. Read the incoming Taskfile diff

```bash
git diff "$PREV"..upstream-main -- Taskfile.yml
```

Upstream drives everything from `Taskfile.yml`, which this fork deleted, so its changes
must be carried into the mise configs by hand. When the diff is non-empty, read
[`references/taskfile-to-mise.md`](references/taskfile-to-mise.md) — it holds the
translation table, the env-var and naming rules, the `[tools]` audit, and the list of
files this fork deleted.

Read the diff now so the step-4 resolutions are informed, and land the mise-side change
as its own commit in step 5 — folding it into the resolution of an upstream commit
buries our change under a subject describing theirs.

### 3. Replay our commits

`git machete update` cannot run `-x`, so drive the rebase with raw git and reconcile the
layout afterwards:

```bash
BRANCH=$(git symbolic-ref --short HEAD)
OLD_TIP=$(git rev-parse HEAD)
FORK=$(git machete fork-point "$BRANCH")
git rebase -i --onto upstream-main "$FORK" "$BRANCH" -x 'mise run //backend:build'
```

`//backend:build` is the cheap per-commit gate; the full gates run once at the tip.
`git machete update --no-interactive-rebase` is the alternative only when tip-only
verification is acceptable.

### 4. Resolve the modify/deletes

Every upstream commit touching a file this fork deleted conflicts as modify/delete.
Resolve each with `git rm` against the table in the reference file:

```bash
git rm <path>
git status --short
GIT_EDITOR=true git rebase --continue
```

### 5. Land the mise migration

Commit the mise-side counterpart of the step-2 diff on top of the replayed branch.

### 6. Verify the edge

Beyond the general verification below, two checks belong to this edge:

```bash
mise tasks --all            # every task loads, across all four config roots
mise run --dry-run //:pr    # stage ordering is still what you expect
```

Then confirm `Taskfile.yml` does not exist, and that every hunk of the step-2 diff has a
mise counterpart.

If the rebase goes wrong mid-flight, `git rebase --abort`. `$PREV` restores
`upstream-main` via `git update-ref` if the sync itself needs undoing.

## Consolidating commits

To group commits into concerns, prefer fixups addressed to the intended commit so
autosquash places them correctly:

```bash
git add <exact-paths>
git diff --cached --name-status
git commit --fixup=<target-sha>
```

Use an exact SHA or unambiguous expression, never a subject alone. Then:

```bash
git rebase --autosquash <parent>
```

Inspect the todo list when a target is ambiguous or a commit mixes concerns; stop at a
mixed commit and divide its changes deliberately. Do not silently drop a path while
resolving a conflict.

Write subjects for the FINAL diff, not the initial intent — if resolution narrows a
commit, amend its message to match (observed: subject "add and refine the cache-cleaning
force task" on a patch that only deleted the file). For a concern commit, prefer a stable
subject over a history-process label like "squashed commit".

For a large fork-point rewrite, construct each desired tree from the recorded history
using a temporary Git index and `git commit-tree`, preserving the original tip tree
exactly unless the user requested content changes:

```bash
git rev-parse <old-tip>^{tree}
git rev-parse <new-tip>^{tree}
```

If the trees differ unexpectedly, stop before updating refs. Keep the old tip reachable
via a temporary ref or reflog until the rewrite is audited.

## Restacking child branches

Rewrite managed branches parent to child. With separate linked worktrees, update from
the child worktree rather than `traverse`, which may try to check out branches already
checked out elsewhere:

```bash
git machete status --list-commits --color=never | cat
git machete update --no-interactive-rebase
```

Resolve yellow or uncertain fork-point edges before updating. For conflicts, keep the new
parent version for duplicated shared tooling or agent files, but merge child-specific
additions back explicitly. Inspect the staged resolution before continuing:

```bash
git status --short
git diff --cc
git diff --cached --name-status
GIT_EDITOR=true git rebase --continue
```

After each child, restack the next. Do not update branches merely because they appear in
the machete layout.

## Verify

Range-diff proves the old commits survived the rewrite:

```bash
git range-diff <old-parent>..<old-tip> <new-parent>..<new-tip>
```

Every intended commit should map to an equivalent, or be explicitly accounted for as a
duplicate now contained in a consolidated parent. A matching tip tree is the MINIMUM, not
proof — it catches neither content duplicated inside a file (rule 2) nor a broken
intermediate commit (rule 1). Run the repository's normal gates when final trees changed
or the user requests validation.

Report rewritten refs, preserved refs, dropped duplicate commits, unresolved pre-existing
dirt, and which checks were or were not run.

## Homebox shared-file danger set

Files both `harrisons-fork-point` and the test branches touch — the likeliest
silent-duplication surface:

`AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `mise.toml`, `backend/mise.toml`,
`frontend/mise.toml`, `.gitignore`, `skills-lock.json`, `lefthook.yml`,
`backend/.golangci.yml`, `.github/instructions/*`, and the vendored `.agents/skills/*`.

After any rewrite touching these, check each has exactly one of each intended key/heading.
`mise tasks --all` catches a duplicate `[tasks.clean]`; nothing catches a duplicate
Markdown section except a diff.

## Halt-and-verify signals

- A clean apply (no conflict markers) to a file that both sides of the rebase modified.
- A rewrite that had to be aborted and re-attempted — a first-pass abort (e.g. a
  `.gitignore` conflict) means the file-overlap model was incomplete.

Do not continue past these; resolve the discrepancy with an explicit diff.
