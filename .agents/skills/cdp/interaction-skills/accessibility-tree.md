# Accessibility Tree

Use the accessibility tree (axTree) when you want to **find an element by what it is** (role + name) rather than by DOM structure. This is the same insight behind Playwright's `getByRole`/`getByText` and Testing Library — and it's available natively via CDP's `Accessibility` domain.

## Prefer `queryAXTree` for semantic lookups

`Accessibility.queryAXTree` is the primary call — a one-shot semantic query by `role` and/or `accessibleName`, no `Accessibility.enable` needed. Two requirements in current Chrome:

1. **It needs a `nodeId`** — a DOM nodeId from `DOM.getDocument`/`querySelector` (or a `backendNodeId`/`objectId`). The bare `{role, accessibleName}` form errors with "Either nodeId, backendNodeId or objectId must be specified." Pass the document root to query the whole page.
2. **Call it on the active session** — `session.use(targetId)` then `session.Accessibility.queryAXTree(...)`. Do **not** route it through the `cdp(sessionId, "Accessibility.queryAXTree", …)` shim; that path hangs (see Traps).

```js
await session.use(targetId)
const { root } = await session.DOM.getDocument({})
// Find a button labeled "Submit" anywhere on the page
const { nodes } = await session.Accessibility.queryAXTree({ nodeId: root.nodeId, role: 'button', accessibleName: 'Submit' })

// Find all links named "Learn more"
const { nodes } = await session.Accessibility.queryAXTree({ nodeId: root.nodeId, accessibleName: 'Learn more' })

// Find all checkboxes on the page
const { nodes } = await session.Accessibility.queryAXTree({ nodeId: root.nodeId, role: 'checkbox' })
```

Each returned `AXNode` carries `nodeId`, `role`, `name`, `backendDOMNodeId`, `properties` — but also verbose `sources`, `chromeRole`, and nested `{type, value}` wrappers (one link ≈ 280 tokens raw). Trim to what you act on:

```js
const compact = nodes.filter(n => !n.ignored).map(n => ({
  role: n.role?.value, name: n.name?.value?.trim(), backendDOMNodeId: n.backendDOMNodeId,
  state: Object.fromEntries((n.properties || []).filter(p => p.value && 'value' in p.value).map(p => [p.name, p.value.value])),
}))   // ~30 tokens per node
```

For whole-page exploration when you don't know what to ask for, snapshot the compressed tree instead — see [`snapshot.md`](snapshot.md).

## From AXNode to coordinates

`queryAXTree` gives you `backendDOMNodeId`. Bridge to click coordinates via `DOM.getBoxModel`:

```js
// root.nodeId from DOM.getDocument; queryAXTree on the active session (see above)
const { nodes } = await session.Accessibility.queryAXTree({ nodeId: root.nodeId, role: 'button', accessibleName: 'Submit' })
const node = nodes.find(n => !n.ignored)
if (!node || !node.backendDOMNodeId) throw new Error('not found')

const { model } = await session.DOM.getBoxModel({ backendNodeId: node.backendDOMNodeId })
const [x, y] = model.border   // top-left corner
const width = model.width
const height = model.height

await session.Input.dispatchMouseEvent({ type: 'mousePressed',  x: x + width/2, y: y + height/2, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: x + width/2, y: y + height/2, button: 'left', clickCount: 1 })
```

## Reading element state

`AXNode.properties` carries semantic state — `checked`, `selected`, `expanded`, `disabled`, `focused`, `pressed`, `required`, `readonly`, etc. No need to evaluate JS to read these:

```js
const { nodes } = await session.Accessibility.queryAXTree({ nodeId: root.nodeId, role: 'checkbox', accessibleName: 'Accept terms' })
const node = nodes.find(n => !n.ignored)

// Find the checked property
const checked = node.properties?.find(p => p.name === 'checked')?.value
// checked.value → true | false | "mixed" | undefined
```

## Scoping to a subtree

Pass `nodeId`, `backendNodeId`, or `objectId` to scope the query to a subtree:

```js
// Get the DOM node for a container first
const { root } = await session.DOM.getDocument({})
const { nodeId } = await session.DOM.querySelector({ nodeId: root.nodeId, selector: '#settings-panel' })

// Now find buttons only inside that container
const { nodes } = await session.Accessibility.queryAXTree({ nodeId, role: 'button' })
```

## Shadow DOM penetration

The axTree crosses shadow boundaries automatically. You don't need `pierceShadow` or a recursive JS walk — `queryAXTree` sees through open (and even closed) shadow roots:

```js
// Finds the button even if it lives inside a closed shadow root (nodeId from DOM.getDocument)
const { nodes } = await session.Accessibility.queryAXTree({ nodeId: root.nodeId, role: 'button', accessibleName: 'Login' })
```

## When to use each method

| Method | When to use it |
|---|---|
| `queryAXTree` | **Default for targeted finds.** By role and/or name. Needs a DOM `nodeId`; call on the active session. No enable needed. |
| `getPartialAXTree` | Get a node's ancestors + siblings + children. Takes a DOM `nodeId` or `backendNodeId`. |
| `getChildAXNodes` | Walk the tree downward from a known `AXNodeId`. |
| `getRootAXNode` | Get the root AX node for a frame. Needs `Accessibility.enable`. Entry point for AX-tree walks. |
| `getFullAXTree` | **Whole-page dump.** No enable; works via either path. On very large pages the response can exceed the WS per-message limit and close the socket (a general connection limit — see [`connection.md`](connection.md)); scope to a subtree (`getPartialAXTree`) or `queryAXTree` the region. Compress with [`axView`](snapshot.md). |
| `getAXNodeAndAncestors` | Trace the path from a node up to the root. Useful for understanding context. |

## `Accessibility.enable` — when you need it

You don't need `Accessibility.enable` for `queryAXTree` or `getFullAXTree` (both work without it). You **do** need it for `getRootAXNode`, `getChildAXNodes`, and the other AX-walk methods. The other reason to call `Accessibility.enable` is to make **AXNodeIds stable across multiple calls** (without it, node IDs can shift between queries). Enable it when you're doing a multi-step tree walk and need to reference nodes by ID across calls:

```js
await session.Accessibility.enable()
// ... multiple queries referencing the same AXNodeId ...
await session.Accessibility.disable()
```

Note: enabling the accessibility domain turns on accessibility for the page, which can impact runtime performance. Always `disable` when done.

## Common roles

These cover the vast majority of lookups:

| Role | What it matches |
|---|---|
| `button` | `<button>`, `<input type="submit|reset|button">`, `[role="button"]` |
| `link` | `<a href>`, `[role="link"]` |
| `textbox` | `<input type="text|search|email|...">`, `<textarea>`, `[role="textbox"]` |
| `checkbox` | `<input type="checkbox">`, `[role="checkbox"]` |
| `radio` | `<input type="radio">`, `[role="radio"]` |
| `combobox` | `<select>` (sometimes rendered as `combobox`), `[role="combobox"]` |
| `heading` | `<h1>`–`<h6>`, `[role="heading"]` |
| `dialog` | `<dialog>`, `[role="dialog"]` |
| `tab` | `[role="tab"]` |
| `tablist` | `[role="tablist"]` |
| `menuitem` | `[role="menuitem"]` |
| `switch` | `[role="switch"]` |
| `slider` | `<input type="range">`, `[role="slider"]` |
| `grid` | `[role="grid"]` (tables with interactive cells) |
| `listbox` | `[role="listbox"]` |
| `option` | `[role="option"]` |
| `navigation` | `<nav>`, `[role="navigation"]` |
| `main` | `<main>`, `[role="main"]` |
| `img` | `<img>` (with alt text), `[role="img"]` |

## When axTree doesn't help

- **Canvas / SVG without ARIA** — pure drawing surfaces have no semantic nodes. Fall back to screenshots + coordinate clicks.
- **Non-semantic `<div>` mush** — unlabelled divs used as buttons or containers may appear as generic roles with no name. Use screenshots + DOM selectors instead.
- **Layout-only elements** — wrappers, spacers, and structural containers are often `ignored: true` in the axTree. They don't exist semantically and shouldn't be interacted with directly.

## Traps

- **`ignored: true` nodes.** `queryAXTree` returns ignored nodes too. Always filter with `nodes.find(n => !n.ignored)` before using a result.
- **`backendDOMNodeId` can be undefined.** Purely structural or virtual nodes may not have a backing DOM node. Check before calling `DOM.getBoxModel`.
- **Multiple matches.** `queryAXTree` returns all matching nodes, not just the first. If there are several buttons named "Add", disambiguate by checking `properties` (e.g. `disabled` state), by scoping to a subtree, or by index after screenshot verification.
- **`queryAXTree` hangs on the `cdp(sessionId, …)` path.** Routing it through the explicit-sessionId shim (`cdp(sessionId, "Accessibility.queryAXTree", …)`) does not return. Call it on the active session: `session.use(targetId)` then `session.Accessibility.queryAXTree(…)`. `getFullAXTree` does not have this issue and works via either path.
- **`getFullAXTree` can drop the socket on very large pages.** A giant page's full tree (huge tables, infinite lists) can exceed the WS per-message limit and close the connection (`CDP socket closed`) — a general connection limit that any large CDP response can hit (see [`connection.md`](connection.md)). For a known-large page, scope with `getPartialAXTree({ backendNodeId })` or `queryAXTree` the region instead of dumping the whole tree; `await session.connect()` to reconnect if it closes.
