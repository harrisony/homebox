# Navigate to a JSON URL and read it back

When the data you want is a plain JSON document at a URL (a REST endpoint, a `companyfacts.json`, a Yahoo chart), you can skip the site's UI entirely — navigate the tab straight to the JSON URL and read the body. Two traps make this different from a normal page load: **`application/json` navigations fire no `Page` lifecycle events** (`loadEventFired`/`networkIdle` never fire), and Chrome's built-in JSON viewer renders the body into the DOM on its own schedule, so waiting on the viewer is both slow and racy.

## Shortest version — poll the parsed body

Navigate, then poll `document.body.innerText` until it parses. This is the right call for **large** JSON (multi-MB) because Chrome's JSON viewer pre-parses it into `document.body.innerText` for you — you get the viewer's parse for free. Bail fast on a non-JSON content-type (an error page) instead of waiting out the timeout:

```js
await session.Page.enable({})
await session.Page.navigate({ url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json' })

const EXPR = `(function(){
  var t = document.body && document.body.innerText;
  if (!t) return JSON.stringify({ ready: false, ct: document.contentType, len: 0 });
  var j;
  try { j = JSON.parse(t); } catch (e) { return JSON.stringify({ ready: false, ct: document.contentType, len: t.length, head: t.slice(0, 140) }); }
  // project j here — the body is parsed exactly once, when ready
  return JSON.stringify({ ready: true, ct: document.contentType, /* …your fields… */ });
})()`

const s0 = Date.now()
while (Date.now() - s0 < 15_000) {
  await new Promise(r => setTimeout(r, 80))
  const r = await session.Runtime.evaluate({ expression: EXPR, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval failed: ' + r.exceptionDetails.exception.description)
  const v = JSON.parse(r.result.value)
  if (v.ready) { /* use v */ break }
  if (v.ct && v.ct !== 'application/json' && v.len > 0) throw new Error('non-JSON response (' + v.ct + '): ' + v.head)
  if (Date.now() - s0 > 15_000) throw new Error('timeout waiting for JSON')
}
```

The in-page expression does **both** the readiness check and the projection in one shot, so the (multi-MB) body is parsed exactly once — when it's ready. Polling on a separate "is it ready?" eval would parse it twice.

## Faster for small/medium JSON — `fetch(window.location.href)`

Chrome's JSON viewer is pure overhead for small payloads: it has to render the body into the DOM before you can read `innerText`. Skip the viewer — wait for the `Page.frameNavigated` commit (which **does** fire for `application/json`, unlike `loadEventFired`/`networkIdle`), then a same-origin `fetch(window.location.href)` returns the raw body without waiting for the viewer:

```js
await session.Page.enable({})
let committed = false
const off = session.onEvent((m, p, sid) => {
  if (m === 'Page.frameNavigated' && p && p.frame && p.frame.url !== 'about:blank') committed = true
})
await session.Page.navigate({ url })
const s0 = Date.now()
while (!committed && Date.now() - s0 < 10_000) await new Promise(r => setTimeout(r, 15))
off()
if (!committed) throw new Error('navigation did not commit')

const FETCH_EXPR = `(async function(){
  var r = await fetch(window.location.href);
  var t = await r.text();
  var j; try { j = JSON.parse(t); } catch (e) { return JSON.stringify({ error: 'non-JSON: ' + e.message }); }
  // project j here
  return JSON.stringify({ /* …your fields… */ });
})()`

const r = await session.Runtime.evaluate({ expression: FETCH_EXPR, awaitPromise: true, returnByValue: true })
if (r.exceptionDetails) throw new Error('fetch eval failed: ' + r.exceptionDetails.exception.description)
const v = JSON.parse(r.result.value)
```

`fetch(window.location.href)` runs **inside the page**, so it carries the page's cookies, origin, and referer — exactly the credentials a logged-in fetch needs (see [reverse-engineer-api.md](reverse-engineer-api.md) on why replay from the page, not from Node). `awaitPromise: true` lets the async IIFE resolve.

## CDP calls have no timeout — bound them yourself

`cdp(...)` / `session.<Domain>.<method>(...)` has no built-in timeout. A page-side `fetch` that hangs (a slow endpoint, a stalled viewer) will hang your snippet forever. Bound the eval with a node-side `Promise.race`:

```js
const evalP = session.Runtime.evaluate({ expression: FETCH_EXPR, awaitPromise: true, returnByValue: true })
const timeoutP = new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout (10s)')), 10_000))
const r = await Promise.race([evalP, timeoutP])
```

This is the general pattern for any CDP call whose page-side work might stall — `Runtime.evaluate` with `awaitPromise`, `Page.captureScreenshot` on a huge page, a `fetch` you don't trust.

## One tab per call

Wrap it in the one-tab-per-call shape so parallel calls don't collide (see [lifecycle-readiness.md](lifecycle-readiness.md)):

```js
const t = await session.Target.createTarget({ url: 'about:blank', background: true })
const { sessionId } = await session.Target.attachToTarget({ targetId: t.targetId, flatten: true })
try {
  await cdp(sessionId, 'Page.enable', {})
  await cdp(sessionId, 'Page.navigate', { url })
  // … poll or fetch as above, using cdp(sessionId, …) …
  return value
} finally {
  session.closeTab(t.targetId, sessionId).catch(() => {})
}
```

## Which recipe when

- **Large JSON (multi-MB)** — poll `document.body.innerText` (first recipe). The viewer's pre-parse is faster than re-parsing in your own `fetch`.
- **Small/medium JSON** — `fetch(window.location.href)` after `frameNavigated` (second recipe). Skips the viewer's render.
- **Need the raw bytes / non-JSON (CSV, XML, a binary)** — the `fetch` recipe works for any content type; drop the `JSON.parse` and return `t` (or `await r.arrayBuffer()`).

## Traps

- **No `Page` lifecycle events for `application/json`.** `loadEventFired`, `networkIdle`, the `Page.lifecycleEvent` stream — none of them fire for a JSON navigation. Don't `waitFor('Page.loadEventFired', …)`; it hangs to the timeout. Use `Page.frameNavigated` (the commit) or poll the body.
- **The JSON viewer renders on its own schedule.** Reading `document.body.innerText` before the viewer has parsed gives you `''` or a partial blob. Poll until `JSON.parse` succeeds (first recipe) or wait for `frameNavigated` + `fetch` (second recipe).
- **Bail on a non-JSON content-type.** A JSON URL can return an HTML error page (404, a login wall, a rate-limit page) with `Content-Type: text/html`. Check `document.contentType` in the poll and throw early instead of waiting out the timeout.
- **Replay from the page, not from Node.** A `fetch` run via `Runtime.evaluate` carries the page's cookies/origin/referer. The same `fetch` from the REPL (Node-side) has the wrong fingerprint and no cookies — it gets blocked or returns unauthenticated data.
- **Anti-bot sites block the in-page `fetch` too.** The small/medium-JSON recipe's `fetch(window.location.href)` can still throw `Failed to fetch` on hostile endpoints (Reddit's `.json`, ad-walled APIs) — the site fingerprints or refuses the programmatic request even with the page's cookies. Fall back to the **poll-`innerText` recipe** (the first one): Chrome's JSON viewer renders the body into `document.body.innerText` using the page's own credentials, no `fetch` needed, so it reads the same data the tab is already showing. Polling until `JSON.parse` succeeds also dodges the viewer's racy render timing — don't read `innerText` once at a fixed settle, you get `''` or a partial/truncated blob before the viewer finishes.
- **CDP calls don't time out.** Bound a `fetch`/`awaitPromise` eval with `Promise.race` (above) so a stalled endpoint fails fast instead of hanging.
- **Big bodies can close the WebSocket.** Returning a multi-MB value from `Runtime.evaluate` with `returnByValue: true` is itself a large CDP response — see [connection.md](connection.md) (WebSocket payload limits). For a large JSON doc, project it down **in the page** and return only the small projection, or write it to a file server-side.
