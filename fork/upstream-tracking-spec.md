# Upstream tracking strategy

How this fork carries its divergence forward against a moving upstream. Two
decisions are open: **how `harrisons-fork-point` tracks `upstream-main`**, and
**what `tests` should be split into**. Neither is decided here; both are recorded
with their options and costs.

Design status: nothing decided. Question 1 gates the next resync. Question 2
gates nothing and can be answered at any time.

## What exists today

Measured 2026-08-18 against `upstream-main`.

### Upstream movement

| Fact | Figure |
| --- | --- |
| Commits in the last 180 days | 200 (≈33/month) |
| Of those, touching a file this fork deleted | 5 |
| Of those, touching a backend file this fork also changed | 17 |

The deleted surface (`Taskfile.yml`, `CONTRIBUTING.md`, `.devcontainer/`,
`flake.*`, `.gitlab-ci.yml`, five workflow files) is enumerated in
[`.agents/skills/git-history-rewriting/references/taskfile-to-mise.md`](../.agents/skills/git-history-rewriting/references/taskfile-to-mise.md).
Every one of those 5 commits lands as a modify/delete conflict on a rebase.

### What `harrisons-fork-point` actually diverges by

9 commits; 697 files and +163,010 against `upstream-main`, which is a misleading
headline. Split by kind:

| Kind | Files | Insertions |
| --- | --- | --- |
| Vendored agent skills (`.agents/`) | 632 | 159,108 |
| Tooling and agent docs (`mise.toml` ×4, `mise-tasks/`, `AGENTS.md` ×5, `.golangci.yml`, `lefthook.yml`, `.github/`) | ~40 | ~2,700 |
| Backend product code (`app/api/main.go`, `app/api/setup.go`, `internal/sys/config/conf_database.go`) | 3 | +64 / −24 |
| Backend tests (`app/api/setup_test.go`) | 1 | 305 |
| Frontend product code | 0 | 0 |

**The product divergence is three files and 64 lines** — the PostgreSQL
connection-string support. Everything else is tooling the fork owns outright and
that upstream will never touch. The conflict surface is therefore almost entirely
the 5 deleted-file commits, not content collisions.

### What `tests` diverges by

119 commits; 322 files and +96,196 against `harrisons-fork-point`.

| Kind | Files | Insertions |
| --- | --- | --- |
| `fork/audit-2026-08-06/` and `fork/frontend-test-audit-2026-08-07/` | 55 | 72,946 |
| Backend `*_test.go` | 85 | 14,575 |
| Frontend test files | 51 | 3,889 |
| Frontend non-test (production `data-testid` hooks and support) | 85 | 3,729 |
| Backend non-test | 33 | 804 |

76% of the branch by volume is one-off audit output — workflow JSON, a corpus
dump, a `pnpm-lock.yaml` baseline. The largest single file the branch adds is a
15,699-line lockfile baseline from an experiment that has concluded.

### The cost this imposes today

Rebase-tracking rewrites all 9 `harrisons-fork-point` SHAs on every resync, so
`tests` must then replay 119 commits onto the new tip. That replay is where the
risk lives: a `rebase --onto` past a squash applies cleanly while silently
duplicating content, which is the hazard the `git-history-rewriting` skill exists
to catch. Verifying it properly costs a per-commit build across 119 commits plus
a range-diff and a duplicate-key sweep.

`issues.new-from-merge-base: harrisons-fork-point` in `backend/.golangci.yml`
depends on the branch existing locally, not on how it is tracked. It survives
either answer to question 1.

## Open questions

### 1. How `harrisons-fork-point` tracks `upstream-main`

This gates the next resync. Answer it before running one.

| Option | Cost |
| --- | --- |
| Rebase `harrisons-fork-point`, rebase `tests` onto it (today) | Linear history, fork reads as a clean 9-commit patch series. Every resync rewrites both branches' SHAs and pays the 119-commit replay and its verification. Every child worktree must be restacked |
| Merge `upstream-main` into `harrisons-fork-point`, merge that into `tests` | SHAs never move; no child restack; each modify/delete conflict is resolved once and recorded in the merge, not re-resolved every resync. History grows merge bubbles and stops reading as a patch series. `git diff upstream-main..harrisons-fork-point` still answers "what does this fork change" |
| Rebase `harrisons-fork-point` (9 commits), **merge** it into `tests` | Keeps the fork's own history legible as a patch series where it is cheap, and removes the replay where it is expensive and dangerous. `tests` accumulates merge commits from a branch whose SHAs keep moving, so each merge is against a rewritten parent — needs checking that this does not confuse the merge base |
| Squash the fork to one commit on each resync | Trivial conflicts, no series to maintain. Destroys the ability to attribute or revert any individual fork change |

Deciding factors not yet gathered: whether the merge-bubble history actually
obstructs anything we do (the fork has no CI server and no upstream PR flow off
this branch), and whether option 3's moving merge base behaves.

Note this is **independent of upstreaming**. Contributions go out on branches cut
from `upstream/main` directly, because upstream squash-merges — so no tracking
strategy here helps or hurts a PR.

### 2. What `tests` should be split into

Gates nothing. Worth doing before the next resync only because it shrinks what
has to be replayed.

The branch currently mixes four things with different lifetimes.

| Option | Cost |
| --- | --- |
| Drop the audit output (`fork/audit-*`, 55 files, 72,946 lines) | Removes 76% of the branch. The material is concluded workflow output, not a durable reference; if any of it is still consulted, it needs a home first — an archive branch or tag preserves it without carrying it on every rebase |
| Split frontend `data-testid` hooks (85 files, 3,729 lines) onto their own branch under `harrisons-fork-point` | These are production-code edits and are the only part of `tests` that can genuinely collide with upstream frontend work. Isolating them makes that collision visible and lets the test files stay purely additive. Costs one more managed branch and a machete edge |
| Offer the backend test coverage upstream (85 files, 14,575 lines) | Purely additive, no product change, low conflict — the best upstreaming candidate the fork has. If accepted, that volume leaves the fork permanently. Costs the work of cutting it from `upstream/main` and shepherding a large PR |
| Leave `tests` as one branch | No work. Every resync keeps replaying and re-verifying 119 commits, 76% of which are inert |

The four are independent; any subset can be done.

## Housekeeping, not decisions

- Seven snapshot branches are stale: `tests-fixed`, `tests-frontend-prerebase`,
  `tests-frontend-pre-recovery-2026-08-10`, `tests-frontend-resync-2026-08-10`,
  `tests-frontend-pre-resync-2026-08-11`, `tests-restructured`, `main-latest`.
  Plus three from this session: `backup/hfp-pre-fmt`, `backup/hfp-pre-scoped`,
  `backup/tests-pre-restack`.
- `more-tests` sits on a red machete edge and needs its fork point resolved
  before it can be updated.
- `.git-blame-ignore-revs` is upstream's, tracked, and holds one entry —
  upstream's own `6c63edb6` formatting sweep. It is currently inert: of the 13
  files that sweep touched which still exist, zero lines are still attributed to
  it, so blame output is identical whether or not it is honoured. It activates
  only if upstream lands another sweep.

  Honouring it needs `blame.ignoreRevsFile`, which is per-clone and cannot be
  committed. It is set in this clone (and so in every linked worktree, which
  share `.git/config`); a fresh clone will not have it and nothing announces
  that. Deliberately left out of `//:setup` — not worth a setup step for a
  setting that changes no output today.

## Out of scope

- Hard-forking: renaming the module, dropping the `upstream` remote, or
  abandoning resyncs. The measured conflict surface — 5 commits per 180 days —
  does not justify it, and the fork's product divergence is 64 lines.
- Changing how contributions are cut for upstream PRs.
- Vendored-skill volume. It is 159k lines and dominates every diffstat, but it
  never conflicts and never needs replaying with judgement.
