---
paths:
  - "frontend/pages/**"
---

# Page Routing Structure

Nuxt file-based routing:

```
pages/
  index.vue                    # Root redirect
  home/index.vue              # Dashboard
  items.vue                   # Items list
  item/[id]/
    index.vue                 # Item detail
    index/edit.vue            # Item edit (nested)
    index/maintenance.vue     # Item maintenance log
  location/[id].vue           # Location detail
  locations.vue               # Locations list
  label/[id].vue             # Label detail
  profile.vue                # User profile
  a/[id].vue                 # Asset shortlink
  assets/[id].vue            # Asset detail
  tools.vue                  # Tools page
  maintenance.vue            # Maintenance overview
  reports/label-generator.vue # Label generation
```

## Patterns
- `[id]` - Dynamic route parameter
- `index.vue` - Default route for directory
- `index/edit.vue` - Nested route under index

## Adding New Pages

### 1. Create Page File
Create file in `pages/` directory with appropriate name:

```vue
<!-- pages/items.vue -->
<script setup lang="ts">
// Page logic
</script>

<template>
  <!-- Page content -->
</template>
```

### 2. Dynamic Routes
Use `[param]` syntax for dynamic segments:

```
pages/item/[id].vue      → /item/:id
pages/item/[id]/edit.vue → /item/:id/edit
```

Access param in component:
```typescript
const route = useRoute();
const itemId = route.params.id;
```

### 3. Nested Routes
Create nested routes using directory structure:

```
item/
  [id]/
    index.vue         → /item/:id
    index/
      edit.vue        → /item/:id/edit
      maintenance.vue → /item/:id/maintenance
```
