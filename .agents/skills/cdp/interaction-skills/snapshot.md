# Compressed a11y snapshot

When you need to *see* the whole page at once — to explore an unfamiliar UI, pick from many options, or summarize layout — snapshot the accessibility tree, compressed. This is the **exploration** tool; for finding one named thing, [`Accessibility.queryAXTree`](accessibility-tree.md) is cheaper and more precise. Use the snapshot when you don't yet know what to ask for.

`Accessibility.getFullAXTree` returns every node verbatim — `sources`, `chromeRole`, ignored wrappers, `InlineTextBox` fragments. On a real page that's **hundreds of thousands of tokens** (a Wikipedia article: 886K). The raw dump is unusable in context. `axView` drops the ~96% that is structural noise and keeps interactive elements + text, assigning `[n]` refs you can act on. Measured on a live Wikipedia article: **886K → 22K tokens**; on an app page: **210K → 7K**. All interactive nodes and content preserved.

This stays **CDP-native**: pure projection over already-fetched AX nodes. No page injection. Refs map to `backendDOMNodeId` for `DOM.*` / `Input.*`.

## Globals

| Global | Role |
|---|---|
| `axView(nodes, opts?)` | Compress AX nodes → tree string (+ optional ref map) |
| `axDiff(prev, next)` | Structural diff of two `axView` strings (refs stripped for compare) |
| `parseAxRefs(view)` | `Map<refNumber, backendDOMNodeId>` from a view string |
| `axClick(ref, refs)` | Click center of a ref (`refs` = Map or the view string) |
| `axType(ref, refs, text)` | Click-focus then `Input.insertText` |

Source: `sdk/axview.ts` + thin helpers in `sdk/repl.ts`. Heuristics are transparent; for power they don't cover — exact `properties`, table grids, custom roles — drop to raw `getFullAXTree` and transform yourself.

## Options

```js
axView(nodes)
axView(nodes, { interactive: true })   // actionable structure only — start here
axView(nodes, { refs: false })         // omit trailing ref map when only reading
axView(nodes, { maxDepth: 4 })         // cap emit depth
axView(nodes, { redactSensitive: false }) // keep password-ish values (default: redact)
```

| Option | Default | Meaning |
|---|---|---|
| `refs` | `true` | Trailing `# refs -> backendDOMNodeId` map |
| `interactive` | `false` | Keep interactive roles + landmarks only (drop bulk StaticText / named content) |
| `maxDepth` | unlimited | Max emit depth from root |
| `redactSensitive` | `true` | Password-ish / protected textbox values → `="[redacted]"` (labels stay) |

## Reading escalation (default agent workflow)

Don't dump the full tree first. Escalate only as needed:

1. **`axView(nodes, { interactive: true })`** — buttons, links, fields, landmarks. Usually enough to act.
2. **`axView(nodes)`** — full compressed tree when you need surrounding text / headings / content.
3. **Wait briefly and re-fetch** only if the page is still changing (SPA hydration, live lists).
4. **Visual check** — `Page.captureScreenshot` when the tree is empty, contradictory, or canvas/non-semantic.

After an action in a multi-step loop, prefer **`axDiff(prev, next)`** over re-reading the whole next tree in the model context. Keep `prev`/`next` as strings in the REPL; print only the diff.

```js
const { nodes: a } = await session.Accessibility.getFullAXTree({})
const prev = axView(a, { interactive: true })
// ... act ...
const { nodes: b } = await session.Accessibility.getFullAXTree({})
const next = axView(b, { interactive: true })
return axDiff(prev, next)
```

Never guess refs. Never truncate a snapshot with `slice` / `substring` and pretend it's complete — if it's too big, use `{ interactive: true }`, `{ maxDepth }`, or scope with `getPartialAXTree` / `queryAXTree`.

## Snapshot the active tab

```js
if (!session.isConnected()) await session.connect()
const tabs = await listPageTargets()
if (!session.getActiveSession()) await session.use(tabs[0].targetId)
await session.Page.enable()
const { nodes } = await session.Accessibility.getFullAXTree({})
return axView(nodes, { interactive: true })
```

Output is an indented tree with `[n]` refs on interactive + named nodes, a trailing `# refs -> backendDOMNodeId` map, and state flags (`<focused checked selected pressed expanded disabled scrollable>`, plus `<mixed>` for tri-state checkboxes, `(h2)`, `="value"`):

```
[1] RootWebArea "Chromium (web browser) - Wikipedia"
  [2] link "Jump to content"
  banner
    [3] navigation "Site"
      [4] button "Main menu"
    search
      [8] searchbox "Search Wikipedia"
      [9] button "Search"
    [13] link "Log in"
  [14] navigation "Contents"
    [15] heading "Contents" (h2)
    [17] link "(Top)"
    [18] link "Licensing"
```

## Acting on a ref

Prefer the helpers (same geometry path as manual CDP):

```js
const { nodes } = await session.Accessibility.getFullAXTree({})
const view = axView(nodes, { interactive: true })
const refs = parseAxRefs(view)
await axClick(9, refs)            // or axClick(9, view)
await axType(8, refs, 'query')    // focus searchbox + insertText
```

Manual path (identical mechanics, useful when you already have `backendNodeId`):

```js
const backendNodeId = parseAxRefs(view).get(7)
const { model } = await session.DOM.getBoxModel({ backendNodeId })
const [x, y] = model.content.slice(0, 2), w = model.width, h = model.height
await session.Input.dispatchMouseEvent({ type: 'mousePressed',  x: x + w/2, y: y + h/2, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: x + w/2, y: y + h/2, button: 'left', clickCount: 1 })
```

For textboxes without `axType`: click to focus, then `Input.insertText`.

**Refs are only valid for the `getFullAXTree` call that produced them.** After navigation, mutation, or many async updates, re-snapshot before acting. Never cache a ref across a page change.

## What it drops (and when to drop below it)

Dropped: `ignored` nodes (bubbled — their children survive at the parent's depth), `InlineTextBox`/`ListMarker`/`LineBreak` leaf fragments, and structural wrappers (`generic`, `none`, `paragraph`, `list`, `listitem`, `table`, `row`, `cell`, `section`, `div`) whose children bubble up. Redundant text is coalesced: a `link "Donate"` whose only child is `StaticText "Donate"` keeps just the link line.

Kept (full mode): every interactive role (incl. `canvas`), headings (with level), landmarks, images with names, and surviving text.

Kept (`interactive: true`): interactive roles + landmarks only (plus ancestors needed to keep structure).

Sensitive values: password-ish / protected textbox values render as `="[redacted]"` by default.

Drop to raw `getFullAXTree` when:
- **Table grid structure matters** — `table`/`row`/`cell` are dropped, so tabular data flattens to a list. If row/column position is signal, snapshot raw or query the table subtree.
- **You need `sources` or exact `properties`** — the compression trims state to common flags. For `required`, `readonly`, `invalid`, `describedby`, read the raw node or `queryAXTree` that one element.
- **A named structural node is meaningful** — e.g. `<time>`/`relative-time` date labels (role `generic`) vanish with the wrapper; `queryAXTree({ accessibleName })` recovers them. Or edit the role sets in `sdk/axview.ts`.

## When to snapshot vs query

| Task | Tool | Cost |
|---|---|---|
| Find one named element ("the Log in link", "the Submit button") | `queryAXTree` (see [`accessibility-tree.md`](accessibility-tree.md)) | ~30 tokens |
| List all of one role (all headings, all links) | `queryAXTree` with just `role` | ~hundreds of tokens |
| Explore actionable UI first | `axView(nodes, { interactive: true })` | smaller than full |
| Explore full layout / content | `axView(nodes)` | 7–22K tokens |
| Multi-step: what changed? | `axDiff(prev, next)` | only deltas |

A full snapshot is **expensive in absolute terms** (7–22K tokens). For multi-step tasks: interactive first, `queryAXTree` when you know the name, re-snapshot only when the page meaningfully changes, and prefer `axDiff` over re-feeding the whole tree.

## Traps

- **`getFullAXTree` is the most common trigger of the WS payload limit.** A giant page's full tree can exceed the CDP WebSocket's per-message size and close the socket (`CDP socket closed`) — this is a property of the *connection*, not axTree; any large CDP response can do it (see [`connection.md`](connection.md)). For a known-large page, scope with `Accessibility.getPartialAXTree({ backendNodeId })` or `queryAXTree` the region instead of the whole-page dump. The next call **auto-heals** the transport, but the flat session is gone (browser tears it down on drop) — the stale `sessionId` rejects with `CDP -32001`; re-`attachToTarget` to the still-existing target and continue. Prefer `{ interactive: true }` before a full dump.
- **A near-empty snapshot with a tell like *'Making sure you're not a bot!'* is a bot/consent wall.** axView faithfully renders the wall, not the page — screenshot to confirm, then handle the wall (wait/retry) or fall back to coordinates.
- **Ignored wrappers carry the real content.** `getFullAXTree` nests the page under `ignored: true` `none`/`generic` nodes; a naive "skip ignored" walk discards the whole subtree. `axView` bubbles their children up — if you write your own over raw `getFullAXTree`, recurse through ignored nodes at the same depth.
- **Duplicate nodeIds.** `getFullAXTree` can emit some virtual nodeIds twice; keep the first occurrence (`axView` does this in `sdk/axview.ts`).
- **Refs are stable only within one `getFullAXTree` call.** After any navigation, mutation, or even some async updates, refs shift. Re-snapshot before acting on stale refs; never cache a ref across a page change.
- **`opts.refs === false`** omits the trailing ref map (the model can still *see* `[n]` labels). The map is the bulk of the "overhead" tokens — drop it when the model only reads, doesn't act. `axClick`/`parseAxRefs` need the map present (or a Map you kept).
- **`axDiff` strips refs before compare** — it reports role/name/flag changes, not renumbered `[n]` churn. Unchanged lines are omitted; identical trees return `(no changes)`.
