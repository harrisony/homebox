# Components (Vue 3 + `<script setup>`)

Everything here applies to `components/` **outside** `components/ui/`. ShadCN-generated
files track upstream shadcn-vue. Prettier ignores that directory and ESLint relaxes selected
generated-code rules, so leave generated files' style alone.

General frontend conventions (Composition API only, named exports, theme tokens over raw
Tailwind colors, where types live) are in [`../AGENTS.md`](../AGENTS.md#code-conventions).
This file covers component authoring only.

Components are **not** auto-imported: `nuxt.config.ts` sets `components: { dirs: [] }`, so
every component outside `components/ui/` needs an explicit `import`, and its name is
whatever the import site calls it.

## Settled

These conventions reflect project decisions. Verify the live source before making broader
claims about the tree.

- **PascalCase component names in source.** `<ItemCard>`, `<FormTextField>`.
- **Compose names general to specific.** The directory does most of this for you:
  `Item/Card.vue` imports as `ItemCard`, `Tag/Selector.vue` as `TagSelector`. Prefer
  `SearchButtonClear` over `ClearSearchButton`. Put new components in a domain directory
  instead of growing the component root.
- **camelCase in the script block, kebab-case in templates**, for both props and emits.
  `modelValue` and `"update:modelValue"` in TypeScript, `@update:model-value` in the
  template. Preserve native attribute casing such as SVG's `viewBox`.
- **Slot shorthand.** `<template #default>`, never `<template v-slot:default>`.
- **Keep props bare when only the template reads them.** Use bare `defineProps<{...}>()` in
  that case. When the script reads individual props, prefer reactive destructuring.

## Target

Apply these rules to new code and to relevant lines in components you are already editing.
They describe where the code is going, not where it is. Do not convert unrelated parts of a
file automatically. If whole-file cleanup would be useful but is unrelated to the requested
change, ask the user whether they want it before editing those lines. None of this is
lint-enforced yet.

### `defineModel()` instead of `useVModel()`

Some components hand-roll two-way binding with a `modelValue` prop, an
`update:modelValue` emit and VueUse's `useVModel`. We are on Vue 3.5, where `defineModel`
does all three.

```vue
<script setup lang="ts">
  // Current tree (Form/Checkbox.vue)
  const props = defineProps({
    modelValue: { type: Boolean, default: false },
  });
  const emit = defineEmits(["update:modelValue"]);
  const value = useVModel(props, "modelValue", emit);

  // Target
  const value = defineModel<boolean>({ default: false });
</script>
```

Name additional models explicitly, and bind them kebab-cased:

```vue
<script setup lang="ts">
  const search = defineModel<string>("search");
  const selected = defineModel<ItemSummary | null>("selected");
</script>

<template>
  <ItemSelector v-model:search="search" v-model:selected="selected" />
</template>
```

`defineModel` also takes `get` and `set` for transforms, and destructures to
`const [value, modifiers] = defineModel<string>()` when the component honours custom
modifiers. Read <https://vuejs.org/guide/components/v-model.md#handling-v-model-modifiers>
before implementing modifiers.

### Type-based `defineProps` and `defineEmits`

For new or migrated declarations, prefer type-based declarations so prop and emit payload
types stay explicit in one place.

```vue
<script setup lang="ts">
  const props = defineProps<{ template: EntityTemplateSummary }>();

  const emit = defineEmits<{
    deleted: [];
    duplicated: [id: string];
  }>();
</script>
```

Declare the shape inline unless a named type improves reuse or clarity. Name the emit
function `emit`, not `emits`.

### Destructured props for defaults

Vue 3.5 makes destructured props reactive, so defaults belong in the destructuring rather
than in `withDefaults` or a runtime `default:`.

```vue
<script setup lang="ts">
  // Target
  const { size = "md", inline = false } = defineProps<{
    size?: "sm" | "md" | "lg";
    inline?: boolean;
  }>();
</script>
```

Destructured props stay reactive in the template and in `computed`/`watch` bodies. Pass
`() => size` rather than `size` when handing one to a composable that expects a getter.

### Same-name prop shorthand

Use `:count` instead of `:count="count"` when the value and the prop share a name.

```vue
<template>
  <FormTextField :id :label v-model="value" />
</template>
```

### Explicit `<template>` tags for used slots

At the call site, name the slot you are filling, including the default one.

```vue
<template>
  <BaseCard>
    <template #title>{{ $t("tools.reports") }}</template>
    <template #default>
      <ToolsList />
    </template>
  </BaseCard>
</template>
```

In the component that owns the slots, declare them with `defineSlots` so call sites get
typed slot props.

```vue
<script setup lang="ts">
  defineSlots<{
    default(): unknown;
    title?(): unknown;
    display?(props: { item: ItemSummary }): unknown;
  }>();
</script>
```

### File naming

PascalCase, matching the component name: `PhotoUploader.vue`, not `photo-uploader.vue`.
Keep the existing kebab-case files under `components/Item/View/table/` internally
consistent rather than half-renaming the directory.

## Enforcement

Treat these primarily as review conventions. Do not assume ESLint enforces them, and do
not add or change lint rules as part of an unrelated component edit.
