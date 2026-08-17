/**
 * CDP Session: one persistent WebSocket to Chrome's browser endpoint.
 * Auto-injects sessionId for the active target on every call.
 *
 * Connect with `flatten: true` so all sessions share one WS (no nested
 * Target.sendMessageToTarget envelopes).
 */

import { bindDomains, type Domains, type Transport } from './generated.ts';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

export type CdpCallObservation = {
  method: string;
  params: unknown;
  sessionId?: string;
  result: unknown;
  durationMs: number;
};

export type CdpCallObserver = (call: CdpCallObservation) => void | Promise<void>;

export type ConnectOptions = {
  /** Full WS URL: ws://host:port/devtools/browser/<id>. Escape hatch. */
  wsUrl?: string;
  /** Or: read DevToolsActivePort from a specific browser's profile dir. */
  profileDir?: string;
  /** Connect to a specific port. Tries /json/version first, then falls back
   *  to scanning detected browsers for one listening on this port. */
  port?: number;
  /** Host for port-based connect. Default: '127.0.0.1'. */
  host?: string;
  /** Per-candidate WS-open timeout in ms. Default 5000.
   *  A live browser opens or 403s within ~100ms, so 5s is generous.
   *  The only case that legitimately needs longer is waiting on the Chrome
   *  "Allow" popup — bump to 30000 if you expect the user to click it. */
  timeoutMs?: number;
  /** Opt OUT of auto-dismissing Dia's "Allow debugging connection?" prompt.
   *  On by default (macOS, Dia only): when the WS-open stalls the SDK fires a
   *  Return at the Dia process via osascript, so connect needs no manual
   *  click — a no-op for every other browser. Set false to disable.
   *  Persisted on the Session so auto-heal reconnects inherit it. Needs
   *  macOS Accessibility permission; if missing, the connect just waits on
   *  timeoutMs (see the README for the one-time grant). */
  autoAllow?: boolean;
  /** ms after the WS-open attempt before auto-dismissing Dia's prompt.
   *  Default 600 — a live WS opens in ~100ms, so "still connecting at 600ms"
   *  means the prompt is up. Measured from WebSocket creation. */
  autoAllowDelayMs?: number;
};

/** A Chromium-based browser detected as running on this machine. */
export type DetectedBrowser = {
  /** Short label, e.g. 'Google Chrome', 'Brave', 'Comet'. */
  name: string;
  /** Absolute profile (user-data) dir. */
  profileDir: string;
  /** Port from DevToolsActivePort line 1. */
  port: number;
  /** WebSocket path from DevToolsActivePort line 2. */
  wsPath: string;
  /** `ws://127.0.0.1:<port><wsPath>` — ready for WebSocket. */
  wsUrl: string;
  /** DevToolsActivePort mtime (ms since epoch). Used to order by recency. */
  mtimeMs: number;
};

export class Session implements Transport {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private activeSessionId: string | undefined;
  private eventListeners: Array<(method: string, params: unknown, sessionId?: string) => void> = [];
  private callObserver?: CdpCallObserver;
  private connectPromise?: Promise<void>;

  /** On by default: connect()/reconnect auto-dismisses Dia's "Allow
   *  debugging connection?" prompt (macOS, via osascript Return) — a no-op
   *  for every other browser. Persisted so the auto-heal reconnect in _call
   *  inherits it. Set false via connect({ autoAllow: false }) or
   *  --no-auto-allow to opt out. */
  autoAllow = true;

  // Generated bindings — one per CDP domain.
  // Initialized lazily after construction so `_call` is available.
  domains!: Domains;

  constructor() {
    this.domains = bindDomains(this);
    // Mirror domains onto `this` so calls read as `session.Page.navigate(...)`.
    for (const k of Object.keys(this.domains) as (keyof Domains)[]) {
      (this as any)[k] = this.domains[k];
    }
  }

  /**
   * Connect to Chrome's browser-level WebSocket.
   *
   * With no args, runs auto-detect: scans OS-specific profile dirs via
   * `detectBrowsers()` and tries each candidate (most-recently-launched first)
   * until a WebSocket open succeeds. Each attempt has a short timeout so
   * dead ports and permission-denied (403) candidates fail fast and the
   * loop moves on.
   *
   * With explicit opts ({ wsUrl } | { profileDir } | { port }), connects
   * directly to that single URL with a generous timeout.
   */
  async connect(opts: ConnectOptions = {}): Promise<void> {
    // Fast path: already connected.
    if (this.isConnected()) return;
    // Another connect is in flight — ride on it.
    if (this.connectPromise) return this.connectPromise;
    // Persist autoAllow so the auto-heal reconnect in _call (no-arg connect)
    // inherits it.
    if (opts.autoAllow !== undefined) this.autoAllow = opts.autoAllow;
    this.connectPromise = this._connect(opts);
    try {
      await this.connectPromise;
    } catch (e) {
      this.connectPromise = undefined;
      throw e;
    }
    // Clear once settled so future calls can reconnect after a WS drop.
    this.connectPromise = undefined;
  }

  private async _connect(opts: ConnectOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 5_000;
    const autoAllowDelayMs = opts.autoAllowDelayMs ?? 600;
    if (opts.wsUrl || opts.profileDir || opts.port) {
      const wsUrl = await resolveWsUrl(opts);
      // Only resolve the browser name when auto-allow is on — it gates the
      // Dia-only prompt dismissal and would otherwise add a detectBrowsers() scan
      // to every explicit connect.
      const name = this.autoAllow ? await browserNameFor(opts, wsUrl) : undefined;
      await this.openWs(wsUrl, timeoutMs, { autoAllow: this.autoAllow, name, autoAllowDelayMs });
      return;
    }
    const browsers = await detectBrowsers();
    if (browsers.length === 0) {
      const scanned = getBrowserCandidates().map(c => c.name).join(', ');
      throw new Error(
        `No running browser with remote debugging detected. Enable it from chrome://inspect > "Discover network targets", or pass { profileDir } / { wsUrl } explicitly. Scanned: ${scanned}.`,
      );
    }
    const errors: string[] = [];
    for (const b of browsers) {
      try {
        await this.openWs(b.wsUrl, timeoutMs, { autoAllow: this.autoAllow, name: b.name, autoAllowDelayMs });
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`  ${b.name} @ ${b.wsUrl}: ${msg}`);
      }
    }
    throw new Error(
      `No detected browser accepted a connection. If one of these is the browser you want, click "Allow" on its remote-debugging prompt and retry, or pass { profileDir, timeoutMs: 30000 } to wait for the click:\n${errors.join('\n')}`,
    );
  }

  private openWs(
    wsUrl: string,
    timeoutMs: number,
    allow?: { autoAllow: boolean; name?: string; autoAllowDelayMs: number },
  ): Promise<void> {
    return new Promise<void>((res, rej) => {
      const ws = new WebSocket(wsUrl);
      let done = false;
      let allowTried = false;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (allowTimer) clearTimeout(allowTimer);
        if (err) { try { ws.close(); } catch { /* ignore */ } rej(err); }
        else res();
      };
      const timer = setTimeout(() => finish(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      // Dia gates the WS-open behind an "Allow debugging connection?" prompt
      // (Return = Allow). If the WS is still CONNECTING past autoAllowDelayMs,
      // the prompt is up — fire one Return at the Dia process and keep
      // waiting. No-op for non-Dia browsers and on non-macOS.
      const allowTimer =
        allow && allow.autoAllow && allow.name === 'Dia' && process.platform === 'darwin'
          ? setTimeout(() => {
              if (done || allowTried) return;
              if (ws.readyState !== WebSocket.CONNECTING) return;
              allowTried = true;
              dismissDiaAllowPrompt();
            }, allow.autoAllowDelayMs)
          : null;
      ws.addEventListener('open', () => finish());
      ws.addEventListener('error', (e) => finish(new Error(`WS error: ${(e as any)?.message ?? 'connect failed (likely 403, permission not granted, or port closed)'}`)));
      ws.addEventListener('message', (e) => this.onMessage(String(e.data)));
      ws.addEventListener('close', () => {
        // Only reject pending calls that were sent on this WebSocket.
        // A parallel connect() can create a phantom WS whose close handler
        // would otherwise nuke pending entries belonging to the active WS.
        if (this.ws === ws) {
          for (const [, p] of this.pending) p.reject(new Error('CDP socket closed'));
          this.pending.clear();
        }
        finish(new Error('WS closed before open (likely 403 or port closed)'));
      });
      this.ws = ws;
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws?.close();
  }

  private closeQueue: Promise<void> = Promise.resolve();

  /**
   * Close a tab by targetId.
   *
   *  Uses `window.close()` via Runtime.evaluate first (works on tabs opened
   *  by script, which includes all tabs created via Target.createTarget), then
   *  `Target.closeTarget` to tear down the CDP session.
   *
   *  Why two steps: `Target.closeTarget` alone succeeds in CDP but some
   *  Chromium forks (Dia, Arc) don't actually close the tab in the browser
   *  window — the tab strip stays out of sync. `window.close()` triggers the
   *  browser's own tab-close path, which reliably removes the tab. The short
   *  delay gives the browser time to process the close before CDP teardown.
   *
   *  Close operations are serialized so that the window.close() → delay →
   *  Target.closeTarget sequence for one tab completes before the next begins.
   *  Without serialization, interleaved closes can kill a session before
   *  window.close() takes effect in the browser.
   */
  async closeTab(targetId: string, sessionId?: string): Promise<void> {
    const doClose = async () => {
      if (sessionId) {
        try {
          await this._call('Runtime.evaluate', { expression: 'window.close()' }, { sessionId });
        } catch { /* session may already be detaching */ }
        await new Promise(r => setTimeout(r, 100));
      }
      try {
        await this.domains.Target.closeTarget({ targetId });
      } catch { /* already gone */ }
    };
    // Serialize: each close waits for the previous one to finish.
    this.closeQueue = this.closeQueue.then(doClose, doClose);
    return this.closeQueue;
  }

  /**
   * Pick a target and make subsequent calls auto-route to it.
   * Uses Target.attachToTarget with flatten:true (single-WS, sessionId-on-message).
   */
  async use(targetId: string): Promise<string> {
    const r = await this._call('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    this.activeSessionId = r.sessionId;
    return r.sessionId;
  }

  /** Set the active sessionId directly (e.g. one you already attached). */
  setActiveSession(sessionId: string | undefined): void {
    this.activeSessionId = sessionId;
  }

  getActiveSession(): string | undefined {
    return this.activeSessionId;
  }

  /** Observe successful CDP calls. Observer failures never break the protocol call. */
  setCallObserver(observer: CdpCallObserver | undefined): void {
    this.callObserver = observer;
  }

  /** Subscribe to all CDP events. Returns an unsubscribe fn. */
  onEvent(fn: (method: string, params: unknown, sessionId?: string) => void): () => void {
    this.eventListeners.push(fn);
    return () => {
      this.eventListeners = this.eventListeners.filter(x => x !== fn);
    };
  }

  /** Wait for the next event matching `method` (and optional predicate).
   *  If `sessionId` is given, only fires for events from that session —
   *  critical for avoiding cross-fire in parallel tab use. */
  waitFor<T = unknown>(method: string, predicate?: (params: T) => boolean, timeoutMs?: number): Promise<T>;
  waitFor<T = unknown>(opts: { method: string; sessionId?: string; predicate?: (params: T) => boolean; timeoutMs?: number }): Promise<T>;
  waitFor<T = unknown>(methodOrOpts: string | { method: string; sessionId?: string; predicate?: (params: T) => boolean; timeoutMs?: number }, predicateOrTimeout?: ((params: T) => boolean) | number, timeoutMs = 30_000): Promise<T> {
    let method: string;
    let sessionId: string | undefined;
    let predicate: ((params: T) => boolean) | undefined;
    if (typeof methodOrOpts === 'string') {
      method = methodOrOpts;
      if (typeof predicateOrTimeout === 'function') {
        predicate = predicateOrTimeout;
      } else if (typeof predicateOrTimeout === 'number') {
        timeoutMs = predicateOrTimeout;
      }
    } else {
      method = methodOrOpts.method;
      sessionId = methodOrOpts.sessionId;
      predicate = methodOrOpts.predicate;
      if (methodOrOpts.timeoutMs) timeoutMs = methodOrOpts.timeoutMs;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      const unsub = this.onEvent((m, params, sid) => {
        if (m !== method) return;
        if (sessionId !== undefined && sid !== sessionId) return;
        if (predicate && !predicate(params as T)) return;
        clearTimeout(timer);
        unsub();
        resolve(params as T);
      });
    });
  }

  // Transport implementation. Called by the generated domain bindings.
  _call(method: string, params: unknown = {}, opts?: { sessionId?: string }, reconnected = false): Promise<unknown> {
    // Self-heal: a giant CDP response (e.g. getFullAXTree on a huge page) or a
    // browser hiccup can close the WebSocket. Reconnect once and retry rather
    // than poisoning every subsequent call with `Not connected`. After a
    // reconnect the active-session pointer / prior flat sessionIds may be stale,
    // but a stale sessionId surfaces a clean CDP `session not found` (re-attach),
    // never a wrong-target action.
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (reconnected) return Promise.reject(new Error('Not connected. Call session.connect(...) first.'));
      return this.connect().then(() => this._call(method, params, opts, true));
    }
    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method, params: params ?? {} };
    const sid = opts?.sessionId ?? this.activeSessionId;
    if (sid && !isBrowserLevel(method)) {
      msg.sessionId = sid;
    }
    const startedAt = performance.now();
    const wire = JSON.stringify(msg);
    // Observe the immutable wire params, not an object the caller can mutate
    // while Chrome is processing the request.
    const observedParams = (JSON.parse(wire) as { params?: unknown }).params ?? {};
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(wire);
    });
    if (!this.callObserver) return response;
    return response.then(async result => {
      try {
        const observation = Promise.resolve(this.callObserver?.({
          method,
          params: observedParams,
          sessionId: sid,
          result,
          durationMs: performance.now() - startedAt,
        }));
        // Diagnostics may add bounded latency, but a stalled screenshot or disk
        // must never leave an otherwise successful CDP action unresolved.
        await new Promise<void>(resolveObservation => {
          const timer = setTimeout(resolveObservation, 5_000);
          const done = () => { clearTimeout(timer); resolveObservation(); };
          observation.then(done, done);
        });
      } catch {
        // Recording and diagnostics must never change protocol behavior.
      }
      return result;
    });
  }

  private onMessage(raw: string): void {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (typeof m.id === 'number') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new CdpError(m.error.code, m.error.message, m.error.data));
      else p.resolve(m.result);
    } else if (m.method) {
      for (const fn of this.eventListeners) {
        try { fn(m.method, m.params, m.sessionId); } catch { /* ignore */ }
      }
    }
  }
}

export class CdpError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(`CDP ${code}: ${message}`);
    this.name = 'CdpError';
    this.code = code;
    this.data = data;
  }
}

/** Browser-level methods never take a sessionId. */
function isBrowserLevel(method: string): boolean {
  return method.startsWith('Browser.') || method.startsWith('Target.');
}

/** Best-effort browser name for the Dia-only auto-allow gate. For { profileDir }
 *  it matches the candidate list directly (no file reads); otherwise falls back
 *  to detectBrowsers() and matches by WS URL / port. undefined for a remote
 *  { wsUrl } — which keeps auto-allow off (only local Dia is targeted). */
async function browserNameFor(opts: ConnectOptions, wsUrl: string): Promise<string | undefined> {
  if (opts.profileDir) {
    const byDir = getBrowserCandidates().find(c => c.profileDir === opts.profileDir);
    if (byDir) return byDir.name;
  }
  const browsers = await detectBrowsers();
  return browsers.find(b => b.wsUrl === wsUrl || (opts.port != null && b.port === opts.port))?.name;
}

/** Dismiss Dia's "Allow debugging connection?" prompt by sending Return to the
 *  Dia process via osascript (macOS). Dia maps Return -> Allow; bringing Dia
 *  to front first (best-effort try) covers the switched-away case. Fire-and-
 *  forget: the WS 'open' lands ~100ms after the keystroke. Gated on
 *  name === 'Dia' in openWs, so the process name is hardcoded here. Needs
 *  macOS Accessibility permission; without it osascript errors and the connect
 *  just waits on its timeout. */
function dismissDiaAllowPrompt(): void {
  if (process.platform !== 'darwin') return;
  try {
    execFile('osascript', [
      '-e', 'tell application "System Events"',
      '-e', 'try',
      '-e', 'set frontmost of process "Dia" to true',
      '-e', 'end try',
      '-e', 'tell process "Dia" to keystroke return',
      '-e', 'end tell',
    ], () => { /* fire-and-forget; osascript errors are non-fatal */ });
  } catch { /* spawn failure — best effort */ }
}

/**
 * Resolve a WebSocket URL for one of the explicit connect forms:
 *   { wsUrl }      — passthrough.
 *   { profileDir } — reads `<profileDir>/DevToolsActivePort` and builds the
 *                    WS URL directly. Works on all Chrome versions including
 *                    144+ / chrome://inspect (which doesn't serve /json/version).
 *   { port, host? } — tries /json/version on that host:port for the
 *                    webSocketDebuggerUrl. Falls back to scanning detected
 *                    browsers for one listening on that port.
 *
 * For auto-detect, call `session.connect()` with no args — it iterates
 * `detectBrowsers()` and picks the first browser whose WS accepts.
 */
export async function resolveWsUrl(opts: ConnectOptions): Promise<string> {
  if (opts.wsUrl) return opts.wsUrl;
  if (opts.profileDir) {
    const { port, path } = await readDevToolsActivePort(opts.profileDir);
    return `ws://127.0.0.1:${port}${path}`;
  }
  if (opts.port) {
    const host = opts.host ?? '127.0.0.1';
    const wsUrl = await resolveWsUrlFromPort(opts.port, host);
    if (wsUrl) return wsUrl;
    throw new Error(
      `Could not resolve a WebSocket URL from ${host}:${opts.port}. ` +
      `The port is open but /json/version returned no webSocketDebuggerUrl, ` +
      `and no detected browser is listening on that port. ` +
      `Try { profileDir } or { wsUrl } instead.`,
    );
  }
  throw new Error('resolveWsUrl needs { wsUrl }, { profileDir }, or { port }. For auto-detect, call session.connect() directly.');
}

async function resolveWsUrlFromPort(port: number, host: string): Promise<string | undefined> {
  try {
    const resp = await fetch(`http://${host}:${port}/json/version`);
    if (resp.ok) {
      const json: any = await resp.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    }
  } catch { /* /json/version not served (Chrome 144+, Dia, etc.) */ }
  const browsers = await detectBrowsers();
  const match = browsers.find(b => b.port === port);
  return match?.wsUrl;
}

/**
 * Parse both lines of DevToolsActivePort. Chrome writes:
 *   line 1: port number
 *   line 2: path (e.g. "/devtools/browser/<uuid>")
 * With both in hand we can build `ws://host:port<path>` with no HTTP probe.
 */
async function readDevToolsActivePort(profileDir: string): Promise<{ port: number; path: string }> {
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const text = (await readFile(`${profileDir}/DevToolsActivePort`, 'utf8')).trim();
      const [portStr, path] = text.split('\n');
      const port = Number(portStr);
      if (!Number.isFinite(port)) throw new Error(`malformed port line: ${portStr}`);
      if (!path || !path.startsWith('/devtools/')) {
        // File is written atomically but path line may not be there on first open.
        throw new Error(`missing/invalid path line in DevToolsActivePort: ${JSON.stringify(text)}`);
      }
      return { port, path };
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error(`Could not read ${profileDir}/DevToolsActivePort after 30s: ${lastErr}`);
}

/**
 * List page targets via CDP's `Target.getTargets` (works on all Chrome versions,
 * including those that do not serve /json). Filters out chrome:// and devtools://
 * internals. Requires the session to be connected already.
 */
export type PageTarget = { targetId: string; title: string; url: string; type: string };
export async function listPageTargets(session: Session): Promise<PageTarget[]> {
  const { targetInfos } = await session.domains.Target.getTargets({});
  return (targetInfos as PageTarget[]).filter(
    t => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('devtools://')
  );
}

/**
 * Scan OS-specific user-data directories for Chromium-based browsers that
 * currently have remote debugging enabled (a `DevToolsActivePort` file exists
 * in the profile dir). Does NOT verify the WS endpoint is live — call
 * `verifyWsEndpoint(wsUrl)` on each entry if you need that.
 *
 * Ordered by DevToolsActivePort mtime descending, so the most-recently-
 * launched browser is first — that's the one `connect()` picks by default.
 *
 * This is the ONLY reliable connect method for Chrome 144+ with remote
 * debugging toggled from chrome://inspect — those browsers do NOT serve
 * `/json/version`, so port-probe discovery fails.
 *
 * In addition to the explicit candidate list, a bounded fallback scan of the
 * OS browser-data roots discovers browsers without a hardcoded entry (newly-
 * released Chromium forks, niche browsers). Both are merged and ordered by
 * recency.
 */
export async function detectBrowsers(): Promise<DetectedBrowser[]> {
  const candidates = getBrowserCandidates();
  const detected: DetectedBrowser[] = [];
  const seen = new Set<string>();
  for (const { name, profileDir } of candidates) {
    const parsed = await tryReadDevToolsActivePort(profileDir);
    if (!parsed) continue;
    seen.add(profileDir);
    detected.push({
      name,
      profileDir,
      port: parsed.port,
      wsPath: parsed.path,
      wsUrl: `ws://127.0.0.1:${parsed.port}${parsed.path}`,
      mtimeMs: parsed.mtimeMs,
    });
  }
  // Fallback: scan the OS browser-data roots for any Chromium browser we
  // don't ship an explicit entry for (newly-released forks, niche browsers
  // like Aside). Catches profile layouts the hardcoded list doesn't cover.
  for (const extra of await scanForExtraBrowsers(seen)) {
    detected.push(extra);
  }
  detected.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return detected;
}

type BrowserCandidate = { name: string; profileDir: string };

/** OS-specific user-data dirs for Chromium-based browsers, in rough popularity order. */
function getBrowserCandidates(): BrowserCandidate[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const list: BrowserCandidate[] = [];
  const push = (name: string, profileDir: string) => list.push({ name, profileDir });

  if (process.platform === 'darwin') {
    const base = `${home}/Library/Application Support`;
    push('Dia',                    `${base}/Dia/User Data`);
    push('Google Chrome',          `${base}/Google/Chrome`);
    push('Chromium',               `${base}/Chromium`);
    push('Microsoft Edge',         `${base}/Microsoft Edge`);
    push('Brave',                  `${base}/BraveSoftware/Brave-Browser`);
    push('Arc',                    `${base}/Arc/User Data`);
    push('Vivaldi',                `${base}/Vivaldi`);
    push('Opera',                  `${base}/com.operasoftware.Opera`);
    push('Comet',                  `${base}/Comet`);
    push('Aside',                  `${base}/Aside`);
    push('Google Chrome Canary',   `${base}/Google/Chrome Canary`);
  } else if (process.platform === 'linux') {
    const cfg = `${home}/.config`;
    push('Dia',                    `${cfg}/dia`);
    push('Google Chrome',          `${cfg}/google-chrome`);
    push('Chromium',               `${cfg}/chromium`);
    push('Microsoft Edge',         `${cfg}/microsoft-edge`);
    push('Brave',                  `${cfg}/BraveSoftware/Brave-Browser`);
    push('Vivaldi',                `${cfg}/vivaldi`);
    push('Opera',                  `${cfg}/opera`);
    push('Aside',                  `${cfg}/aside`);
    push('Google Chrome Canary',   `${cfg}/google-chrome-unstable`);
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
    push('Dia',                    `${local}\\Dia\\User Data`);
    push('Aside',                  `${local}\\Aside`);
    push('Google Chrome',          `${local}\\Google\\Chrome\\User Data`);
    push('Chromium',               `${local}\\Chromium\\User Data`);
    push('Microsoft Edge',         `${local}\\Microsoft\\Edge\\User Data`);
    push('Brave',                  `${local}\\BraveSoftware\\Brave-Browser\\User Data`);
    push('Arc',                    `${local}\\Arc\\User Data`);
    push('Vivaldi',                `${local}\\Vivaldi\\User Data`);
    push('Opera',                  `${local}\\Opera Software\\Opera Stable`);
    push('Google Chrome Canary',   `${local}\\Google\\Chrome SxS\\User Data`);
  }
  return list;
}

/** OS-specific parent dirs holding Chromium browser profile folders — the same
 *  roots `getBrowserCandidates` draws from. `scanForExtraBrowsers()` walks
 *  these to discover browsers without a hardcoded entry. */
function getBrowserDataRoots(): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (process.platform === 'darwin') return [`${home}/Library/Application Support`];
  if (process.platform === 'linux')  return [`${home}/.config`];
  if (process.platform === 'win32')  return [process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`];
  return [];
}

/**
 * Best-effort fallback scan of the browser-data roots for Chromium-based
 * browsers NOT in `getBrowserCandidates()`. Catches new/niche forks (Antigravity, howcode,
 * etc.) without a hardcoded path, so `connect()` supports them out of the box.
 *
 * Bounded to two directory levels under each root — enough to cover every
 * Chromium profile layout we know of:
 *   <root>/<product>/DevToolsActivePort                    (Comet, Vivaldi, Edge, Aside)
 *   <root>/<product>/User Data/DevToolsActivePort          (Arc, Dia)
 *   <root>/<vendor>/<product>/DevToolsActivePort           (Google/Chrome)
 *   <root>/<vendor>/<product>/User Data/DevToolsActivePort (Windows layouts)
 *
 * `seen` holds profileDirs already found via the explicit list and is mutated
 * to include fallback hits, so callers dedup. Every readdir/stat is wrapped —
 * permission errors and missing dirs are skipped silently. Dotfile entries are
 * skipped to avoid probing things like `.DS_Store` / `.Trash`.
 */
async function scanForExtraBrowsers(seen: Set<string>): Promise<DetectedBrowser[]> {
  const extras: DetectedBrowser[] = [];
  const probe = async (name: string, profileDir: string) => {
    if (seen.has(profileDir)) return;
    const parsed = await tryReadDevToolsActivePort(profileDir);
    if (!parsed) return;
    seen.add(profileDir);
    extras.push({
      name,
      profileDir,
      port: parsed.port,
      wsPath: parsed.path,
      wsUrl: `ws://127.0.0.1:${parsed.port}${parsed.path}`,
      mtimeMs: parsed.mtimeMs,
    });
  };
  for (const root of getBrowserDataRoots()) {
    let children: string[] = [];
    try { children = await readdir(root); } catch { continue; }
    for (const child of children) {
      if (child.startsWith('.')) continue;
      const dirA = join(root, child);
      // Direct layout: <root>/<child> and <root>/<child>/User Data.
      await probe(child, dirA);
      await probe(child, join(dirA, 'User Data'));
      // Vendor/product layout: <root>/<child>/<grandchild>[/User Data].
      let grands: string[] = [];
      try { grands = await readdir(dirA); } catch { continue; }
      for (const grand of grands) {
        if (grand.startsWith('.')) continue;
        const dirB = join(dirA, grand);
        await probe(`${child} ${grand}`, dirB);
        await probe(`${child} ${grand}`, join(dirB, 'User Data'));
      }
    }
  }
  return extras;
}

/**
 * Read and parse `<profileDir>/DevToolsActivePort` once (no polling), returning
 * undefined if the file is missing or malformed. Also returns mtime so callers
 * can sort by recency.
 */
async function tryReadDevToolsActivePort(
  profileDir: string,
): Promise<{ port: number; path: string; mtimeMs: number } | undefined> {
  try {
    const p = `${profileDir}/DevToolsActivePort`;
    const [text, st] = await Promise.all([readFile(p, 'utf8'), stat(p)]);
    const [portStr, path] = text.trim().split('\n');
    const port = Number(portStr);
    if (!Number.isFinite(port)) return undefined;
    if (!path || !path.startsWith('/devtools/')) return undefined;
    return { port, path, mtimeMs: st.mtimeMs };
  } catch {
    return undefined;
  }
}

