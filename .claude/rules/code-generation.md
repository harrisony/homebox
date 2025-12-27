# Code Generation Dependencies

## Critical Rules

- **Always run code generation** after modifying schemas or API handlers
- Swagger must be regenerated for API changes to reflect in frontend
- TypeScript types are generated from Swagger, not from Go code directly
- **NEVER edit generated files manually:**
  - `frontend/lib/api/types/data-contracts.ts` (TypeScript types)
  - `frontend/components/ui/*` (Shadcn-vue components)
  - `backend/internal/data/ent/*.go` (Entgo generated code - except `schema/` subdirectory)

## Generation Commands

```bash
task generate           # Run all code generation tasks
task swag               # Generate Swagger API docs only
task typescript-types   # Generate TypeScript types only
task db:generate        # Generate Entgo code only
```

## Database Migrations

- Both SQLite and PostgreSQL migrations are **required** for any schema change
- Migration files live in separate directories:
  - `backend/internal/data/migrations/sqlite3/`
  - `backend/internal/data/migrations/postgres/`
- See [DEVELOPING.md](DEVELOPING.md#database-migration-feature) for guidance on adding entities to the migration tool

## API Documentation

- All API handlers **must** have Swagger annotations
- Use `@Summary`, `@Tags`, `@Accept`, `@Produce`, `@Param`, `@Success`, `@Failure`, `@Router`, `@Security`
- See backend/swagger.md for complete annotation guide

## Frontend Conventions

- Only `components/global/*` are auto-imported; all others require manual imports
- Pinia stores use lazy-loading getters (not eager actions)
- Frontend dev server expects backend at `http://localhost:7745`
- Tests require backend running and may fail on first run (race conditions)
