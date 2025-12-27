---
paths:
  - "backend/app/api/main.go"
  - "backend/**/*.go"
---

# Backend Architecture

## Application Initialization Pattern

**Location:** `app/api/main.go`

### Singleton Pattern

The app uses singleton initialization with dependency injection:

```go
type app struct {
    conf     *config.Config
    mailer   mailer.Mailer
    db       *ent.Client
    repos    *repo.AllRepos
    services *services.AllServices
    bus      *eventbus.EventBus
}
```

### Initialization Order

**Order matters - follow this exact sequence:**

1. **Config loaded** - CLI flags + `HBOX_` environment variables
2. **Database URL setup** - Directory creation for SQLite
3. **Storage directory validation** - Local or cloud storage
4. **Database client created** - ENT client initialization
5. **Event bus started** - For WebSocket pub/sub
6. **Repositories created** - With DB client, bus, storage dependencies
7. **Services created** - With repository dependencies

**Why order matters:** Each step depends on previous initialization. Services need repos, repos need DB client and event bus, etc.

## Package Structure Overview

### `internal/core/services/` - Business Logic Layer

- Each service holds `AllRepos` reference
- Services instantiated with functional options pattern:
  ```go
  services.New(repos,
      services.WithAutoIncrementAssetID(true),
      services.WithCurrencies(currencies),
  )
  ```
- Key services: UserService, ItemService, GroupService, BackgroundService
- Services never access DB directly - only via repositories

### `internal/data/repo/` - Data Access Layer

- One repository per ENT entity
- `AllRepos` aggregates all repositories
- Repositories use ENT client, NOT raw SQL
- Queries use ENT's fluent API
- All mutations publish events to event bus

### `internal/data/ent/` - ENT ORM (Generated)

- **DO NOT EDIT** - auto-generated from schemas
- Schema definitions in `schema/` subdirectory
- Uses mixin pattern for code reuse (BaseMixin, DetailsMixin, GroupMixin)
- Regenerate with `task db:generate` after schema changes

### `internal/sys/` - System Utilities

- `config/` - Config via `ardanlabs/conf` with `HBOX_` prefix
- `validate/` - Custom error types (RequestError, FieldError, etc.)

### `pkgs/` - Reusable Packages

- `textutils/` - Search normalization (accent-insensitive)
- `hasher/` - Password/token hashing
- `faker/` - Test data generation
- `mailer/` - Email abstraction
- `labelmaker/` - QR code generation
- `cgofreesqlite/` - Pure Go SQLite

## Critical Gotchas

1. **Middleware Panic:** `mwRoles` panics if `mwAuthToken` not first in middleware chain
2. **Context Extraction:** Must use `services.NewContext()` in every handler or lose user/group data (security bug)
3. **Dual Migrations:** Both SQLite AND PostgreSQL migrations required for every schema change
4. **Code Generation:** Must run `task db:generate` after schema changes or code won't compile
5. **Event Bus Deadlock:** Event bus must run in goroutine during tests or tests will hang forever
6. **Cookie Format Quirk:** Auth cookie stores `"true"` string, not the actual JWT token
7. **Search Normalization:** Must use `NormalizeSearchQuery()` in all search queries for accent handling
8. **AssetID Format:** Always displays as `000-001` format (3-3 digits with dash separator)
9. **Storage Path Handling:** Windows paths require special handling in gocloud.dev connection strings
10. **Schema Mixins:** BaseMixin provides id/created_at/updated_at - never redefine these fields in entities
