---
paths:
  - "backend/app/api/middleware.go"
  - "backend/app/api/routes.go"
---

# Middleware Chain Pattern

**Location:** `app/api/middleware.go`, `app/api/routes.go`

## Critical Ordering Rule

**RUNTIME PANIC if wrong order:**

```go
mwAuthToken   // MUST be first - sets user in context
mwRoles       // MUST be after mwAuthToken or PANICS
```

## Why Order Matters

- `mwAuthToken` extracts JWT from request and stores user in context
- `mwRoles` expects user to exist in context (panics if nil)
- Middleware is applied in order, creating a chain

## Authentication Flow

1. **Token extraction** (priority order):
   - Cookies (highest priority)
   - Authorization header
   - Query parameter (lowest priority)

2. **Cookie storage quirk:**
   - Cookie token stored as string `"true"` (not the actual JWT!)
   - Actual auth happens server-side via HttpOnly cookies

3. **Separate token for attachments:**
   - `attachmentToken` for file downloads
   - Prevents exposing main auth token in download URLs

4. **Role checking:**
   - Roles queried via `repos.AuthTokens.GetRoles()`
   - Role enforcement in `mwRoles` middleware

## Middleware Application Example

```go
// From routes.go
r.Group(func(r chi.Router) {
    r.Use(ctrl.mwAuthToken)  // FIRST - sets user
    r.Use(ctrl.mwRoles)      // SECOND - checks roles

    // Protected routes here
    r.Get("/items", ctrl.HandleItemsGetAll())
})
```

## Common Gotcha

**Adding middleware in wrong order causes runtime panic:**

```go
// ❌ WRONG - WILL PANIC at runtime
r.Use(ctrl.mwRoles)      // Panics: user not in context
r.Use(ctrl.mwAuthToken)

// ✅ CORRECT
r.Use(ctrl.mwAuthToken)
r.Use(ctrl.mwRoles)
```
