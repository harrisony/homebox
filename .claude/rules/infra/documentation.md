# Documentation Structure

## VitePress Documentation Site

HomeBox uses VitePress for user-facing documentation in the `docs/` directory.

### Key Files

- `docs/.vitepress/config.mts` - Main VitePress configuration
- `docs/.vitepress/menus/en.mts` - English navigation menu (export default array)
- `docs/en/*.md` - English documentation pages

### Menu Structure Pattern

Navigation menus are defined as TypeScript exports:

```typescript
// docs/.vitepress/menus/en.mts
export default [
    {
        text: 'Section Name',
        items: [
            {text: 'Page Title', link: '/en/page-slug'},
        ]
    },
]
```

### When Adding Documentation

1. Create markdown file in `docs/en/` (or appropriate language directory)
2. Add entry to `docs/.vitepress/menus/en.mts`
3. Use VitePress markdown features (containers, code blocks, etc.)

### Local Development

```bash
pnpm docs:dev       # Start VitePress dev server
pnpm docs:build     # Build static site
pnpm docs:preview   # Preview built site
```

### Navigation Pattern

Menu files are language-specific (e.g., `/en/`, `/fr/`), allowing independent slugs per language.

Example menu structure from the codebase:

```typescript
{
    text: 'Getting Started',
    items: [
        {text: 'Quick Start', link: '/en/quick-start'},
        {text: 'Installation', link: '/en/installation'},
    ]
},
{
    text: 'API Reference',
    items: [
        {text: 'OpenAPI Specification', link: '/en/api/openapi-3.0.json'},
    ]
}
```

### API Documentation Integration

Swagger/OpenAPI specs are automatically copied to `docs/en/api/` during code generation:

- `task swag` generates Swagger 2.0 and converts to OpenAPI 3.0
- Files copied:
  - `swagger-2.0.json` / `swagger-2.0.yaml`
  - `openapi-3.0.json` / `openapi-3.0.yaml`

These can be referenced in VitePress docs for API documentation.

### VitePress Markdown Features

VitePress supports extended markdown:

- **Custom containers**: `::: tip`, `::: warning`, `::: danger`
- **Code groups**: Tabs for different languages/examples
- **Line highlighting**: Code blocks with line numbers
- **Frontmatter**: YAML metadata at top of files

Example:

```markdown
---
title: Page Title
description: Page description for SEO
---

# Page Heading

::: tip
This is a helpful tip!
:::
```
