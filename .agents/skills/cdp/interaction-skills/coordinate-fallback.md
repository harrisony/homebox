# Coordinate fallback (visual targeting)

When refs, axTree, and selectors can't target an element reliably, drop to **viewport-coordinate `Input.*`** and drive the page like a human reading pixels. This is the fallback, not the default — refs are more durable than coordinates whenever they work. Use coordinates for the one visual subtask that needs them, then go back to the DOM.

## When to drop to coordinates

- **Canvas-rendered apps** — Figma/Excalidraw, maps, chart libs, games, whiteboards, simulators. Shapes are pixels, not nodes; there's nothing to `querySelector`.
- **Custom visual controls** — drag handles, range sliders, crop boxes, timeline scrubbers, map pins, color pickers with no semantic role.
- **Stale, obscured, or absent refs** — the axTree/selector hits the wrong target, returns nothing, or the element is covered by an overlay the framework doesn't expose.
- **Cross-origin iframes you don't want to attach to** — compositor input passes through OOPIFs, so a coordinate click is lower-friction than `session.use(iframeTargetId)` (see `cross-origin-iframes.md`).
- **Visual verification** — the DOM can lie about state; a screenshot confirms what actually rendered.

## When not to

Don't reach for coordinates for ordinary text, buttons, links, inputs, menus, or forms that have a usable ref. A coordinate click is **more brittle** than a ref: any layout shift, scroll, or animation invalidates it. Prefer `Accessibility.queryAXTree` (see `accessibility-tree.md`) or `DOM.querySelector` first; fall back to coordinates only when those genuinely can't target the thing.

## The loop

Screenshot → read coordinates → act → screenshot → verify. Repeat for each visual step.

```js
const { data } = await session.Page.captureScreenshot({ format: 'png' })
// Cross-platform temp dir: /tmp on Linux, /var/folders/… on macOS, %TEMP% on Windows
const { tmpdir } = await import('node:os')
const { writeFile } = await import('node:fs/promises')
await writeFile(`${tmpdir()}/shot.png`, Buffer.from(data, 'base64'))
// Read (x, y) off the image (you are the vision model), then:
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
// Screenshot again to confirm the action took.
```

## Getting coordinates

Two sources, depending on what the page exposes:

**Read them off the screenshot** — the only option for canvas and pixel-only surfaces. You're a vision model; the PNG is your input.

**Compute from `getBoundingClientRect`** — when the element exists in the DOM but has no stable ref/selector (custom slider handle, deep shadow-DOM node you reached via `DOM.describeNode`). This is more precise than eyeballing:

```js
const { result } = await session.Runtime.evaluate({
  returnByValue: true,
  expression: `(() => {
    const el = document.querySelector('.fancy-slider-handle')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`,
})
const { x, y } = result.value
```

**CSS pixels, not device pixels.** `Input.*` takes CSS pixels; `captureScreenshot` returns device pixels on high-DPI displays. If you read coordinates off the image, divide by `devicePixelRatio` first (see `viewport.md`).

## Coordinate input primitives

All act on the current active target's viewport. They pass through iframes (see `iframes.md`).

```js
// Click
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })

// Double-click
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 2 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 2 })

// Hover / move (no button state change)
await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })

// Drag (pointer-based: canvas, sliders, custom handles)
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
for (let i = 1; i <= 10; i++) {
  await session.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: x1 + (x2 - x1) * (i / 10),
    y: y1 + (y2 - y1) * (i / 10),
    button: 'left',
  })
}
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
// For HTML5 DnD (dragstart/drop events), use dispatchDragEvent instead — see drag-and-drop.md.

// Type: click to focus, then insertText
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
await session.Input.insertText({ text: 'hello' })
// Control keys (Enter, Tab, modifiers) via Input.dispatchKeyEvent — type: 'keyDown' / 'keyUp'

// Scroll at a point
await session.Input.dispatchMouseEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: 300 })
// More scroll strategies in scrolling.md.
```

## Return to refs as soon as you can

Coordinates are for the visual subtask only — solving the CAPTCHA, placing the canvas object, opening the custom dropdown. The moment the page is back to ordinary DOM (a submit button, a normal input, a link), switch to axTree/selectors. Don't coordinate-click a button you could have targeted by role.

## Traps

- **CSS-pixel vs device-pixel scale on high-DPI.** `captureScreenshot` returns device pixels; `Input.*` takes CSS pixels. Coordinates read off the image must be divided by `devicePixelRatio`, or your clicks land offset and scaled — see `viewport.md`.
- **Layout shifts invalidate cached coordinates.** Re-screenshot after any navigation, scroll, modal open, accordion expand, or animation before the next coordinate action. A coord that worked one step ago is now wrong.
- **Sticky headers and pinned sidebars eat coordinate space.** Wheeling or clicking at a coordinate over a fixed header hits the header, not the content beneath. Pick coordinates over the actual target.
- **Don't coordinate-guess in a loop.** If the same coordinate fails 2–3 times, you're almost certainly clicking stale coords. Stop, re-screenshot, re-read. Repeating a blind guess never self-corrects.
- **`getBoundingClientRect()` inside an iframe is iframe-local.** Add the iframe's rect offset to get page coordinates before passing to `Input.*` — see `iframes.md`.
- **Animations and snap transitions.** Wait ~300ms after an action that animates (card snap, dropdown slide-in, drag-to-grid) before reading the next coordinates, or you'll target mid-flight positions.
- **`scroll-behavior: smooth` delays everything.** A wheel event returns instantly but the page keeps moving; your next coordinate click lands before scrolling settles. Wait or force `behavior: 'instant'` — see `scrolling.md`.
