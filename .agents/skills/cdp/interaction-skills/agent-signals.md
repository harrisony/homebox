# Agent signals — curating async page events

CDP fires dozens of events per action. Most are noise (`Network.requestWillBeSent` for every subresource, `Page.lifecycleEvent` for every stage). The few that change what the agent should do next — a dialog appeared, a download started, a popup opened, a tab closed, a navigation happened — get buried. "Agent signals" is a tiny running digest: subscribe to the events that matter, push one-line human-readable messages onto a list, and drain it before each step so the model gets a compact steering channel instead of raw event spam.

This is a **pattern over `session.onEvent`**, not a helper. Set it up per task, tear it down when done.

## The events worth surfacing

| Event | Signal | Why it matters |
|---|---|---|
| `Page.javascriptDialogOpening` | `dialog <type>: "message"` | An alert/confirm/prompt is blocking the page. Dismiss it (`Page.handleJavaScriptDialog`) before anything else works. |
| `Page.fileChooserOpened` | `file chooser (mode)` | A file input opened — needs files via `DOM.setFileInputFiles`. |
| `Page.downloadWillBegin` / `Page.downloadProgress` | `download: filename (N%)` | A download started — wait for `completed` before reading the file. |
| `Page.windowOpen` | `window.open -> url` | The page tried to open a new window (popup, OAuth). |
| `Target.targetCreated` | `new target: type url` | A tab/popup was opened (often by a click). |
| `Target.targetDestroyed` | `target closed: url` | A tab closed (yours, or one you opened). |
| `Target.targetCrashed` | `target CRASHED: url` | A tab process died — your next call to it will fail. |
| `Page.frameNavigated` | `navigated -> url` | The page navigated — refs/coordinates from before are stale. |
| `Network.loadingFailed` | `request FAILED type: url` | A request the agent cares about was blocked/failed. |

`Page.*` events need `session.Page.enable()`. `Target.*` are browser-level and always delivered. For `Page.downloadProgress`, first call `session.Page.setDownloadBehavior({ behavior: 'allow', downloadPath, eventsEnabled: true })`.

## Set up the digest once

```js
globalThis.signals = []
const active = () => session.getActiveSession()
globalThis._sigOff = session.onEvent((method, p, sid) => {
  if (sid && sid !== active() && method.startsWith('Page.')) return // ignore other tabs' page events
  const m = ({
    'Page.javascriptDialogOpening': () => `dialog ${p.type}: "${p.message}"`,
    'Page.fileChooserOpened':       () => `file chooser (${p.mode})`,
    'Page.downloadWillBegin':        () => { globalThis._dlName = p.suggestedFilename ?? p.url; return `download start: ${globalThis._dlName}` },
    'Page.downloadProgress':        () => p.state === 'inProgress' ? null : `download ${p.state}: ${globalThis._dlName ?? ''}`,
    'Page.windowOpen':              () => `window.open -> ${p.url}`,
    'Page.frameNavigated':          () => `navigated -> ${p.frame?.url}`,
    'Target.targetCreated':         () => `new ${p.targetInfo?.type}: ${p.targetInfo?.url}`,
    'Target.targetDestroyed':       () => `target closed: ${p.targetInfo?.url}`,
    'Target.targetCrashed':         () => `target CRASHED: ${p.targetInfo?.url}`,
    'Network.loadingFailed':        () => `request FAILED (${p.type}): ${p.url} [${p.errorText}]`,
  })[method]?.()
  if (m) globalThis.signals.push(m)
})
```

## Drain before each step

After any action that might trigger async state (a click, a form submit, a navigation), read and clear the digest:

```js
await session.Page.enable()                       // if not already on for this tab
// ... your action: dispatchMouseEvent, etc. ...
await new Promise(r => setTimeout(r, 300))        // let queued events land
const got = globalThis.signals.splice(0)         // drain
if (got.length) console.log(got.join('\n'))      // inspect; act on dialogs/crashes first
```

A typical result:
```
navigated -> https://example.com/dashboard
dialog confirm: "Leave without saving?"
```

React in priority order: **dialog > crash > download complete > navigation > the rest**. A pending `javascriptDialogOpening` blocks every subsequent call until you `Page.handleJavaScriptDialog({ accept: true/false })`.

## Tear down

```js
globalThis._sigOff?.()
delete globalThis.signals; delete globalThis._sigOff
```

## Signals vs `session.waitFor`

- **`session.waitFor(method, predicate, timeout)`** — when you expect *one* specific event and want to block until it arrives (e.g. wait for `networkIdle` after `Page.navigate`). Use this for synchronization. See [`connection.md`](connection.md).
- **Agent signals** — when you want a *running* view of what's happening across a multi-step task, including events you didn't anticipate (a popup you didn't expect, a crash). Use this for awareness; pair with `waitFor` for the event you're deliberately waiting on.

## Traps

- **`Page.*` events are per-target.** They carry a `sessionId`; filter to `session.getActiveSession()` or you'll see signals from background tabs you opened. `Target.*` events are browser-wide and have `sessionId === undefined`.
- **`onEvent` persists on the server.** If you don't call the returned unsubscribe fn, the subscriber keeps running (and keeps pushing to `globalThis.signals`) for the life of the process. Always tear down when the task ends.
- **Events fire async, after your heredoc returns.** A `dispatchMouseEvent` heredoc returns before the dialog it triggers arrives. Drain in the *next* call, or add a short settle `await new Promise(r => setTimeout(r, 300))` before draining within the same call.
- **`downloadWillBegin` fires before the file is written.** Wait for `downloadProgress` `state: 'completed'` before reading from `downloadPath`. The `downloadPath` is whatever you passed to `setDownloadBehavior`.
- **`frameNavigated` invalidates everything.** A navigation signal means all `[n]` refs, selectors, and coordinates from before are stale — re-query or re-snapshot.
