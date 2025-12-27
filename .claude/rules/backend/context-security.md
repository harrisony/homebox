---
paths:
  - "backend/app/api/handlers/**"
  - "backend/internal/core/services/**"
---

# Critical Context Pattern

**Location:** `internal/core/services/contexts.go`

## The Custom Context Type

**CRITICAL:** This is NOT standard Go context - it's a custom wrapper for multi-tenancy.

```go
type Context struct {
    context.Context
    UID uuid.UUID     // User ID
    GID uuid.UUID     // Group ID (CRITICAL for multi-tenancy)
    User *repo.UserOut
}
```

## Required Usage in All Handlers

**Every authenticated handler MUST call:**

```go
ctx := services.NewContext(r.Context())
```

This extracts user and group information from the request context (set by middleware) and wraps it in the custom Context type.

## Context Extraction Helpers

Use these functions to extract from context:

```go
// Extract user context
func UseUserCtx(ctx context.Context) *Context

// Extract token and user context
func UseTokenCtx(ctx context.Context) (*repo.AuthToken, *Context, error)
```

## Why This Pattern Exists

- **Multi-tenancy isolation:** Group ID (GID) is the ONLY place where data filtering happens
- **Security:** Missing this call = nil user + broken group filtering = data leak
- **Every repository query** must filter by GID for proper tenant isolation
- **Convenience:** Wraps user information for easy access in services

## Common Gotchas

**Missing context initialization:**
```go
// ❌ WRONG - bypasses multi-tenancy
result := svc.Items.GetAll(r.Context())

// ✅ CORRECT - includes user/group
ctx := services.NewContext(r.Context())
result := svc.Items.GetAll(ctx)
```

**Forgetting to filter by group:**
```go
// ❌ WRONG - returns items from ALL groups (security bug!)
items := r.db.Item.Query().All(ctx)

// ✅ CORRECT - filters by user's group
userCtx := services.UseUserCtx(ctx)
items := r.db.Item.Query().
    Where(item.GroupID(userCtx.GID)).
    All(ctx)
```
