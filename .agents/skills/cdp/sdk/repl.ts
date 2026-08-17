/**
 * CDP REPL — HTTP server holding one persistent CDP Session.
 *
 * Endpoints (bind 127.0.0.1:9876 by default; override with $CDP_REPL_PORT):
 *   POST /eval     body = raw JS to evaluate (NOT JSON-wrapped).
 *                  Top-level await supported. Single expression auto-returns.
 *                  Response: {"ok":true,"result":<json>} | {"ok":false,"error":..,"stack"?:..}
 *   GET  /health   {"ok":true,"version":<string>,"uptime":<seconds>,"connected":<bool>,"sessionId":<string|null>}
 *   POST /quit     graceful shutdown. Returns {"ok":true} then exits.
 *
 * State: `session`, the active sessionId, event subscribers, and any
 * `globalThis.<name>` you set persist across requests for the lifetime of
 * the process.
 */

import { Session, listPageTargets, resolveWsUrl, detectBrowsers } from './session.ts';
import { axView, axDiff, parseAxRefs } from './axview.ts';
import { RecordingManager } from './recording.ts';
import * as Generated from './generated.ts';
import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';

// Read once at boot and cache for the process lifetime, so /health reports the
// version the daemon was *started* with — not the one currently on disk. That
// makes a stale daemon (installed files updated without a restart) detectable:
// `browser-harness-js --version` (disk) vs /health `version` (memory) differ.
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

const session = new Session();
const recording = new RecordingManager(session);
session.setCallObserver(recording.observe);
(globalThis as any).session = session;
(globalThis as any).Session = Session;
// Bind helpers to the singleton session so the agent calls `listPageTargets()`
// with no args (no host/port confusion, no /json endpoint assumption).
(globalThis as any).listPageTargets = () => listPageTargets(session);
(globalThis as any).resolveWsUrl = resolveWsUrl;
(globalThis as any).detectBrowsers = detectBrowsers;
(globalThis as any).axView = axView;
(globalThis as any).axDiff = axDiff;
(globalThis as any).parseAxRefs = parseAxRefs;
(globalThis as any).CDP = Generated;
(globalThis as any).cdp = (sid: string, method: string, params: unknown) => session._call(method, params, { sessionId: sid });

/** Resolve an axView ref number (or `[n]` string) to backendDOMNodeId via a refs Map or parseAxRefs(view). */
function resolveAxBackendId(
  ref: number | string,
  refs: Map<number, number> | string,
): number {
  const n = typeof ref === 'string' ? Number(String(ref).replace(/\[|\]/g, '')) : ref;
  if (!Number.isFinite(n)) throw new Error(`Invalid ax ref: ${ref}`);
  const map = typeof refs === 'string' ? parseAxRefs(refs) : refs;
  const backendNodeId = map.get(n);
  if (backendNodeId == null) throw new Error(`Unknown ax ref [${n}] — re-snapshot; refs are only valid for one getFullAXTree`);
  return backendNodeId;
}

/** Click the center of an axView ref. `refs` is a Map from parseAxRefs or the axView string itself. */
async function axClick(ref: number | string, refs: Map<number, number> | string): Promise<void> {
  const backendNodeId = resolveAxBackendId(ref, refs);
  const { model } = await session.domains.DOM.getBoxModel({ backendNodeId });
  const x = model.content[0]!;
  const y = model.content[1]!;
  const cx = x + model.width / 2;
  const cy = y + model.height / 2;
  await session.domains.Input.dispatchMouseEvent({ type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await session.domains.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
}

/** Focus an axView ref (click) then insert text. */
async function axType(ref: number | string, refs: Map<number, number> | string, text: string): Promise<void> {
  await axClick(ref, refs);
  await session.domains.Input.insertText({ text });
}

(globalThis as any).axClick = axClick;
(globalThis as any).axType = axType;
(globalThis as any).startRecording = (name?: string, title?: string) => recording.start(name, title);
(globalThis as any).stopRecording = () => recording.stop();
(globalThis as any).recordingStatus = () => recording.status();
// Snake-case aliases ease migration from browser-harness recordings.
(globalThis as any).start_recording = (name?: string, title?: string) => recording.start(name, title);
(globalThis as any).stop_recording = () => recording.stop();

const PORT = Number(process.env.CDP_REPL_PORT ?? 9876);
const startedAt = Date.now();

function isExpression(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  if (/[;\n]/.test(trimmed)) return false;
  if (/^(let|const|var|if|for|while|do|switch|class|function|throw|try|return|import|export)\b/.test(trimmed)) return false;
  return true;
}

function serialize(v: unknown): unknown {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? val.toString() : val));
  } catch {
    return String(v);
  }
}

async function runSnippet(code: string): Promise<unknown> {
  const body = isExpression(code) ? `return (${code});` : code;
  const wrapped = `(async () => { ${body} })()`;
  return await (0, eval)(wrapped);
}

const TEXT = { 'content-type': 'text/plain; charset=utf-8' } as const;

/**
 * Render a value to the body of a successful /eval response.
 * - undefined / null / "" / {} / []  → empty (caller prints nothing)
 * - string → raw (no JSON quotes)
 * - everything else → JSON
 */
function renderResult(v: unknown): string {
  const s = serialize(v);
  if (s === undefined || s === null) return '';
  if (typeof s === 'string') return s;
  if (Array.isArray(s) && s.length === 0) return '';
  if (typeof s === 'object' && s !== null && Object.keys(s as object).length === 0) return '';
  return JSON.stringify(s);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      version: VERSION,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      connected: session.isConnected(),
      sessionId: session.getActiveSession() ?? null,
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/eval') {
    readBody(req).then(async (code) => {
      if (!code.trim()) {
        res.writeHead(400, TEXT);
        res.end('empty body\n');
        return;
      }
      try {
        const result = await runSnippet(code);
        const body = renderResult(result);
        res.writeHead(200, TEXT);
        res.end(body);
      } catch (e: any) {
        const msg = (e?.stack ?? e?.message ?? String(e)) + '\n';
        res.writeHead(500, TEXT);
        res.end(msg);
      }
    }).catch((e) => {
      if (!res.headersSent) {
        res.writeHead(500, TEXT);
        res.end(String(e?.message ?? e) + '\n');
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/quit') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    // Delay shutdown so the response flushes over the wire first.
    setTimeout(() => { server.close(); session.close(); process.exit(0); }, 50);
    return;
  }

  res.writeHead(404, TEXT);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(JSON.stringify({
    ok: true,
    ready: true,
    port,
    message: `CDP REPL listening on http://127.0.0.1:${port}`,
  }));
});
