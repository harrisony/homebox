# Connection & Tab Visibility

## Just call `session.connect()`

No args required. It scans OS-specific browser-data dirs for every running Chromium-based browser (Chrome, Chromium, Edge, Brave, Arc, Vivaldi, Opera, Comet, Canary, Dia, Aside — and any other Chromium fork via a bounded fallback scan), reads each one's actual debug port from its `DevToolsActivePort` file, and picks the most-recently-launched one whose WebSocket accepts. No hardcoded port: Chrome often listens on 9222, but Aside and others use ephemeral ports (e.g. 52860), so auto-detect reads the real port instead of assuming. The host is always loopback (`127.0.0.1`) for a local browser. Dead ports and permission-denied (403) candidates fall through in <100ms each, so the loop is fast.

```js
await session.connect()
```

Inspect what's available (e.g. to let the user choose) with `detectBrowsers()`:

```js
const browsers = await detectBrowsers()
// [{ name: 'Google Chrome', profileDir, port, wsPath, wsUrl, mtimeMs }, ...]
```

### Explicit forms (override auto-detect)

Use only when auto-detect picks the wrong browser or you already know the destination.

| Form | When |
|---|---|
| `{ profileDir }` | Target a specific running browser. Reads its `DevToolsActivePort` directly. OS-agnostic. |
| `{ wsUrl }` | You already have `ws://…/devtools/browser/<uuid>`. |

```js
await session.connect({ profileDir: '/Users/<you>/Library/Application Support/Google/Chrome' })
await session.connect({ wsUrl: 'ws://127.0.0.1:9222/devtools/browser/<uuid>' })
```

### Timeouts and the Allow popup

Per-candidate WS-open timeout defaults to **5s**. A live browser either opens or closes the connection within ~100ms, so 5s is always enough — unless the user has to click **Allow** on Chrome's remote-debugging popup. In that case, pass `timeoutMs: 30000` to give them time:

```js
await session.connect({ profileDir, timeoutMs: 30_000 })
```

**Dia's Allow prompt is auto-dismissed (macOS, on by default).** Dia shows an `Allow debugging connection?` prompt (Return = Allow) — the only Chromium browser that does. The SDK auto-dismisses it via `osascript` when the WS-open stalls; no-op for every other browser. Opt out with `autoAllow: false` or `--no-auto-allow`. If `connect()` stalls past `timeoutMs`, the user likely needs to grant macOS Accessibility to `node` (see the README).

If `session.connect()` reports `No detected browser accepted a connection`, it means every browser with `DevToolsActivePort` answered 403 or closed without opening — most likely the user hasn't clicked Allow yet. Ask them to, then retry.

## The omnibox popup problem

When Chrome opens fresh, the only CDP `type: "page"` targets may be `chrome://inspect` and `chrome://omnibox-popup.top-chrome/` (a 1px invisible viewport). If you attach to the omnibox popup, every subsequent action happens on a tab the user cannot see.

`listPageTargets()` already filters `chrome://` and `devtools://` URLs. If you call `Target.getTargets` directly, filter these manually:

```js
const { targetInfos } = await session.Target.getTargets({})
const realTabs = targetInfos.filter(t =>
  t.type === 'page' &&
  !t.url.startsWith('chrome://') &&
  !t.url.startsWith('devtools://')
)
```

If no real pages exist yet, create one instead of attaching to nothing:

```js
const tabs = await listPageTargets()
let targetId = tabs[0]?.targetId
if (!targetId) {
  ({ targetId } = await session.Target.createTarget({ url: 'about:blank' }))
}
await session.use(targetId)
```

## Startup sequence

1. `await session.connect()` — auto-detect the running browser.
2. `const tabs = await listPageTargets()` — see what real pages exist.
3. `await session.use(tabs[0].targetId)` — route Page/DOM/Runtime/Network calls to that target.
4. `await session.Target.activateTarget({ targetId: tabs[0].targetId })` — bring the tab visually to front.
5. Enable the domains you need: `await session.Page.enable()`, `await session.Network.enable({})`, etc.

## CDP target order ≠ visible tab-strip order

When the user says "the first tab I can see", do NOT trust the order of `Target.getTargets`. Use:

- A screenshot (`session.Page.captureScreenshot()`) to identify visually.
- Page title / URL heuristics.
- Or platform UI automation (macOS: AppleScript; Linux: `xdotool`/`wmctrl`).

`Target.activateTarget` only switches to a targetId you already know — it cannot resolve "leftmost tab".

## Bringing the browser to front

The `<browser-app>`/`<browser-binary>` is the one `session.connect()` attached to — don't hardcode it. On macOS the app name occasionally differs from the binary (Brave is `Brave Browser`); detect the running Chromium app name first if unsure:

```bash
# macOS — print the running Chromium app name (frontmost, else first running)
osascript \
  -e 'set apps to {"Dia","Google Chrome","Chromium","Microsoft Edge","Brave Browser","Arc","Vivaldi","Opera","Comet","Aside","Google Chrome Canary"}' \
  -e 'tell application "System Events"' \
  -e 'set frontApp to name of first application process whose frontmost is true' \
  -e 'if frontApp is in apps then return frontApp' \
  -e 'repeat with a in apps' \
  -e 'if exists process a then return a' \
  -e 'end repeat' \
  -e 'end tell'

# macOS — prefer AppleScript over `open -a` (reuses current profile, avoids the profile picker)
osascript -e 'tell application "<browser-app>" to activate'

# Linux (X11) — use wmctrl or xdotool
wmctrl -a '<browser-binary>'
xdotool search --name '<browser-binary>' windowactivate

# Windows (PowerShell)
powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate('<browser-binary>')"
```

## WebSocket payload limits — any large CDP response can close the socket

The CDP WebSocket has a per-message size limit. A single response large enough to exceed it closes the socket — the call rejects with `CDP socket closed`. This is a property of the *connection*, not any one domain: any big-enough response can trigger it. Common culprits:

- `Accessibility.getFullAXTree` on a giant page (huge tables, infinite lists, heavy SPAs) — the most common trigger; compress the result with `axView` or scope it.
- `Runtime.evaluate` with `returnByValue: true` returning a huge object/string (`document.body.innerHTML`, a big JSON blob).
- `Network.getResponseBody` on a large resource.
- `DOM.getDocument` with a deep `depth` on a big DOM.

Two rules to stay under the limit:

1. **Don't pipe big blobs back through `/eval`.** The large CDP response has to cross the WS to reach the REPL before your snippet can even return it. Write large data to a file *server-side* (`await (await import('node:fs/promises')).writeFile(path, data)`) and return only a small summary — the blob never re-enters the WS and never enters the model's context either.
2. **Scope or limit the response at the source.** Ask CDP for less:
   - `Accessibility.getPartialAXTree({ backendNodeId })` for a subtree, or `queryAXTree` the region, instead of the whole-page `getFullAXTree`.
   - `Runtime.evaluate` returning a *clipped* value (`s.slice(0, 4000)`, a count, a hash) instead of the full object.
   - `DOM.getDocument({ depth: 1 })` and drill with `querySelector`/`requestNode` instead of a deep dump.
   - `Network.getResponseBody` only when you need the body; otherwise read headers/length.

If a call does close the socket (`CDP socket closed`), the **next call auto-heals** — `_call` detects the dead socket, reconnects once, and retries, so the daemon no longer needs a manual `await session.connect()`. What does *not* survive a drop is the **flat session**: the browser tears down `Target.attachToTarget` sessions when the WS closes, so the next call on the old `sessionId` rejects with `CDP -32001: Session with given id not found` — a clean signal to **re-`attachToTarget`** (the target itself persists). `globalThis.*` you set survive (they live in the daemon, not the socket). So after a drop: re-attach to your target, re-`use()` it, and continue. If you'd rather force a fresh connection, `await session.connect()` still works.

## Stale daemon — the running REPL lags the installed files

`browser-harness-js` is a **long-lived process**: it loads the SDK code once at boot and keeps it in memory. `npx skills add` (or any reinstall) overwrites the files on disk but does **not** touch the running daemon — nothing hot-reloads. After an update the *files* are current while the *running daemon* still holds the old code, until you restart it.

Two tells that the daemon is stale:

1. **`ReferenceError: <global> is not defined`** for a global the docs describe (e.g. `axView`, `axDiff`, `axClick`) — or `typeof axView` returning `"undefined"`. The docs you read are new; the daemon is old.

2. **Version mismatch.** The launcher reads the on-disk version fresh; the daemon serves its boot-cached version in `/health`:

   ```bash
   browser-harness-js --version      # on-disk files, e.g. 0.2.0
   browser-harness-js --status       # running daemon's boot version
   # {"ok":true,"version":"0.2.0","uptime":...,"connected":true,"sessionId":"..."}
   ```

   If `/health` has **no** `version` field (daemon predates versioning) or a **lower** one than `--version`, the daemon is stale.

Fix it — restart reloads the current on-disk code:

```bash
browser-harness-js --restart
```

`--restart` quits the old daemon and re-execs it from the installed files, then prints the new `/health` (with the up-to-date `version`). It **drops session state** — `await session.connect()` and re-`use()` your target afterward, exactly as after a `CDP socket closed`.
