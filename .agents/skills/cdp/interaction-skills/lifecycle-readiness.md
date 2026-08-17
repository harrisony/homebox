# Navigate and wait for load (lifecycle readiness)

The shortest reliable "navigate, then wait until the page is ready" pattern. This is the #1 thing every skill re-derives — get it right once here.

## The reliable pattern

```js
await session.Page.enable({})
await session.Page.setLifecycleEventsEnabled({ enabled: true })   // required — see trap 1
const ready = session.waitFor('Page.lifecycleEvent', (p) => p.name === 'networkIdle', 30_000)  // arm BEFORE navigate — see trap 2
await session.Page.navigate({ url: 'https://example.com' })
await ready
```

## `networkIdle` is the right signal (usually)

`Page.lifecycleEvent` fires for every stage (`init`, `firstPaint`, `firstMeaningfulPaint`, `DOMContentLoaded`, `load`, `networkIdle`, …). `networkIdle` is the last useful one: the network has gone quiet for ~500ms, which is after the SPA has fetched and rendered its data. `load` / `loadEventFired` fire earlier than that — for an SPA they fire before the data renders, so waiting on `load` returns a page that isn't ready.

## One tab per call (the skill pattern)

The repo skills open a fresh background tab per call so calls are safe to run in parallel. They route each call to that tab's `sessionId` explicitly with the `cdp(sessionId, method, params)` global — it sends one call to an explicit `sessionId` without mutating the active-session pointer, so concurrent calls on different tabs never race the pointer:

```js
const t = await session.Target.createTarget({ url: 'about:blank', background: true })
const { sessionId } = await session.Target.attachToTarget({ targetId: t.targetId, flatten: true })
try {
  await cdp(sessionId, 'Page.enable', {})
  await cdp(sessionId, 'Page.setLifecycleEventsEnabled', { enabled: true })
  const ready = session.waitFor({ method: 'Page.lifecycleEvent', sessionId, predicate: (p) => p.name === 'networkIdle', timeoutMs: 30_000 })
  await cdp(sessionId, 'Page.navigate', { url })
  await ready
  // …read the page…
} finally {
  session.closeTab(t.targetId, sessionId).catch(() => {})   // fire-and-forget — guaranteed cleanup, never blocks the return
}
```

`session.waitFor` takes the `{ method, sessionId, predicate, timeoutMs }` object form when you're driving an explicit `sessionId`; the 3-arg `(method, predicate, timeoutMs)` form targets the active session. `cdp(sid, method, params)` is the explicit-sessionId equivalent of `session.<Domain>.<method>(params)` — it does **not** call `session.use`, so the active-session pointer is untouched.

## `networkIdle` never fires for some pages — poll a content signal instead

SPAs that poll forever (Google Maps, live dashboards, anything with a continuous XHR/WebSocket) never open the 500ms quiet-window, so `networkIdle` never fires and the wait times out. Don't fight it — poll a content signal that only exists once the thing you want is there:

```js
await session.Page.navigate({ url })
const s0 = Date.now()
let ready = false
while (Date.now() - s0 < 15_000) {
  await new Promise(r => setTimeout(r, 200))
  const { result } = await session.Runtime.evaluate({
    expression: `document.querySelectorAll("a[href*='/maps/place/']").length`,
    returnByValue: true,
  })
  if (Number(result.value) > 0) { ready = true; break }
}
if (!ready) throw new Error('page did not produce results in time')
```

Pick the cheapest signal that asserts the actual outcome — a result-card count, a regex on the panel text, a meta tag, `location.href` changing to the resolved URL. It's more robust than any lifecycle event because it asserts the outcome, not a proxy for it. (For a `application/json` URL specifically, none of the load events fire at all — see [json-navigation.md](json-navigation.md).)

## Traps

- **`Page.setLifecycleEventsEnabled({ enabled: true })` is required.** Without it Chrome emits zero `Page.lifecycleEvent`, so `waitFor('…networkIdle')` hangs to the timeout. Call it once after `Page.enable`, before navigating.
- **Arm `session.waitFor(...)` BEFORE `Page.navigate`.** Lifecycle events fire once; a fast load can fire `networkIdle` in the gap between `Page.navigate` resolving and the listener subscribing. Creating the promise first (don't `await` it yet) and awaiting it after navigate closes the race.
- **`networkIdle` is not universal.** Pages with continuous polling never reach it (see above). `load`/`loadEventFired` fire too early for SPAs. When in doubt, poll a content signal.
- **Background tabs are throttled.** A background tab's timers and lifecycle can lag; for a quick scrape `background: true` is fine and keeps the user's tab focus. But anything that needs the page to actually play media or run animation-frame work needs a foreground tab (omit `background: true`, or `Target.activateTarget` after create) — see [media-capture.md](media-capture.md).
- **`loadEventFired` does not fire for `application/json`** navigations — the JSON viewer is not a normal page load. Use the [json-navigation](json-navigation.md) recipe instead of any lifecycle wait.
