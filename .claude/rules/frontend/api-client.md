---
paths:
  - "frontend/lib/api/**"
  - "frontend/composables/use-api.ts"
  - "frontend/composables/use-user-api.ts"
---

# API Client Architecture

## Multi-Layered Pattern

The frontend uses a 3-layer API client architecture:

**Layer 1: HTTP Client (`lib/requests/requests.ts`)**
- `Requests` class handles all HTTP methods
- Supports response interceptors (401 handling, logging)
- Generic `TResponse<T>` wraps all API responses

**Layer 2: Domain API Clients (`lib/api/user.ts`, `lib/api/public.ts`)**
- `UserClient` - Authenticated endpoints (items, locations, labels)
- `PublicApi` - Unauthenticated endpoints (login, registration)
- Composed of domain-specific classes (e.g., `ItemsApi`, `LabelsApi`)

**Layer 3: Composables (`composables/use-api.ts`)**
- `useUserApi()` - Returns configured `UserClient` with auth context
- `usePublicApi()` - Returns `PublicApi` for login flows
- Auto-handles 401 responses by invalidating session

## Generated Types

**Location:** `lib/api/types/data-contracts.ts`

**CRITICAL:** NEVER edit manually - generated from Swagger via `task typescript-types`

All request/response types are auto-generated from backend Swagger documentation.

## Response Observer Pattern

Global response observers for cross-cutting concerns:

```typescript
// composables/use-api.ts
export function defineObserver(key: string, observer: Observer): RemoveObserver {
  observers[key] = observer;
  return () => delete observers[key];
}
```

**Use cases:**
- Logging and analytics
- Global error handling
- Response transformation
- Audit trails

**Example:**
```typescript
defineObserver('audit-logger', (response) => {
  if (response.status >= 400) {
    console.error('API Error:', response);
  }
});
```

## Common Workflows

### Adding a New API Endpoint (Frontend)
1. Backend adds endpoint and updates Swagger
2. Run `task typescript-types` to regenerate types
3. Add method to appropriate API class in `lib/api/classes/`
4. Use in components via `useUserApi()` or `usePublicApi()`

### Adding a New Pinia Store
1. Create `stores/<name>.ts`
2. Use lazy-loading getter pattern (see frontend/pinia-stores.md)
3. Initialize client with `useUserApi()` in state
4. Add refresh action for manual updates
5. Integrate WebSocket events in `use-server-events.ts`

### Adding a Global Component
1. Create component in `components/global/`
2. Component auto-available in all templates (no import needed)
3. Follow PascalCase naming for auto-import resolution
