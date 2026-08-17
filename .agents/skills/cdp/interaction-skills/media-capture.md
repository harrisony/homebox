# Record what the page feeds an API (MediaSource / media capture)

Record the actual bytes a media player feeds `MediaSource` (or, by the same trick, any bytes a page feeds a native API — an `XHR.send`, a `fetch` body, a `WebSocket.send`). The player does the hard parts (auth, signing, token solving, CDN selection, demux); you record what it hands the browser. The page is the downloader; you just persist what it produces. No client impersonation, no signature solver.

The mechanic: **inject a hook on a native prototype before the page loads**, capture the bytes into page memory as the page runs, then pull them to disk in small chunks. It generalizes to any "I want the bytes the page sends to `<native API>`" task — swap `MediaSource.prototype.addSourceBuffer` for whatever the page calls.

## The mechanic — hook `appendBuffer` before navigate

`Page.addScriptToEvaluateOnNewDocument` injects a script before the next navigation in the tab. Hook `MediaSource.prototype.addSourceBuffer` and redefine an **own** `appendBuffer` on each `SourceBuffer` instance (the prototype's `appendBuffer` is a non-writable native, so you shadow it with an own property):

```js
await session.Page.addScriptToEvaluateOnNewDocument({ source: `
(() => {
  if (window.__cap) return;
  window.__cap = { buffers: [] };
  window.__capDone = false;
  const origAdd = MediaSource.prototype.addSourceBuffer;
  Object.defineProperty(MediaSource.prototype, 'addSourceBuffer', {
    configurable: true, writable: true,
    value(mime) {
      const sb = origAdd.call(this, mime);
      const entry = { mime, kind: mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'other',
                      chunks: [], bytes: 0, count: 0 };
      window.__cap.buffers.push(entry);
      const origApp = sb.appendBuffer.bind(sb);
      Object.defineProperty(sb, 'appendBuffer', {
        configurable: true, writable: true,
        value(data) {
          if (window.__capDone) return origApp(data);          // frozen: pass through, stop recording
          const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          entry.chunks.push(u8.slice()); entry.bytes += u8.length; entry.count++;
          return origApp(data);
        },
      });
      return sb;
    },
  });
})();
` })
```

Inject this **before** `Page.navigate`. If you inject after, the player has already created its `SourceBuffer` and you miss the init segment.

## Foreground tab — media needs the page to actually play

`{ background: true }` throttles timers and breaks autoplay on some players, and a `MediaSource` the page never feeds captures nothing. Use a foreground tab (omit `background: true`, or `Target.activateTarget` after create). Then nudge the player to play muted so it fetches+appends every segment:

```js
const t = await session.Target.createTarget({ url: 'about:blank' })   // foreground — autoplay needs it
const { sessionId } = await session.Target.attachToTarget({ targetId: t.targetId, flatten: true })
await cdp(sessionId, 'Page.addScriptToEvaluateOnNewDocument', { source: HOOK })
await cdp(sessionId, 'Page.navigate', { url: WATCH_URL })
// …wait for the <video> element, then:
await cdp(sessionId, 'Runtime.evaluate', {
  expression: `(() => { const v = document.querySelector('video'); v.muted = true; v.playbackRate = 16; v.play().catch(()=>{}); return 'playing'; })()`,
  returnByValue: true,
})
```

## Coverage latch — wait until the whole timeline is buffered

The player buffers ahead of `currentTime`. Latch the first time `buffered.end >= duration - 0.5` and never re-check — so the player advancing to the next video (or looping) after you've latched doesn't matter. Re-assert `muted`/`playbackRate` each tick: the player clobbers them on a quality switch, ad, or re-init, which would un-mute the sped-up audio mid-capture.

```js
const dur = /* read from video.duration after metadata loads */
let done = false
const deadline = Date.now() + Math.max(60_000, dur * 1000 / 12 + 60_000)
for (;;) {
  if (Date.now() > deadline) break
  const r = await cdp(sessionId, 'Runtime.evaluate', {
    expression: `(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.playbackRate = 16; }
      return JSON.stringify({ end: v && v.buffered.length ? v.buffered.end(v.buffered.length-1) : 0, ended: v ? v.ended : false }); })()`,
    returnByValue: true,
  })
  const s = JSON.parse(r.result.value)
  if (s.end >= dur - 0.5 || s.ended) { done = true; break }
  await new Promise(r => setTimeout(r, 250))
}
// freeze + pause atomically — the hook now passes appends through, so autoplay/loop after this never enters the buffers
await cdp(sessionId, 'Runtime.evaluate', { expression: `(() => { window.__capDone = true; const v = document.querySelector('video'); if (v) v.pause(); return 'frozen'; })()`, returnByValue: true })
```

## Pull bytes to disk in small 3-aligned base64 slices

A single `returnByValue` frame carrying a multi-MB blob **closes the CDP WebSocket** (see [connection.md](connection.md) — WebSocket payload limits). So pull in small slices and write each to disk as it arrives. Two rules:

1. **Each slice ≤ 256KB** (`262143` bytes — 256KB−1). Keep every CDP response well under the WS limit. Proven: a 4MB slice from the same buffer drops the socket on the first call; a 256KB slice survives.
2. **The slice length is divisible by 3.** Base64 encodes 3 bytes → 4 chars; a 3-aligned length means each slice's base64 is independently decodable with no interior padding. `262143 = 3 × 87381`.

Page-side helper that base64-encodes a slice in `≤49998`-byte sub-chunks (49998 is divisible by 3 and under the `fromCharCode.apply` call-stack arg limit):

```js
window.__pullBuffer = function(i, offset, len) {
  const b = window.__cap.buffers[i];
  // materialize the concatenated buffer once, then slice it
  if (!b._all) { b._all = new Uint8Array(b.bytes); let o = 0; for (const c of b.chunks) { b._all.set(c, o); o += c.length; } }
  const slice = b._all.subarray(offset, Math.min(offset + len, b._all.length));
  let b64 = '';
  for (let k = 0; k < slice.length; k += 49998) {
    const e = Math.min(k + 49998, slice.length);
    b64 += btoa(String.fromCharCode.apply(null, slice.subarray(k, e)));
  }
  return b64;
}
```

Node-side drain loop — pull a slice, append to the file, advance the offset:

```js
const fs = await import('node:fs')
const SLICE = 262143
const path = `${tmpdir}/video.fmp4`
fs.writeFileSync(path, Buffer.alloc(0))
let off = 0
const info = (await cdp(sessionId, 'Runtime.evaluate', { expression: 'JSON.stringify(window.__capInfo())', returnByValue: true })).result.value
const b = JSON.parse(info).find(x => x.kind === 'video')   // pick the buffer (see "largest of each kind")
while (off < b.bytes) {
  const r = await cdp(sessionId, 'Runtime.evaluate', { expression: `window.__pullBuffer(${b.i},${off},${SLICE})`, returnByValue: true })
  const b64 = r.result.value
  if (!b64) break
  const chunk = Buffer.from(b64, 'base64')
  fs.appendFileSync(path, chunk)
  off += chunk.length
}
```

## Drain during playback, not all after pause

If you pull everything after `pause()`, the tab stays open for ~30s while the bytes leave page memory. Instead, drain to disk **during** the coverage loop (every few ticks) with an incremental `__drainNew(maxBytes)` that returns only the chunks appended since the last call. By latch-time nearly all the capture is already on disk, so the post-pause pull is just the tail and the tab closes immediately. An incremental drain also means a too-big single segment (a 1440p fMP4 segment is often 1–4MB) is **sliced across drains** — never emit more than `maxBytes` in one CDP response, even for one chunk.

## Pick the largest buffer of each kind

The player can create more than one `MediaSource` — a quality-switch re-init, a mini-player — so there may be several video/audio buffers. The real full capture is the **largest** of each kind; the small ones are abandoned lower-quality pairs or init-segment duplicates. Unlink the rest.

```js
let pv = null, pa = null
for (const b of buffers) {
  if (b.kind === 'video' && (!pv || b.bytes > pv.bytes)) pv = b
  if (b.kind === 'audio' && (!pa || b.bytes > pa.bytes)) pa = b
}
```

## Traps

- **Inject the hook BEFORE `Page.navigate`.** Inject after and you miss the player's init segment. `addScriptToEvaluateOnNewDocument` runs on the next navigation in the tab, so order it before `navigate`.
- **`returnByValue` has a size ceiling — keep slices ≤ 256KB.** One oversized CDP response closes the WebSocket and every call after fails until you reconnect (`session.connect()`). See [connection.md](connection.md). 256KB, divisible by 3, is the safe slice.
- **`appendBuffer` is a non-writable prototype property.** Define an **own** property on the instance to shadow it (`Object.defineProperty(sb, 'appendBuffer', { configurable: true, writable: true, value })`). Assigning `sb.appendBuffer = …` silently fails.
- **Foreground tab, or the page never plays.** A background/throttled tab doesn't autoplay and never feeds `MediaSource`. Omit `background: true`; re-assert `muted` each tick so a quality switch doesn't blast audio.
- **Kind from the codec, not the container.** Some players put audio in a `video/mp4` `SourceBuffer` (TikTok does). A `mime.startsWith('video')` check mis-tags the audio buffer as video and you get a silent capture. Parse the `codecs=` param and key off the codec fourcc (`mp4a`/`opus`/… = audio, `avc1`/`av01`/… = video).
- **Latch once, then freeze.** Break the first time `buffered.end >= dur - 0.5` and never re-check — autoplay/loop after latch is irrelevant. Set `window.__capDone` and `pause()` atomically so further appends pass through and never enter the buffers.
- **Trim to the played duration.** The raw MSE media can be longer than the `<duration>` the player shows (an edit list excludes a trailing section). When muxing with ffmpeg, `-t <duration> -c copy` trims the output to what the user actually watched.
- **`fromCharCode.apply` has an arg-limit.** Don't encode the whole slice in one `btoa(String.fromCharCode.apply(null, slice))` — it throws on a large array. Sub-chunk at ≤49998 bytes (divisible by 3, under the limit).
