# Development Commands

**Please make git commits early and often**

This project uses `task` (go-task/task) for task management. Run `task --list` to see all available tasks.

## Quick Start

```bash
task setup              # Install all development dependencies (swag, goose, go deps, pnpm deps)
```

## Backend Development

```bash
task go:run             # Start backend API server (auto-generates code)
task go:run:postgresql  # Start backend with PostgreSQL
task go:test            # Run Go tests
task go:lint            # Run golangci-lint
task go:coverage        # Run tests with coverage report
```

## Frontend Development

```bash
task ui:dev             # Start Nuxt dev server (default port 3000)
task ui:watch           # Run Vitest in watch mode
task ui:fix             # Run prettier and eslint with auto-fix
task ui:check           # Run TypeScript type checking
```

## Code Generation (Required Before Committing)

```bash
task swag               # Generate Swagger API docs
task typescript-types   # Generate TypeScript types from Swagger
task db:generate        # Generate Entgo code from schemas
task generate           # Run all code generation tasks
```

## Pre-Commit Workflow

```bash
task pr                 # Runs all tasks required for a PR
```

This includes:
1. `task generate` - Code generation (Swagger, TypeScript types, Entgo)
2. `task go:all` - Go linting and tests
3. `task ui:check` - TypeScript type checking
4. `task ui:fix` - ESLint auto-fix
5. `task test:ci` - End-to-end tests

## Testing Architecture

**Backend Tests:**
- Unit tests alongside code files (`*_test.go`)
- Use `testify` for assertions
- Run: `task go:test` or `task go:coverage`

**Frontend Tests:**
- Vitest for unit/component tests (require running backend)
- Playwright for e2e tests in `frontend/test/e2e/`
- Run: `task ui:watch` or `task test:e2e`
- **Important:** Tests may fail on first run due to race conditions (re-run if needed)

## Database Migration Tool

The migration tool performs direct SQLite ↔ PostgreSQL migrations:

```bash
# SQLite to PostgreSQL
task db:migrate FROM=sqlite3 FROM_URL=".data/homebox.db" TO=postgres TO_URL="host=localhost dbname=homebox user=homebox password=homebox sslmode=disable" --verify

# PostgreSQL to SQLite
task db:migrate FROM=postgres FROM_URL="host=localhost dbname=homebox user=homebox password=homebox sslmode=disable" TO=sqlite3 TO_URL=".data/homebox.db" --verify
```

**Key Features:**
- Auto-setup schema for empty databases using Goose migrations
- Transactional safety: all-or-nothing guarantee
- Preserves all UUIDs, timestamps, and relationships
- Optional `--verify` flag for post-migration integrity checks

**For Developers:**
See [DEVELOPING.md](DEVELOPING.md#database-migration-feature) for comprehensive guidance on maintaining the migration feature when adding new entities.
