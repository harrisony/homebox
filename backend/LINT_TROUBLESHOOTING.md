# Backend Lint Troubleshooting

Run `mise run //backend:lint` for normal validation. It applies the repository's pinned golangci-lint version, configuration, generation dependency, and formatter check.

## Automated fixes

Do not run `golangci-lint run --fix`. It ignores the `new-from-merge-base` filter and can rewrite unchanged down-stack code. Fix the reported lines by hand.

## Complete output

golangci-lint limits repeated diagnostics by default. To inspect every issue, run the pinned tool from the backend config root:

```bash
cd backend
mise exec -- golangci-lint cache clean
mise exec -- golangci-lint run --max-same-issues=0 --max-issues-per-linter=0 ./...
```

Return to the repository root before running normal project tasks.

## Merge-base attribution

The repository config uses `new-from-merge-base: harrisons-fork-point`. Attribute a reported line with `git blame`, then check whether its commit belongs to the down-stack history:

```bash
git blame -- backend/path/to/file.go
git merge-base --is-ancestor <commit> harrisons-fork-point
```

Exit status 0 means the commit is down-stack. Exit status 1 means it is not an ancestor of `harrisons-fork-point`.
