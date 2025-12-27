---
paths:
  - "frontend/composables/use-auth-context.ts"
---

# Authentication Architecture

## Cookie-Based Auth Pattern

**CRITICAL:** Auth uses singleton pattern with quirky cookie storage.

**Location:** `composables/use-auth-context.ts`

## Storage

- `hb.auth.session` - Stores boolean `"true"` (not actual token!)
- `hb.auth.attachment_token` - Stores actual token for file downloads

## Auth Context

- Singleton `AuthContext` class via `useAuthContext()`
- Auto-logout on 401 via response interceptor:

```typescript
requests.addResponseInterceptor(r => {
  if (r.status === 401) {
    authCtx.invalidateSession();
    navigateTo("/");
  }
});
```

## Cookie Storage Quirk

**Gotcha:** Session cookie stores `"true"` as string, not the JWT token. Actual authentication is handled server-side via HttpOnly cookies.
