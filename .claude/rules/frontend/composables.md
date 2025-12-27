---
paths:
  - "frontend/composables/**"
---

# Key Composables Reference

## Authentication & API
- **`use-auth-context.ts`** - Singleton auth with cookie management
- **`use-api.ts`** - API client factory with response interceptors

## UI & Formatting
- **`use-formatters.ts`** - Currency/date formatting with caching
  - Currency formatter preloads group currency asynchronously
  - Date formatting respects locale preferences
  - Cache invalidation via `resetCurrency()`
- **`use-theme.ts`** - DaisyUI theme switching (direct DOM manipulation required)

## Data & Search
- **`use-item-search.ts`** - Debounced search with race-condition handling
- **`use-location-helpers.ts`** - Location tree manipulation utilities
- **`use-server-events.ts`** - WebSocket listener with 1000ms throttling

## UX Utilities
- **`use-confirm.ts`** - Confirmation dialogs
- **`use-min-loader.ts`** - Minimum loading time for better UX
- **`use-preferences.ts`** - View preferences with localStorage sync

## Search & Debouncing Patterns

### Debounced Search with Race Prevention

**Pattern:** `composables/use-item-search.ts`

**Problem:** User types faster than API responds, causing race conditions.

**Solution:**
- 250ms debounce on query input
- `pendingQuery` tracks latest query during active search
- Re-executes with latest query if user types during search
- `isLoading` guard prevents overlapping API calls

```typescript
const search = async () => {
  if (isLoading.value) {
    pendingQuery.value = query.value;
    return;
  }

  isLoading.value = true;
  const result = await api.items.search(query.value);
  results.value = result.data;
  isLoading.value = false;

  // Re-run if query changed during search
  if (pendingQuery.value !== query.value) {
    const pending = pendingQuery.value;
    pendingQuery.value = null;
    query.value = pending;
  }
};

watchDebounced(query, search, { debounce: 250, maxWait: 1000 });
```

## Currency & Date Formatting Patterns

**Currency Formatting:**
```typescript
// Caches group currency, preloads formatter
const fmtCurrency = await useFormatCurrency();
fmtCurrency(123.45); // "$123.45"

// Reset cache when group settings change
resetCurrency();
```

**Date Formatting:**
```typescript
const { fmtDate } = useFormatters();

fmtDate(date, "relative");  // "2 hours ago (Jan 1, 2024)"
fmtDate(date, "human");     // "January 1, 2024"
fmtDate(date, "long");      // "Jan 1, 2024"
fmtDate(date, "short");     // "1/1/24"
```

Respects `overrideFormatLocale` preference or falls back to i18n locale.
