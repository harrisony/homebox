# Reverse-engineer the site's API

When the normal UI path is blocked — a button is hidden behind a paywall, a flow needs clicks the page resists, or the data loads via an internal endpoint you can hit directly — capture the request the page itself makes, then replay it **in the page's own context** so it carries the site's cookies, origin, and referer and isn't flagged as a bot. This is the coding-agent move: instead of driving the UI, you read the page's network contract and call it yourself.

This works because `fetch()` run via `Runtime.evaluate` executes *inside the page* with the page's credentials and origin. A request sent from Node (or with synthetic cookies) has a different fingerprint and gets blocked; the same request sent from the page's own JS looks identical to the one the site issued. Don't replay from outside the browser.

## Capture the request

Enable `Network`, trigger the action (click the thing that makes the call, or let the page load), and grab the `requestWillBeSent` event for the endpoint you want:

```js
await session.Network.enable({})
const seen = []
const off = session.onEvent((method, p) => {
  if (method === 'Network.requestWillBeSent' && /\/api\/search/.test(p.request.url)) {
    seen.push({
      url: p.request.url, method: p.request.method,
      headers: p.request.headers,
      postData: p.request.postData,
      hasPostData: p.request.hasPostData,
      requestId: p.requestId,
    })
  }
})
// ...trigger the UI action that fires the request, or wait for the page to fire it...
await new Promise(r => setTimeout(r, 1500))
off()
return seen
```

For `POST` bodies, `requestWillBeSent` often omits `postData` and sets `hasPostData: true`. Fetch it:

```js
const { postData } = await session.Network.getRequestPostData({ requestId: seen[0].requestId })
```

Inspect the captured `{url, method, headers, postData}` to learn the contract: the path, query params, the auth header (`Authorization`, `X-Api-Key`), any CSRF token, and the body shape.

## Replay in-page

Build the `fetch()` call and run it through `Runtime.evaluate` so it runs as the page, inheriting cookies + origin + referer. Pass through the custom headers you captured (the page auto-adds cookies, `Content-Type`, and `Referer`; you must re-supply `Authorization`/CSRF explicitly):

```js
const cap = seen[0]                       // the captured request
const replay = `(async () => {
  const r = await fetch(${JSON.stringify(cap.url)}, {
    method: ${JSON.stringify(cap.method)},
    headers: ${JSON.stringify(Object.fromEntries(Object.entries(cap.headers).filter(([k]) =>
      /^(authorization|x-|csrf|content-type|accept)/i.test(k))))},
    ${cap.postData ? `body: ${JSON.stringify(cap.postData)},` : ''}
    credentials: 'include',
  })
  return { status: r.status, body: await r.text() }
})()`
const { result } = await session.Runtime.evaluate({
  expression: replay, awaitPromise: true, returnByValue: true,
})
return result.value   // { status, body }
```

## Vary it — paginate, filter, re-parameterize

Once you have the contract, you're free of the UI. Change the query string or body and replay to paginate, filter, or pull more data than the UI exposes:

```js
const pages = []
for (const page of [1, 2, 3]) {
  const url = cap.url.replace(/page=\d+/, 'page=' + page)   // or append ?page= if absent
  const { result } = await session.Runtime.evaluate({
    expression: `(async()=>{const r=await fetch(${JSON.stringify(url)},{credentials:'include'});return r.json()})()`,
    awaitPromise: true, returnByValue: true,
  })
  pages.push(result.value)
  await new Promise(r => setTimeout(r, 400))                // be polite — don't hammer the endpoint
}
return pages
```

## Intercept and rewrite instead (no UI trigger needed)

If you want to change a request the page is *about to* make without clicking anything, use `Fetch` to pause and rewrite it:

```js
await session.Fetch.enable({ patterns: [{ urlPattern: '/api/search', requestStage: 'Request' }] })
const off = session.onEvent(async (method, p) => {
  if (method !== 'Fetch.requestPaused') return
  const opts = { requestId: p.requestId }
  const url = new URL(p.request.url); url.searchParams.set('limit', '100')
  await session.Fetch.continueRequest({ ...opts, url: url.toString() })   // mutate in flight
})
// ...trigger or wait for the request...
off(); await session.Fetch.disable({})
```

`Fetch.continueRequest` lets you rewrite `url`, `method`, `headers`, `postData` before the request leaves the browser — the page sees its own (modified) request succeed.

## When to use this

- The UI path is gated, slow, or rate-limited and the endpoint is reachable with the page's own credentials.
- You need *more* than the UI exposes (pagination beyond what it renders, fields the UI omits).
- The page already makes the call — you're just asking it to make it again, differently.

## Traps

- **Replay from the page, not from Node.** A `fetch` from your REPL-in-page carries the site's cookies, origin, and referer. The same call from a script with copied cookies has the wrong TLS/origin fingerprint and gets blocked. Always go through `Runtime.evaluate`.
- **Auth/CSRF tokens expire.** A captured `Authorization` or CSRF token is one-shot or short-lived. Re-capture a fresh one (re-trigger the UI) before each replay session; don't hardcode it.
- **`credentials: 'include'` is required** for the in-page `fetch` to send cookies cross-request; without it the replay is unauthenticated.
- **POST bodies may not be in `requestWillBeSent`.** Use `Network.getRequestPostData` when `hasPostData` is true.
- **Respect the site.** This is for working *with* a site's own API when the UI is the obstacle — not for bypassing access controls, scraping against ToS, or evading rate limits. The endpoint returned the data to the page legitimately; replaying as the page is the same trust boundary.
- **`Network.enable` is verbose.** Capture only the URL you care about (filter in the `onEvent` predicate) to avoid buffering every subresource.
