---
paths:
  - "frontend/components/**"
---

# Component Organization

## Auto-Imported (No Import Needed)
**Location:** `components/global/*`

Examples: `Currency`, `DateTime`, `Markdown`, `DropZone`

## Manual Import Required
- `components/App/*` - Application-level (modals, header)
- `components/Base/*` - Base UI primitives
- `components/Form/*` - Form controls
- `components/Item/*` - Item-specific components
- `components/Location/*` - Location tree and selectors
- `components/ui/*` - shadcn-vue components (**DO NOT EDIT**)

## Shadcn-vue Components
**Location:** `components/ui/*`

**CRITICAL:** Never edit manually - managed by `shadcn-nuxt`.
- Customize via `components.json` config
- Add new components: `npx shadcn-vue@latest add <name>`

## Adding shadcn Components

### 1. Install Component
```bash
npx shadcn-vue@latest add <component-name>
```

Examples:
```bash
npx shadcn-vue@latest add button
npx shadcn-vue@latest add dialog
npx shadcn-vue@latest add dropdown-menu
```

### 2. Configuration
Components installed based on `components.json`:

```json
{
  "style": "default",
  "typescript": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "assets/css/main.css"
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

### 3. Usage
Import and use in components:

```vue
<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
</script>

<template>
  <Button @click="handleClick">Click me</Button>

  <Dialog>
    <DialogContent>
      <DialogHeader>Title</DialogHeader>
      Content here
    </DialogContent>
  </Dialog>
</template>
```

**Remember:** Never edit files in `components/ui/` manually - they're managed by shadcn-vue CLI.
