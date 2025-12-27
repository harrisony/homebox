# Git Workflow & Conventions

## Branch Strategy

### Main Development Branch

- **Main branch:** `main` (not `master`)
- All pull requests target `main` from feature branches
- Feature branch naming: Use descriptive names (e.g., `location-history`, `fix-auth-bug`, `refactor-item-service`)

### Branch Naming Conventions

- **Features:** `feature-name` or just descriptive name (e.g., `location-history`)
- **Bug fixes:** `fix-bug-description` (e.g., `fix-auth-token-expiry`)
- **Refactoring:** `refactor-component` (e.g., `refactor-item-service`)

## Commit Message Conventions

HomeBox uses **Conventional Commits** style:

### Commit Types

- `feat:` - New features
- `fix:` - Bug fixes
- `refactor:` - Code refactoring (no functional changes)
- `test:` - Test additions/changes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, not CSS)
- `chore:` - Build/tooling changes
- `perf:` - Performance improvements

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Examples from Recent Commits

```bash
feat(migrate): auto-setup schema for empty databases
refactor(location-history): add service layer and fix i18n issues
feat(i18n): add localization for location history and notes components
test(location-history): add comprehensive tests for synced child location history
fix(frontend): fix linting errors in location history components
```

### Scope Guidelines

Common scopes used in this project:
- `migrate` - Database migration feature
- `frontend` - Frontend changes
- `backend` - Backend changes
- `api` - API endpoint changes
- `i18n` - Internationalization
- Component names (e.g., `location-history`, `item-service`)

### Multi-line Commit Messages

For complex changes, provide additional context in the body:

```
feat(items): add maintenance tracking

- Add maintenance_entries table with Entgo schema
- Create API endpoints for CRUD operations
- Implement service layer with validation
- Add frontend components for maintenance log
```

## Pull Request Workflow

### Before Creating a PR

Run the full PR preparation task:

```bash
task pr                 # Runs all tasks required for a PR
```

This includes:
1. `task generate` - Code generation (Swagger, TypeScript types, Entgo)
2. `task go:all` - Go linting and tests
3. `task ui:check` - TypeScript type checking
4. `task ui:fix` - ESLint auto-fix
5. `task test:ci` - End-to-end tests

### PR Targeting

- **Target branch:** Always `main`
- PRs are reviewed before merging
- CI must pass (GitHub Actions workflows)

## Release Process

### Version Tags

- Tag format: `vX.X.X` (e.g., `v1.2.3`)
- Follows semantic versioning

### Release Workflow

Tagging triggers automated release process:
1. GitHub Actions workflow runs
2. GoReleaser builds binaries
3. Docker images built and pushed
4. Documentation site deployed

See `CONTRIBUTING.md` for full release workflow details.

## Common Git Commands for This Project

### Starting a New Feature

```bash
git checkout main
git pull origin main
git checkout -b feature-name
```

### Before Committing

```bash
task pr                    # Run all checks
git add .
git commit -m "feat(scope): description"
```

### Creating a Pull Request

```bash
git push -u origin feature-name
# Then create PR via GitHub UI or gh CLI
gh pr create --base main --title "feat: Feature description"
```

## Commit Frequency

**Make git commits early and often** - Small, focused commits are preferred over large, monolithic changes.

Benefits:
- Easier to review
- Easier to revert if needed
- Better git history for debugging
- Clearer changelog generation
