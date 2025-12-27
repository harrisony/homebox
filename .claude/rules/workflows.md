# Common Workflows

## Adding a New API Endpoint

1. Add handler method to `backend/app/api/handlers/v1/v1_ctrl_*.go`
2. Add Swagger annotations (see backend/swagger.md)
3. Add business logic to service in `backend/internal/core/services/`
4. Add route in `backend/app/api/routes.go`
5. Run `task swag` to generate Swagger docs
6. Run `task typescript-types` to update frontend types
7. Run tests: `task go:test`

## Adding a New Database Entity

1. Create schema in `backend/internal/data/ent/schema/`
   - Use mixins: BaseMixin, DetailsMixin, GroupMixin (see backend/ent-schema.md)
2. Run `task db:generate` to generate Entgo code
3. Create migrations in **both** `backend/internal/data/migrations/sqlite3/` and `backend/internal/data/migrations/postgres/`
4. Add repository methods in `backend/internal/data/repo/`
5. Add service methods in `backend/internal/core/services/`
6. Update migration tool in `backend/internal/data/migrate/` (see [DEVELOPING.md](DEVELOPING.md#database-migration-feature))
7. Follow "Adding a New API Endpoint" workflow

## Adding a New Frontend Feature

1. Create components in `frontend/components/`
2. Add pages in `frontend/pages/` if new routes needed
3. Add API calls using auto-generated types from `frontend/lib/api/types/`
4. Add i18n translations in `frontend/locales/*.json`
5. Write tests in `frontend/test/`
6. Run `task ui:fix` before committing
