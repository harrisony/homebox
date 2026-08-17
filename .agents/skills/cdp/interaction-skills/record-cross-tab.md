# Record User Actions (Cross-Tab)

Capture real clicks / keystrokes / changes the user makes, across every tab — including tabs they open later. CDP's `Input.*` domain is **send-only** (it injects input, it does not observe it), so the mechanic is: inject a tiny JS listener into each page that phones home through a `Runtime` binding, then funnel every binding call into one event stream tagged by `sessionId`.

## Shortest version: record clicks from tabs you already know

```js
await session.connect()

globalThis.rec = []
const off = session.onEvent((method, params, sessionId) => {
  if (method === 'Runtime.bindingCalled' && params.name === '__rec')
    globalThis.rec.push({ session: sessionId, ...JSON.parse(params.payload) })
})

const listener = `
(function(){
  if (window.__rec_on) return;
  window.__rec_on = 1;
  document.addEventListener('click', e => {
    window.__rec(JSON.stringify({
      ts: Date.now(),
      path: location.pathname,
      x: e.clientX, y: e.clientY,
      tag: e.target.tagName,
      id:  e.target.id || '',
      txt: (e.target.innerText || '').slice(0, 40),
    }));
  }, { capture: true, passive: true });
})()`

for (const t of await listPageTargets()) {
  await session.use(t.targetId)
  await session.Runtime.enable({})
  await session.Runtime.addBinding({ name: '__rec' })
  await session.Page.addScriptToEvaluateOnNewDocument({ source: listener })
  await session.Runtime.evaluate({ expression: listener })   // current document
}

// (user browses the instrumented tabs...)
// browser-harness-js 'return globalThis.rec'
```

`Runtime.addBinding` exposes `window.__rec(str)` for the lifetime of the target; `addScriptToEvaluateOnNewDocument` re-injects on every navigation within the tab. The one-time `Runtime.evaluate` covers the *already-loaded* document. Both must run **after** `addBinding` so the binding exists before any listener fires.

## All tabs, including ones opened later (auto-attach)

Browser-level `Target.setAutoAttach` attaches every existing page target **and** every new tab the user opens, firing `Target.attachedToTarget` for each. Instrument each from that single event:

```js
await session.connect()

const LISTENER = `
(function(){
  if (window.__rec_on) return;
  window.__rec_on = 1;

  function sel(el){
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(s + '#' + cur.id); break; }
      if (cur.className && typeof cur.className === 'string')
        s += '.' + cur.className.trim().split(/\\s+/).slice(0, 2).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children, c => c.tagName === cur.tagName);
        if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(s);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function describe(t){
    const field = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
    const secret = t.type === 'password';
    return {
      tag: t.tagName,
      id: t.id || undefined,
      role: t.getAttribute('role') || undefined,
      label: t.getAttribute('aria-label') || t.getAttribute('title') || undefined,
      text: (t.innerText || '').slice(0, 60),
      selector: sel(t),
      value: secret ? '***' : (field ? String(t.value ?? '').slice(0, 200) : ''),
    };
  }

  function emit(type, t, extra){
    try { window.__rec(JSON.stringify({ ts: Date.now(), type, target: describe(t), extra })); }
    catch (e) {}
  }

  ['click', 'change', 'submit'].forEach(function(t){
    document.addEventListener(t, function(e){ emit(t, e.target, {}); }, { capture: true, passive: true });
  });
  document.addEventListener('keydown', function(e){
    emit('keydown', e.target, (e.target.type === 'password') ? {} : { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
  }, { capture: true });
})()`

globalThis.rec = []
globalThis.tabUrl = {}        // sessionId -> page url
globalThis.sid2target = {}    // sessionId -> targetId
globalThis.target2sid = {}    // targetId  -> sessionId

const off = session.onEvent((method, params, sessionId) => {
  if (method === 'Runtime.bindingCalled' && params.name === '__rec') {
    globalThis.rec.push({ tab: globalThis.tabUrl[sessionId], ...JSON.parse(params.payload) })
    return
  }
  if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'page') {
    const sid = params.sessionId, tid = params.targetInfo.targetId
    globalThis.sid2target[sid] = tid
    globalThis.target2sid[tid] = sid
    globalThis.tabUrl[sid] = params.targetInfo.url
    enqueue(() => instrument(sid, params.targetInfo))
    return
  }
  if (method === 'Target.targetInfoChanged') {
    const sid = globalThis.target2sid[params.targetInfo.targetId]
    if (sid) globalThis.tabUrl[sid] = params.targetInfo.url
    return
  }
  if (method === 'Target.detachedFromTarget') {
    const sid = params.sessionId, tid = globalThis.sid2target[sid]
    delete globalThis.tabUrl[sid]; delete globalThis.sid2target[sid]; delete (globalThis.target2sid || {})[tid]
    return
  }
})

async function instrument(sessionId, info) {
  globalThis.tabUrl[sessionId] = info.url
  const prev = session.getActiveSession()
  session.setActiveSession(sessionId)
  try {
    await session.Runtime.enable({})
    await session.Runtime.addBinding({ name: '__rec' })
    await session.Page.addScriptToEvaluateOnNewDocument({ source: LISTENER })
    try { await session.Runtime.evaluate({ expression: LISTENER }) } catch {}
  } finally {
    session.setActiveSession(prev)
  }
}

globalThis.__instrQ = Promise.resolve()
function enqueue(fn) {
  globalThis.__instrQ = globalThis.__instrQ.then(fn, fn)
  return globalThis.__instrQ
}

await session.Target.setDiscoverTargets({ discover: true })
await session.Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
```

The `onEvent` subscriber and the `instrument`/`enqueue` closures are held by the server and keep firing across future `browser-harness-js` calls until `off()` / `--restart`. So: run this setup once, let the user browse, then read back the log from a separate call.

## Reading the log

```js
// everything, newest last
return globalThis.rec

// just the clicks, one line each
return globalThis.rec
  .filter(r => r.type === 'click')
  .map(r => (r.tab || '?').slice(0, 40) + '  ' + r.target.selector + '  ' + r.target.text)
```

Stop recording with `off()` (run inside the same setup call) or `browser-harness-js --restart` to drop all subscribers.

## Traps

- **`Input.*` is send-only.** CDP emits no "user clicked at (x,y)" or "user pressed K" event — that's *why* this recipe injects listeners + a binding instead of subscribing to an event stream you might assume exists.
- **`addBinding` and `addScriptToEvaluateOnNewDocument` are per-target.** Call both once per attached page session. They **survive reloads** within a target, so a tab that navigates keeps recording; a tab that closes is cleaned up via `Target.detachedFromTarget`.
- **`setAutoAttach` mutates the active session pointer.** While `instrument()` runs it calls `setActiveSession(sid)` then restores `prev` in `finally`. Concurrent `Target.attachedToTarget` bursts (every existing tab fires at once) run through the `enqueue` serializer so they don't interleave. If you also drive the browser by hand with `session.use(...)` between calls, prefer the **short** version, or bypass the pointer entirely by calling `session._call('Runtime.addBinding', { name: '__rec' }, { sessionId: sid })` directly.
- **`waitForDebuggerOnStart` must be `false`** for a passive recorder. `true` pauses every new tab until you call `Runtime.runIfWaitingForDebugger` — you'd freeze the user's browsing. With `false` you may miss page-load-time events (irrelevant for click/keystroke recording).
- **Keystrokes are captured verbatim.** The listener masks `type=password` both in `value` and by dropping `key` for password fields — but text typed into a normal field is still recorded as `keydown` `key`s and as the final `value` on `change`. Remove the `keydown` listener if you only need clicks.
- **Cross-origin iframes (OOPIFs) are separate targets not covered here.** Browser-level `setAutoAttach` attaches top-level pages; it does **not** recurse into a page's OOPIFs. To record inside them, call `Target.setAutoAttach` again from within each page's session (filter `targetInfo.type === 'page'` → relax to include `'iframe'`), or attach them explicitly via `listPageTargets`-style filtering for `type === 'iframe'` (see [cross-origin-iframes.md](cross-origin-iframes.md)).
- **`bindingCalled.payload` is a string.** The binding throws on non-string input, so always `JSON.stringify` before `window.__rec(...)` — the listener does this for you.
