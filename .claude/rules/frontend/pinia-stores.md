---
paths:
  - "frontend/stores/**"
---

# Pinia Store Architecture

## Lazy-Loading Getter Pattern

**CRITICAL:** HomeBox uses a non-standard lazy-loading pattern for Pinia stores.

## Pattern Overview

Instead of eagerly loading data, stores use lazy-loading getters that trigger API calls on first access:

```typescript
// stores/labels.ts pattern
import { defineStore } from 'pinia';
import { useUserApi } from '~/composables/use-user-api';

export const useLabelsStore = defineStore('labels', {
  state: () => ({
    allLabels: null as LabelOut[] | null,
    client: useUserApi(),
  }),

  getters: {
    labels(state): LabelOut[] {
      // Lazy load on first access
      if (state.allLabels === null) {
        this.client.labels.getAll().then(result => {
          this.allLabels = result.data;
        });
      }
      return state.allLabels ?? [];
    }
  },

  actions: {
    async refresh() {
      // Manual refresh for updates
      const result = await this.client.labels.getAll();
      this.allLabels = result.data;
    }
  }
});
```

## Why This Pattern?

- **First getter access** triggers API call automatically
- **Subsequent accesses** return cached data (no additional API calls)
- **Manual refresh** via `refresh()` action when needed
- **WebSocket events** trigger refreshes via eventbus integration

## WebSocket Integration

Stores automatically refresh when WebSocket events are received:

```typescript
// In composables/use-server-events.ts
const labelsStore = useLabelsStore();

on('label.mutation', () => {
  labelsStore.refresh();
});
```

## Available Stores

Current stores using this pattern:
- `stores/labels.ts` - Label management
- `stores/locations.ts` - Location management

## When Adding New Stores

Follow this pattern for consistency:

1. State includes `null` for data (indicates not loaded)
2. Getter checks for `null` and triggers load
3. Action provides manual `refresh()` method
4. Integrate with WebSocket events in `use-server-events.ts`
