---
paths:
  - "frontend/assets/css/**"
  - "frontend/tailwind.config.js"
  - "frontend/components.json"
---

# Styling & UI Framework

## Stack
- TailwindCSS v3 with custom config
- shadcn-vue (Reka UI-based components)
- DaisyUI themes

## Configuration Files
- `tailwind.config.js` - TailwindCSS config
- `components.json` - shadcn-vue config
- `assets/css/main.css` - Global styles

## Theme Switching Pattern
**CRITICAL:** DaisyUI requires direct DOM class manipulation, not just data attributes.

**Composable:** `use-theme.ts`

```typescript
const { setTheme } = useTheme();
setTheme('dark'); // Manipulates <html> class directly
```

**Why:** DaisyUI doesn't support reactive theme switching - must update DOM classes on `<html>` element.
