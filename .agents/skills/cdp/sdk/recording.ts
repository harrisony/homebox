/**
 * Consent-based browser action recording.
 *
 * Recording is off by default. A recording contains one privacy-scrubbed JSON
 * line and one viewport screenshot per meaningful raw CDP action. The active
 * marker is on disk so explicit recordings survive daemon restarts.
 */

import { appendFile, chmod, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CdpCallObservation, Session } from './session.ts';

type JsonObject = Record<string, unknown>;

type PageContext = {
  url?: string;
  title?: string;
  w?: number;
  h?: number;
  sx?: number;
  sy?: number;
  dpr?: number;
  box?: { x: number; y: number; w: number; h: number };
  input?: string;
};

type SemanticAction = {
  helper: string;
  delayMs: number;
  details: JsonObject;
};

type RecordingMeta = {
  name: string;
  title: string | null;
  started: number;
  auto?: boolean;
};

const TEXT_LIMIT = 500;
const DEFAULT_IDLE_SECONDS = 180;
const URL_SECRETS = /([?&#](?:code|access_token|id_token|refresh_token|token|assertion|client_secret|client_info|session_state|api_?key|sig|signature|auth|authorization|password|secret)=)[^&#]+/gi;
const CONTEXT_EXPRESSION = String.raw`(() => {
  const out = {
    url: location.href,
    title: document.title,
    w: innerWidth,
    h: innerHeight,
    sx: scrollX,
    sy: scrollY,
    dpr: devicePixelRatio,
  };
  const element = document.activeElement;
  if (element && element !== document.body && element !== document.documentElement) {
    const rect = element.getBoundingClientRect();
    if (rect.width || rect.height) out.box = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    out.input = String(element.type || element.tagName || '').toLowerCase();
  }
  return out;
})()`;

export function recordingHome(): string {
  const configured = process.env.BROWSER_HARNESS_JS_HOME;
  return resolve(configured || join(homedir(), '.browser-harness-js'));
}

export function recordingsRoot(): string {
  return resolve(process.env.CDP_RECORDINGS_DIR || join(recordingHome(), 'recordings'));
}

function configPath(): string {
  return join(recordingHome(), 'recording.json');
}

function markerPath(): string {
  const port = process.env.CDP_REPL_PORT || '9876';
  return join(recordingsRoot(), `.active-${port}`);
}

function envOverride(): boolean | undefined {
  const raw = process.env.CDP_RECORD;
  if (raw == null) return undefined;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

async function loadConfig(): Promise<JsonObject> {
  try {
    const value: unknown = JSON.parse(await readFile(configPath(), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  } catch {
    return {};
  }
}

export async function autoRecordingSetting(): Promise<{ enabled: boolean; source: 'CDP_RECORD' | 'config' | 'default' }> {
  const override = envOverride();
  if (override !== undefined) return { enabled: override, source: 'CDP_RECORD' };
  const config = await loadConfig();
  if (typeof config.enabled === 'boolean') return { enabled: config.enabled, source: 'config' };
  return { enabled: false, source: 'default' };
}

export async function setAutoRecording(enabled: boolean): Promise<void> {
  await mkdir(recordingHome(), { recursive: true, mode: 0o700 });
  const target = configPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ enabled }) + '\n', { mode: 0o600 });
  await rename(temporary, target);
  if (process.platform !== 'win32') await chmod(target, 0o600);
  if (!enabled) {
    const active = await activeRecording();
    if (active && await isAutomatic(active)) await unlink(markerPath()).catch(() => {});
  }
}

export async function activeRecording(): Promise<string | undefined> {
  try {
    const candidate = resolve((await readFile(markerPath(), 'utf8')).trim());
    const root = recordingsRoot();
    const child = relative(root, candidate);
    if (child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) return undefined;
    if (!(await stat(candidate)).isDirectory()) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

export async function listRecordings(): Promise<string[]> {
  const root = recordingsRoot();
  let names: string[];
  try { names = await readdir(root); } catch { return []; }
  const found: Array<{ path: string; modified: number }> = [];
  await Promise.all(names.filter(name => !name.startsWith('.')).map(async name => {
    const path = join(root, name);
    try {
      if (!(await stat(path)).isDirectory()) return;
      const evidence = join(path, 'events.jsonl');
      const modified = await stat(existsSync(evidence) ? evidence : path);
      if (existsSync(join(path, 'meta.json')) || existsSync(evidence)) {
        found.push({ path, modified: modified.mtimeMs });
      }
    } catch { /* Ignore concurrent deletion and unreadable directories. */ }
  }));
  return found.sort((a, b) => b.modified - a.modified).map(item => item.path);
}

export async function latestRecording(): Promise<string | undefined> {
  return (await listRecordings())[0];
}

async function isAutomatic(directory: string): Promise<boolean> {
  try {
    const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8')) as RecordingMeta;
    return meta.auto === true;
  } catch {
    return false;
  }
}

function scrubUrl(value: unknown): string {
  const scrubbed = String(value ?? '').replace(URL_SECRETS, '$1REDACTED');
  try {
    const url = new URL(scrubbed);
    if (url.username) url.username = 'REDACTED';
    if (url.password) url.password = 'REDACTED';
    url.pathname = url.pathname.replace(/\/(token|secret|password|passcode|api[_-]?key)\/[^/]+/gi, '/$1/REDACTED');
    // Fragments frequently contain OAuth state or SPA session material and are
    // never needed by the video compiler.
    url.hash = '';
    return url.toString();
  } catch {
    return scrubbed;
  }
}

function safeName(name?: string): string {
  const fallback = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const value = (name || `rec-${fallback}`).trim();
  if (!value || value === '.' || value === '..' || /[/\\]/.test(value)) {
    throw new Error('recording name must be one safe path component');
  }
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error('recording name contains no usable characters');
  return normalized;
}

function idleSeconds(): number {
  const value = Number(process.env.CDP_RECORD_IDLE_SECONDS ?? DEFAULT_IDLE_SECONDS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_IDLE_SECONDS;
}

function objectParams(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function namedKey(value: unknown): string | undefined {
  const key = typeof value === 'string' ? value : '';
  if (!key) return undefined;
  return key.length === 1 ? '<character>' : key.slice(0, 80);
}

function classify(call: CdpCallObservation): SemanticAction | undefined {
  const params = objectParams(call.params);
  if (call.method === 'Page.navigate') {
    return { helper: 'goto_url', delayMs: 500, details: { to: scrubUrl(params.url) } };
  }
  if (call.method === 'Page.reload' || call.method === 'Page.navigateToHistoryEntry') {
    return { helper: 'goto_url', delayMs: 500, details: {} };
  }
  if (call.method === 'Input.dispatchMouseEvent') {
    const type = String(params.type || '');
    if (type === 'mouseReleased') {
      return {
        helper: 'click_at_xy',
        delayMs: 180,
        details: { x: numeric(params.x), y: numeric(params.y), button: params.button || 'left' },
      };
    }
    if (type === 'mouseWheel') {
      return {
        helper: 'scroll',
        delayMs: 180,
        details: {
          x: numeric(params.x), y: numeric(params.y),
          dx: numeric(params.deltaX), dy: numeric(params.deltaY),
        },
      };
    }
    return undefined;
  }
  if (call.method === 'Input.dispatchTouchEvent' && objectParams(call.params).type === 'touchEnd') {
    return { helper: 'click_at_xy', delayMs: 180, details: {} };
  }
  if (call.method === 'Input.insertText') {
    return { helper: 'type_text', delayMs: 90, details: { text: String(params.text ?? '').slice(0, TEXT_LIMIT) } };
  }
  if (call.method === 'Input.dispatchKeyEvent' && params.type === 'keyUp') {
    return { helper: 'press_key', delayMs: 180, details: { key: namedKey(params.key || params.code) } };
  }
  if (call.method === 'DOM.setFileInputFiles') {
    const files = Array.isArray(params.files) ? params.files : [];
    return { helper: 'upload_file', delayMs: 250, details: { fileCount: files.length } };
  }
  return undefined;
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

async function createRecording(name: string, title: string | undefined, automatic: boolean): Promise<string> {
  const root = recordingsRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  let candidate = safeName(name);
  let directory = join(root, candidate);
  let suffix = 2;
  while (existsSync(directory)) {
    candidate = `${safeName(name)}-${suffix++}`;
    directory = join(root, candidate);
  }
  await mkdir(directory, { mode: 0o700 });
  const meta: RecordingMeta = {
    name: basename(directory),
    title: title?.trim() || null,
    started: Math.round(Date.now()) / 1000,
    ...(automatic ? { auto: true } : {}),
  };
  await writePrivateJson(join(directory, 'meta.json'), meta);
  await writeFile(markerPath(), directory, { mode: 0o600 });
  return directory;
}

async function autoRecordingStale(directory: string): Promise<boolean> {
  if (!await isAutomatic(directory)) return false;
  try {
    const evidence = await stat(join(directory, 'events.jsonl'));
    return Date.now() - evidence.mtimeMs > idleSeconds() * 1000;
  } catch {
    return false;
  }
}

export class RecordingManager {
  private queue: Promise<void> = Promise.resolve();
  private frameNumbers = new Map<string, number>();
  private lastFrames = new Map<string, string>();
  private startInFlight = false;
  private session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  observe = async (call: CdpCallObservation): Promise<void> => {
    const action = classify(call);
    if (!action || !call.sessionId) return;
    const operation = this.queue.then(() => this.observeAction(call, action), () => this.observeAction(call, action)).catch(() => {});
    this.queue = operation;
    if (!await this.waitForQueue(operation) && this.queue === operation) {
      // A wedged screenshot must not impose the timeout on every later action.
      // The old best-effort operation may still finish independently.
      this.queue = Promise.resolve();
    }
  };

  async start(name?: string, title?: string): Promise<string> {
    if (envOverride() === false) throw new Error('recording disabled by CDP_RECORD=0');
    if (this.startInFlight) throw new Error('another recording start is already in progress');
    this.startInFlight = true;
    try {
      await this.flushQueue();
      const active = await activeRecording();
      if (active) throw new Error(`recording already active: ${active}`);
      const directory = await createRecording(safeName(name), title, false);
      const sessionId = this.session.getActiveSession();
      if (sessionId) {
        this.queue = this.queue.then(() => this.capture(directory, sessionId, 'start_recording', {}, 0)).catch(() => {});
        await this.flushQueue();
      }
      return directory;
    } finally {
      this.startInFlight = false;
    }
  }

  async stop(): Promise<string | undefined> {
    await this.flushQueue();
    const directory = await activeRecording();
    if (!directory) return undefined;
    const sessionId = this.session.getActiveSession();
    if (sessionId) {
      this.queue = this.queue.then(() => this.capture(directory, sessionId, 'stop_recording', {}, 0)).catch(() => {});
      await this.flushQueue();
    }
    await unlink(markerPath()).catch(() => {});
    return directory;
  }

  async status(): Promise<{ enabled: boolean; source: string; active?: string; latest?: string }> {
    const setting = await autoRecordingSetting();
    return {
      ...setting,
      active: await activeRecording(),
      latest: await latestRecording(),
    };
  }

  private async flushQueue(): Promise<void> {
    const queued = this.queue;
    if (!await this.waitForQueue(queued) && this.queue === queued) this.queue = Promise.resolve();
  }

  private async waitForQueue(queue: Promise<void>, timeoutMs = 4_500): Promise<boolean> {
    return new Promise(resolveWait => {
      const timer = setTimeout(() => resolveWait(false), timeoutMs);
      queue.then(
        () => { clearTimeout(timer); resolveWait(true); },
        () => { clearTimeout(timer); resolveWait(true); },
      );
    });
  }

  private async observeAction(call: CdpCallObservation, action: SemanticAction): Promise<void> {
    if (envOverride() === false) return;
    let directory = await activeRecording();
    const setting = await autoRecordingSetting();
    if (directory && await isAutomatic(directory) && !setting.enabled) {
      await unlink(markerPath()).catch(() => {});
      directory = undefined;
    }
    if (directory && await autoRecordingStale(directory)) {
      await unlink(markerPath()).catch(() => {});
      directory = undefined;
    }
    if (!directory) {
      if (!setting.enabled) return;
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
      directory = await createRecording(`session-${stamp}`, undefined, true);
    }
    await this.capture(directory, call.sessionId!, action.helper, {
      ...action.details,
      method: call.method,
      durationMs: Math.round(call.durationMs),
    }, action.delayMs);
  }

  private async nextFrameNumber(directory: string): Promise<number> {
    const cached = this.frameNumbers.get(directory);
    if (cached != null) {
      this.frameNumbers.set(directory, cached + 1);
      return cached;
    }
    const names = await readdir(directory);
    const maximum = names.reduce((current, name) => {
      const match = /^(\d+)\.jpg$/.exec(name);
      return match ? Math.max(current, Number(match[1])) : current;
    }, 0);
    this.frameNumbers.set(directory, maximum + 2);
    return maximum + 1;
  }

  private async capture(
    directory: string,
    sessionId: string,
    helper: string,
    details: JsonObject,
    delayMs: number,
  ): Promise<void> {
    if (delayMs) await new Promise(resolveDelay => setTimeout(resolveDelay, delayMs));
    const privateText = helper === 'type_text' && typeof details.text === 'string' ? details.text : undefined;
    const publicDetails = { ...details };
    if (helper === 'type_text') delete publicDetails.text;
    const event: JsonObject = {
      ts: Math.round(Date.now()) / 1000,
      helper,
      sessionId,
      ...publicDetails,
    };
    let context: PageContext = {};
    try {
      const response = await this.session._call('Runtime.evaluate', {
        expression: CONTEXT_EXPRESSION,
        returnByValue: true,
      }, { sessionId }) as { result?: { value?: PageContext } };
      context = response.result?.value ?? {};
      Object.assign(event, context);
    } catch { /* The target may be navigating or closing. */ }

    if (typeof event.url === 'string') event.url = scrubUrl(event.url);
    if (typeof event.to === 'string') event.to = scrubUrl(event.to);
    if (privateText !== undefined) {
      if (context.input && context.input !== 'password') {
        event.text = privateText;
      } else {
        // Fail closed when focused-element inspection is unavailable: never let
        // plaintext reach disk unless the field was positively non-password.
        event.text = '••••••';
        event.textRedacted = true;
        if (context.input === 'password') event.password = true;
      }
    }

    try {
      const shot = await this.session._call('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 80,
        captureBeyondViewport: false,
      }, { sessionId }) as { data?: string };
      if (shot.data) {
        const number = await this.nextFrameNumber(directory);
        const frame = `${String(number).padStart(4, '0')}.jpg`;
        const file = await open(join(directory, frame), 'wx', 0o600);
        try { await file.writeFile(Buffer.from(shot.data, 'base64')); } finally { await file.close(); }
        const key = `${directory}:${sessionId}`;
        const before = this.lastFrames.get(key);
        if (before) event.beforeFrame = before;
        event.frame = frame;
        this.lastFrames.set(key, frame);
      }
    } catch { /* Keep action metadata even when a screenshot is unavailable. */ }

    await appendFile(join(directory, 'events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
  }
}

async function runRecordingsCli(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--latest') {
    const latest = await latestRecording();
    if (!latest) {
      console.error('no recordings found');
      return 1;
    }
    console.log(latest);
    return 0;
  }
  if (args.length === 1 && (args[0] === 'enable' || args[0] === 'disable')) {
    const enabled = args[0] === 'enable';
    await setAutoRecording(enabled);
    console.log(`auto-recording preference ${enabled ? 'enabled' : 'disabled'}`);
    return 0;
  }
  if (args.length) {
    console.error('usage: browser-harness-js recordings [--latest|enable|disable]');
    return 2;
  }
  const setting = await autoRecordingSetting();
  const active = await activeRecording();
  const latest = await latestRecording();
  console.log(`auto-recording: ${setting.enabled ? 'on' : 'off'} (${setting.source})`);
  console.log(`active: ${active || 'none'}`);
  console.log(`latest: ${latest || 'none'}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRecordingsCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
