# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

@.claude/rules/overview.md
@.claude/rules/commands.md

## Critical Rules (Security & Architecture)

**CRITICAL:** These rules MUST be followed to prevent security bugs and runtime panics.

1. **Context pattern required** - Every authenticated handler MUST call `services.NewContext(r.Context())` for multi-tenancy isolation. See @.claude/rules/backend/context-security.md

2. **Middleware order matters** - `mwAuthToken` MUST come BEFORE `mwRoles` or runtime panic occurs. See @.claude/rules/backend/middleware.md

3. **Never edit generated files:**
   - `frontend/lib/api/types/data-contracts.ts` (TypeScript types)
   - `frontend/components/ui/*` (Shadcn-vue components)
   - `backend/internal/data/ent/*.go` (Entgo generated code - except `schema/` subdirectory)

4. **Always run code generation** after schema/API changes:
   ```bash
   task generate           # Run all generators
   ```

5. **Dual migrations required** - Both SQLite AND PostgreSQL migrations needed for every schema change. See @.claude/rules/code-generation.md

## Common Workflows

@.claude/rules/workflows.md
@.claude/rules/code-generation.md

## Backend Architecture & Patterns

@.claude/rules/backend/architecture.md
@.claude/rules/backend/context-security.md
@.claude/rules/backend/middleware.md
@.claude/rules/backend/handlers.md
@.claude/rules/backend/swagger.md
@.claude/rules/backend/ent-schema.md
@.claude/rules/backend/repository-pattern.md
@.claude/rules/backend/service-pattern.md
@.claude/rules/backend/error-handling.md
@.claude/rules/backend/websocket.md
@.claude/rules/backend/storage.md
@.claude/rules/backend/special-types.md
@.claude/rules/backend/testing.md

## Frontend Architecture & Patterns

@.claude/rules/frontend/nuxt-config.md
@.claude/rules/frontend/components.md
@.claude/rules/frontend/routing.md
@.claude/rules/frontend/styling.md
@.claude/rules/frontend/pinia-stores.md
@.claude/rules/frontend/api-client.md
@.claude/rules/frontend/auth.md
@.claude/rules/frontend/composables.md
@.claude/rules/frontend/testing.md

## Infrastructure & Development

@.claude/rules/infra/environment.md
@.claude/rules/infra/ci-cd.md
@.claude/rules/infra/git.md
@.claude/rules/infra/documentation.md
