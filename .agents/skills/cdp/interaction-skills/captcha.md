# CAPTCHAs

CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile, distorted-text images) live inside **cross-origin iframes** and intentionally offer no stable DOM hooks. Treat them as visual targets: screenshot to find them, then drive them with viewport-coordinate `Input.*`. Compositor-level input passes through OOPIFs transparently — you never need to attach to the widget frame (see `cross-origin-iframes.md`).

Three families, each a different shape: **checkbox**, **slider/puzzle drag**, **text/image**. reCAPTCHA v2 starts as a checkbox and can escalate to an image-grid challenge after the click.

## Locate the widget

The widget is an `<iframe>` in the parent page. Read its page-coordinate rect from the parent (not from inside the frame):

```js
const { result } = await session.Runtime.evaluate({
  returnByValue: true,
  expression: `(() => {
    const f = [...document.querySelectorAll('iframe')].find(i =>
      /recaptcha|hcaptcha|challenges\\.cloudflare\\.com/.test(i.src))
    if (!f) return null
    const r = f.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, src: f.src }
  })()`,
})
const widget = result.value   // { x, y, width, height, src }
```

These are **page coordinates** — exactly what `Input.dispatchMouseEvent` wants.

## Checkbox (reCAPTCHA v2, hCaptcha, Turnstile)

Screenshot first — Turnstile often verifies with no click when the browser score is good, and you don't want to click a checkbox that's already ticked.

```js
// reCAPTCHA's checkbox sits ~28px from the iframe's left edge, vertically centered.
// For hCaptcha/Turnstile, click the center of the visible checkbox/button instead.
const cx = widget.x + 28
const cy = widget.y + widget.height / 2

await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
await new Promise(r => setTimeout(r, 2500))
```

Verify by screenshot — look for the checkmark / "Verified" / a fading spinner. If the widget instead expands into a 3×3 image grid, drop to the image-grid recipe below.

## Slider / puzzle drag (slide-to-fit, jigsaw)

This is a **pointer-based drag** (the track listens to `mousedown`/`mousemove`/`mouseup`), not HTML5 DnD — so a plain mouse-event sequence is correct (see `drag-and-drop.md`, Kind 2). Smoothness matters: too fast or too linear gets flagged.

```js
// Read the gap offset off a screenshot — how far the puzzle piece must travel.
const handle = { x: widget.x + 25, y: widget.y + widget.height / 2 }   // handle starts at the left
const offset = 220                                                     // pixels to slide, from the screenshot
const target = { x: handle.x + offset, y: handle.y }

await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 })
const steps = 30
for (let i = 1; i <= steps; i++) {
  const t = i / steps
  await session.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: handle.x + (target.x - handle.x) * t,
    y: handle.y,
    button: 'left',
  })
  await new Promise(r => setTimeout(r, 12))   // ~360ms total — human-ish cadence
}
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
```

Add slight per-step jitter on `y` and vary the delay if a site rejects uniform motion.

## Text / number CAPTCHA (distorted text)

Clip-screenshot the image region and read it with vision, then fill the input.

```js
const { data } = await session.Page.captureScreenshot({
  format: 'png',
  clip: { x: widget.x, y: widget.y, width: widget.width, height: widget.height, scale: 1 },
})
// Cross-platform temp dir: /tmp on Linux, /var/folders/… on macOS, %TEMP% on Windows
const { tmpdir } = await import('node:os')
const { writeFile } = await import('node:fs/promises')
await writeFile(`${tmpdir()}/captcha.png`, Buffer.from(data, 'base64'))
// Read the text from the image (you are the vision model), then fill the input:
```

The input is usually in the parent page, so `Input.insertText` works after clicking focus. If the input is itself inside an OOPIF, click into it by coordinate first — `insertText` routes to the focused element regardless of frame:

```js
await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: inputX, y: inputY, button: 'left', clickCount: 1 })
await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: inputX, y: inputY, button: 'left', clickCount: 1 })
await session.Input.insertText({ text: solvedText })
```

## Image-grid challenge (reCAPTCHA "select all…")

After a checkbox click, reCAPTCHA can pop a challenge in a **new** OOPIF. Re-query bounds — the checkbox-stage rect is stale.

```js
// Re-run the locate snippet; the challenge iframe's src usually contains /recaptcha/api2/bframe.
// The grid is NxN inside it — screenshot it, identify which cells to click, then:
const cols = 3, rows = 3
const cellW = gridWidth / cols, cellH = gridHeight / rows
const cellsToClick = [/* booleans, left-to-right, top-to-bottom, from vision */]

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (!cellsToClick[r * cols + c]) continue
    const cx = gridX + c * cellW + cellW / 2
    const cy = gridY + r * cellH + cellH / 2
    await session.Input.dispatchMouseEvent({ type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
    await session.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 200))
  }
}
// Then click "Verify" / "Next" — read its coordinate off the same screenshot.
```

Some challenges paginate ("Next" reveals a fresh grid). Loop: screenshot → classify → click → screenshot, until the challenge iframe closes and the widget shows verified.

## Traps

- **Don't `contentDocument` the widget.** It's cross-origin; access throws. Coordinate input is the path — see `cross-origin-iframes.md`.
- **The checkbox is on the left, not the center.** reCAPTCHA renders the checkbox ~28px in; clicking the center hits the label and does nothing. hCaptcha/Turnstile are more centered — screenshot to confirm.
- **A checkbox click can silently escalate to an image challenge.** Always re-screenshot after the 2.5s wait before declaring success; a "verified" checkmark and a freshly-opened grid look different.
- **Challenge iframes are lazy-mounted.** The grid iframe doesn't exist until after the checkbox click. Re-query `document.querySelectorAll('iframe')` when it appears; cached bounds from the checkbox stage point at the wrong frame.
- **Slider drags need human-like motion.** A single jump or a perfectly uniform 30-step slide is detectable. Add `y` jitter and slightly vary the per-step delay.
- **`Input.insertText` needs focus first.** It types into whatever is focused. Click the input by coordinate before calling it — especially inside an OOPIF, where `Runtime.evaluate` writes may be sandboxed but compositor input + `insertText` still work.
- **Re-screenshot after every state change.** Spinners, fade-ins, and tile-selection animations move the next target. Don't reuse coordinates across a visual transition.
