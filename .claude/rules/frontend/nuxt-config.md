---
paths:
  - "frontend/nuxt.config.ts"
---

# Nuxt 4 Configuration

## Critical Nuxt Settings

### SSR Disabled
- **Setting:** `ssr: false` in `nuxt.config.ts`
- **Impact:** SPA-only application (no server-side rendering)
- **Why:** HomeBox is an inventory app, not content site - no SEO benefit

### Component Auto-Import Disabled
- **Setting:** `components: false` in Nuxt config
- **Exception:** `components/global/` directory IS auto-imported
- **Impact:** Must manually import all components except `global/`

**Example:**
```vue
<script setup lang="ts">
import ItemCard from '@/components/Item/Card.vue';  // Required
import Currency from '@/components/global/Currency.vue';  // NOT required
</script>
```

### Dev Proxy Configuration
- `/api` routes proxy to `http://localhost:7745/api`
- WebSocket support enabled for real-time events
- Backend must run on port 7745 during development

### PWA Configuration
- **Plugin:** Vite PWA plugin with service worker
- **Configuration:** `nuxt.config.ts` PWA module settings
- **Features:** Offline support, app installation, background sync
- **Purpose:** Enables installation as native app on mobile devices

## Development Gotchas

### 1. Type Generation Dependency
After backend Swagger changes, regenerate TypeScript types:
```bash
task typescript-types  # Run from project root
```

**NEVER** edit `lib/api/types/data-contracts.ts` manually.

### 2. Component Auto-Import
Only `components/global/*` are auto-imported. Forgetting this causes runtime errors.

### 3. Backend Dependency
Frontend dev server expects backend at `http://localhost:7745`.
- Start backend first: `task go:run`
- API calls will fail without backend

### 4. ESLint Flat Config
Uses flat config (`eslint.config.mjs`) with:
- Nuxt auto-config from `.nuxt/eslint.config.mjs`
- Tailwind plugin for class validation
- Prettier integration
- Custom ignores imported from `../.gitignore`

**Fix before commit:**
```bash
pnpm lint:fix      # or task ui:fix
```

### 5. i18n Pattern
Locales in `locales/` directory. Use `$t()` in components:

```vue
<template>
  <h1>{{ $t('items.title') }}</h1>
</template>
```

## Pre-Commit Checklist

```bash
pnpm lint:fix      # Fix linting issues
pnpm typecheck     # Ensure type safety
```

Or from project root:
```bash
task ui:fix        # Runs lint:fix
```
