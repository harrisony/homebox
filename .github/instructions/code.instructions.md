# Homebox Repository Instructions for Coding Agents

## Repository Overview

**Type**: Full-stack home inventory management web app (monorepo)  
**Size**: ~265 Go files, ~371 TypeScript/Vue files  
**Build Tool**: mise (mise.toml) - **ALWAYS use `mise` commands**  
**Database**: SQLite (default) or PostgreSQL

### Stack
- **Backend** (`/backend`): Go 1.26+, Chi router, Ent ORM, port 7745
- **Frontend** (`/frontend`): Nuxt 4, Vue 3, TypeScript, Tailwind CSS, pnpm 9.1.4+, dev proxies to backend

## Critical Build & Validation Commands

### Initial Setup (Run Once)
```bash
mise install    # Installs the pinned toolchain: Go, Node, swag, goose, golangci-lint, ...
mise run setup  # Installs Go modules and pnpm deps for frontend and docs
```

### Code Generation (Required Before Backend Work)
```bash
mise run generate  # Generates Ent ORM, Swagger docs, TypeScript types
```
**ALWAYS run after**: schema changes, API handler changes, before backend server/tests  
**Note**: "TypeSpecDef is nil" warnings are normal - ignore them

### Backend Commands
```bash
mise run //backend:build    # Build binary (60-90s)
mise run //backend:test     # Unit tests (5-10s)
mise run //backend:lint     # golangci-lint (6m timeout in CI)
mise run //backend:all      # Tidy + lint + test
mise run //backend:run      # Start server (SQLite)
mise run pr          # Full PR validation (3-5 min)
```

### Frontend Commands
```bash
mise run //frontend:dev    # Dev server port 3000
mise run //frontend:typecheck  # Type checking
mise run //frontend:lint:fix    # eslint --fix + prettier
mise run //frontend:test:watch  # Vitest watch mode
mise run //frontend:lint:ci     # Lint gate: max 1 warning
```

### Testing
```bash
mise run //frontend:test    # Fast lanes: unit + component, nothing running (5-15s)
mise run test:ci            # Integration tests (15-30s + startup)
mise run test:e2e           # Playwright E2E (60s+ per shard, installs browsers)
mise run '//...:test'       # Backend suite + frontend fast lanes
mise run pr                 # Full PR validation (3-5 min)
```

## Project Structure

### Key Root Files
- `mise.toml` - Root tasks, shared tools and env; `[monorepo].config_roots` lists the projects
- `backend/mise.toml`, `frontend/mise.toml`, `docs/mise.toml` - per-project tasks and tools
- `mise-tasks/` - file tasks (`force`, `wait-for-backend`)
- `docker-compose.yml`, `Dockerfile*` - Docker configs

### Backend Structure (`/backend`)
```
backend/
├── app/
│   ├── api/              # Main API application
│   │   ├── main.go       # Entry point
│   │   ├── routes.go     # Route definitions
│   │   ├── handlers/     # HTTP handlers (v1 API)
│   │   ├── static/       # Swagger docs, embedded frontend
│   │   └── providers/    # Service providers
│   └── tools/
│       └── typegen/      # TypeScript type generation tool
├── internal/
│   ├── core/
│   │   └── services/     # Business logic layer
│   ├── data/
│   │   ├── ent/          # Ent ORM generated code + schemas
│   │   │   └── schema/   # Schema definitions (edit these)
│   │   └── repo/         # Repository pattern implementations
│   ├── sys/              # System utilities (config, validation)
│   └── web/              # Web middleware
├── pkgs/                 # Reusable packages
├── go.mod, go.sum        # Go dependencies
└── .golangci.yml         # Linter configuration
```

**Patterns**: Schema/API changes → edit source → `mise run generate`. Never edit generated code in `ent/`.

### Frontend Structure (`/frontend`)
```
frontend/
├── app.vue               # Root component
├── nuxt.config.ts        # Nuxt configuration
├── package.json          # Frontend dependencies
├── components/           # Vue components (auto-imported)
├── pages/                # File-based routing
├── layouts/              # Layout components
├── composables/          # Vue composables (auto-imported)
├── stores/               # Pinia state stores
├── lib/
│   └── api/
│       └── types/        # Generated TypeScript API types
├── locales/              # i18n translations
├── test/                 # Vitest + Playwright tests
├── eslint.config.mjs     # ESLint configuration
└── tailwind.config.js    # Tailwind configuration
```

**Patterns**: Auto-imports for `components/` and `composables/`. API types auto-generated - never edit manually.

## CI

This fork has no CI server. mise is the CI, and the `task`-based GitHub and GitLab
pipelines have been removed rather than left pointing at a runner that no longer
exists. The gates you run yourself before pushing:

1. **Backend**: `mise run //backend:check` (lint, build, race coverage, password tests)
2. **Frontend**: `mise run //frontend:lint:ci` and `mise run //frontend:typecheck`
3. **Everything**: `mise run pr`

## Common Pitfalls

1. **Missing tools**: Run `mise install`, then `mise run setup`
2. **Stale generated code**: Always `mise run generate` after schema/API changes
3. **Test failures**: Integration tests may fail first run (race condition) - retry
4. **Port in use**: Backend uses 7745 - kill existing process
5. **SQLite locked**: Delete `.data/homebox.db-*` files
6. **Clean build**: `rm -rf build/ backend/app/api/static/public/ frontend/.nuxt`

## Environment Variables

Backend defaults in the root `mise.toml` `[env]`:
- `HBOX_LOG_LEVEL=debug`
- `HBOX_DATABASE_DRIVER=sqlite3` (or `postgres`)
- `HBOX_DATABASE_SQLITE_PATH=.data/homebox.db?_pragma=busy_timeout=1000&_pragma=journal_mode=WAL&_fk=1`
- PostgreSQL: `HBOX_DATABASE_*` vars for username/password/host/port/database

Two are deliberately per-task, never global: `HBOX_DEMO` (dev servers only, it 403s
change-password and friends) and `UNSAFE_DISABLE_PASSWORD_PROJECTION` (opt in per
lane, so tests get real argon2 by default).

## Validation Checklist

Before PR:
- [ ] `mise run generate` after schema/API changes
- [ ] `mise run pr` passes (includes lint, test, typecheck)
- [ ] No build artifacts committed (check `.gitignore`)
- [ ] Code matches existing patterns

## Quick Reference

**Dev environment**: `mise run //backend:run` (terminal 1) + `mise run //frontend:dev` (terminal 2)

**API changes**: Edit handlers → add Swagger comments → `mise run generate` → `mise run //backend:build` → `mise run //backend:test`

**Schema changes**: Edit `ent/schema/*.go` → `mise run generate` → update repo methods → `mise run //backend:test`

**Specific tests**: `cd backend && go test ./path -v` or `cd frontend && pnpm run test:watch`

## Trust These Instructions

Instructions are validated and current. Only explore further if info is incomplete, incorrect, or you encounter undocumented errors. Use `mise tasks --all` for all commands.
