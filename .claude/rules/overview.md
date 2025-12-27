# Project Overview

HomeBox is a home inventory and organization system with a Go backend and Vue 3/Nuxt.js frontend.

## Technology Stack

- **Backend:** Go 1.24+ with ENT ORM
- **Database:** SQLite (default) or PostgreSQL
- **Frontend:** Vue 3 + Nuxt 4
- **UI:** Shadcn-vue components with Tailwind CSS styling
- **Task Runner:** `task` (go-task/task)

## Architecture Quick Reference

### Backend Structure

```
backend/
├── app/api/
│   ├── handlers/v1/      # HTTP handlers (v1_ctrl_*.go)
│   ├── middleware.go     # Auth, roles, CORS middleware
│   └── routes.go         # Route definitions and WebSocket setup
├── internal/
│   ├── core/services/    # Business logic layer
│   ├── data/
│   │   ├── ent/
│   │   │   ├── schema/   # Database schema definitions
│   │   │   └── *.go      # Generated code (DO NOT EDIT)
│   │   ├── repo/         # Repository pattern implementations
│   │   └── migrations/   # Database migrations (sqlite3/ and postgres/)
│   └── sys/
│       ├── config/       # Config via ardanlabs/conf (HBOX_ prefix)
│       └── validate/     # Custom error types
└── pkgs/                 # General helpers and utilities
    ├── hasher/           # Password/token hashing
    ├── textutils/        # Search normalization
    └── faker/            # Test data generation
```

**Critical Flow:** HTTP Handler → Service Layer → Repository Layer → ENT ORM → Database

### Frontend Structure

```
frontend/
├── components/
│   ├── global/          # Auto-imported components
│   ├── ui/              # Shadcn-vue components (DO NOT EDIT)
│   └── [Feature]/       # Feature-specific components (manual import)
├── pages/               # File-based routing (Nuxt)
├── composables/         # Vue composables
├── lib/api/             # API client & generated types (DO NOT EDIT data-contracts.ts)
├── stores/              # Pinia state management
└── test/                # Vitest and Playwright tests
```

### Data Flow

1. **Frontend → Backend:**
   - API calls from `frontend/lib/api/` using auto-generated TypeScript types
   - Requests hit handlers in `backend/app/api/handlers/v1/`
   - Handlers call services in `backend/internal/core/services/`
   - Services use repositories in `backend/internal/data/repo/`
   - Repositories use Entgo ORM to interact with database

2. **Schema Changes Workflow:**
   - Modify `backend/internal/data/ent/schema/*.go`
   - Run `task db:generate` to generate Entgo code
   - Run `task swag` to update Swagger docs
   - Run `task typescript-types` to update frontend types
   - Create migrations in **both** `backend/internal/data/migrations/sqlite3/` and `backend/internal/data/migrations/postgres/`

## Environment Variables

Key environment variables (set in `Taskfile.yml` or exported in shell):
- `HBOX_LOG_LEVEL`: Logging level (default: debug)
- `HBOX_DATABASE_DRIVER`: "sqlite3" or "postgres"
- `HBOX_DATABASE_SQLITE_PATH`: SQLite database path with pragmas
- `HBOX_OPTIONS_ALLOW_REGISTRATION`: Enable user registration
- `UNSAFE_DISABLE_PASSWORD_PROJECTION`: Development-only flag to disable password projection

## External Documentation

For UI component reference:
- Shadcn-vue: https://shadcn-vue.com/llms.txt and https://shadcn-vue.com/llms-full.txt
- DaisyUI: https://daisyui.com/llms.txt
- Nuxt UI: https://ui.nuxt.com/llms.txt and https://ui.nuxt.com/llms-full.txt
- Use Context7 MCP server for other library documentation
