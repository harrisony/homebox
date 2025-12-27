---
paths:
  - "frontend/test/**"
  - "frontend/lib/api/__test__/**"
---

# Testing Patterns

## Test Utilities

**Location:** `frontend/lib/api/__test__/test-utils.ts`

## Shared Client Pattern

Tests use a shared authenticated client to avoid repeated login:

```typescript
import { sharedUserClient } from '~/lib/api/__test__/test-utils';

describe('Item API', () => {
  it('should create item', async () => {
    const client = await sharedUserClient();

    const result = await client.items.create({
      name: 'Test Item',
      // ...
    });

    expect(result.data).toBeDefined();
  });
});
```

### How It Works

1. First test tries to login with default credentials
2. Falls back to user registration if login fails
3. Caches authentication token
4. Subsequent tests reuse the token (no login overhead)

## Test Factories

**Location:** `frontend/lib/api/__test__/factories/`

Uses `@faker-js/faker` for generating test data:

```typescript
import { faker } from '@faker-js/faker';

export function createTestItem() {
  return {
    name: faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    quantity: faker.number.int({ min: 1, max: 100 }),
  };
}
```

### Client Factory

Creates `PublicApi` and `UserClient` instances for testing:

```typescript
import { factories } from '~/lib/api/__test__/factories';

const client = factories.client();
const userClient = await factories.userClient(); // Authenticated
```

## E2E Testing (Playwright)

### Framework

- **Framework:** Playwright
- **Config:** `frontend/test/playwright.config.ts`
- **Pattern:** `.browser.spec.ts` suffix

### E2E Test Location

`frontend/test/e2e/`

### Example Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Item Management', () => {
  test('should create new item', async ({ page }) => {
    await page.goto('/items');

    await page.click('[data-testid="create-item-btn"]');
    await page.fill('[data-testid="item-name"]', 'Test Item');
    await page.click('[data-testid="submit-btn"]');

    await expect(page.locator('text=Test Item')).toBeVisible();
  });
});
```

### Running E2E Tests

```bash
task test:e2e           # Runs Playwright tests (starts backend automatically)
```

## Vitest Unit Tests

### Pattern

- **Suffix:** `.test.ts`
- **Require backend:** Must run `task go:run` first
- **Config:** `frontend/test/vitest.config.ts`

### Running Unit Tests

```bash
# Start backend first
task go:run

# In another terminal
cd frontend
pnpm test:watch         # Watch mode
pnpm test:ci            # CI mode (run once)
```

### Important Testing Notes

- **Race conditions:** Tests may fail on first run due to race conditions
- **Re-run:** If tests fail initially, re-run them
- **Backend required:** Frontend tests validate against live backend
- **API client tests:** Test auto-generated TypeScript types against real API

### Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { sharedUserClient } from '~/lib/api/__test__/test-utils';

describe('Items API', () => {
  it('should fetch all items', async () => {
    const client = await sharedUserClient();

    const result = await client.items.getAll({
      page: 1,
      pageSize: 10,
    });

    expect(result.data.items).toBeDefined();
    expect(Array.isArray(result.data.items)).toBe(true);
  });
});
```

## Component Testing Best Practices

### Data Test IDs

Use `data-testid` attributes for E2E test selectors:

```vue
<template>
  <button data-testid="create-item-btn">
    Create Item
  </button>
</template>
```

### Avoid Implementation Details

Test user-facing behavior, not internal implementation:

```typescript
// ✅ Good - Tests behavior
await page.click('[data-testid="create-item-btn"]');
await expect(page.locator('text=Test Item')).toBeVisible();

// ❌ Bad - Tests implementation
expect(component.vm.items.length).toBe(1);
```

### Composable Testing

Test composables in isolation when possible:

```typescript
import { useLabelsStore } from '~/stores/labels';

describe('useLabelsStore', () => {
  it('should load labels on first access', async () => {
    const store = useLabelsStore();

    // First access triggers load
    const labels = store.labels;

    // Wait for async load
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(store.allLabels).not.toBeNull();
  });
});
```
