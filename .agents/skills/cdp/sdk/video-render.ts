/** Review, export, and verify deterministic browser-action videos. */

import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Session } from './session.ts';
import {
  HOUSE_STYLE,
  SOURCE_MANIFEST,
  TEMPLATE,
  compileBrief,
  fileHash,
  loadComposition,
  loadJson,
  loadRevealedText,
  usedFrames,
  verifySourceManifest,
  writeComposition,
} from './video.ts';

type Json = Record<string, any>;
type Capture = { path: string; time: number; label: string };
type BrowserPage = { session: Session; targetId: string; sessionId: string; browserContextId: string };

const REVIEW_ARTIFACTS = new Set([
  'composition.js',
  'recording-summary.json',
  'edit-brief.json',
  SOURCE_MANIFEST,
  'video.html',
]);

function compileRecording(recording: string, write: boolean): Json {
  verifySourceManifest(recording);
  const summary = loadJson(join(recording, 'recording-summary.json'));
  const brief = loadJson(join(recording, 'edit-brief.json'));
  const composition = compileBrief(
    summary,
    brief,
    HOUSE_STYLE,
    loadRevealedText(join(recording, 'events.jsonl')),
  );
  if (write) writeComposition(join(recording, 'composition.js'), composition);
  return composition;
}

function reviewSamples(composition: Json): Array<{ time: number; label: string }> {
  const samples: Array<{ time: number; label: string }> = [];
  let start = 0;
  (composition.beats || []).forEach((beat: Json, index: number) => {
    const duration = Number(beat.dur || 0);
    if (beat.kind === 'explanation' && Array.isArray(beat.points) && beat.points.length) {
      const first = 1.1;
      const finalHold = 3;
      const span = Math.max(0, duration - first - finalHold);
      const gap = span / Math.max(1, beat.points.length - 1);
      beat.points.forEach((point: Json, pointIndex: number) => {
        const local = Math.min(Math.max(0.05, duration - 0.05), first + pointIndex * gap + 0.2);
        samples.push({ time: round(start + local), label: `beat ${index + 1} · ${point.label || pointIndex + 1}` });
      });
    } else {
      const local = Math.min(Math.max(0.05, duration - 0.05), beat.card ? 1 : Math.max(0.12, Math.min(0.5, duration / 2)));
      samples.push({ time: round(start + local), label: `beat ${index + 1}` });
    }
    start += duration;
  });
  return samples;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mimeType(path: string): string {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
  } as Record<string, string>)[extname(path).toLowerCase()] || 'application/octet-stream';
}

function isServableRecordingFile(path: string): boolean {
  return [
    'video.html', 'composition.js', 'privacy-frame.html',
    'video-review-contact-sheet.html', 'renderer-final-contact-sheet.html',
  ].includes(path)
    || /^\d+\.jpg$/.test(path)
    || /^\.privacy-review[/\\]\d+\.jpg$/.test(path)
    || /^\.renderer-review[/\\][a-z0-9-]+\.(?:png|jpg)$/.test(path);
}

async function serveDirectory<T>(root: string, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const absoluteRoot = realpathSync(resolve(root));
  const token = randomBytes(24).toString('hex');
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const prefix = `/${token}/`;
      if (!url.pathname.startsWith(prefix)) {
        response.writeHead(404).end('not found');
        return;
      }
      const decoded = decodeURIComponent(url.pathname.slice(prefix.length));
      if (!isServableRecordingFile(decoded)) {
        response.writeHead(404).end('not found');
        return;
      }
      const path = resolve(absoluteRoot, decoded);
      const child = relative(absoluteRoot, path);
      if (child.startsWith('..') || isAbsolute(child) || !existsSync(path)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || !realpathSync(path).startsWith(absoluteRoot + sep)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      response.writeHead(200, {
        'content-type': mimeType(path),
        'cache-control': 'no-store',
        'cross-origin-resource-policy': 'same-origin',
      });
      response.end(readFileSync(path));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  const port = await listen(server);
  try { return await fn(`http://127.0.0.1:${port}/${token}`); }
  finally { await closeServer(server); }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('review server did not bind a TCP port'));
      else resolveListen(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolveClose => server.close(() => resolveClose()));
}

async function openPage(session: Session, url: string): Promise<BrowserPage> {
  if (!session.isConnected()) await session.connect();
  let browserContextId: string | undefined;
  let targetId: string | undefined;
  try {
    browserContextId = (await bounded(session.domains.Target.createBrowserContext(), 'create browser context')).browserContextId;
    targetId = (await bounded(session.domains.Target.createTarget({ url: 'about:blank', browserContextId }), 'create renderer target')).targetId;
    const attached = await bounded(session.domains.Target.attachToTarget({ targetId, flatten: true }), 'attach renderer target');
    const page = { session, targetId, sessionId: attached.sessionId, browserContextId };
    await call(page, 'Page.enable', {});
    await call(page, 'Runtime.enable', {});
    await setMetrics(page, 1920, 1080);
    await navigate(page, url);
    return page;
  } catch (error) {
    if (targetId) await bounded(session.domains.Target.closeTarget({ targetId }), 'close partial target', 5_000).catch(() => {});
    if (browserContextId) {
      await bounded(session.domains.Target.disposeBrowserContext({ browserContextId }), 'dispose partial context', 5_000).catch(() => {});
    }
    throw error;
  }
}

async function closePage(page: BrowserPage): Promise<void> {
  await bounded(page.session.closeTab(page.targetId, page.sessionId), 'close renderer target', 5_000).catch(() => {});
  await bounded(
    page.session.domains.Target.disposeBrowserContext({ browserContextId: page.browserContextId }),
    'dispose renderer context',
    5_000,
  ).catch(() => {});
}

async function call(page: BrowserPage, method: string, params: Json = {}): Promise<any> {
  return bounded(page.session._call(method, params, { sessionId: page.sessionId }), method);
}

async function evaluate<T = any>(page: BrowserPage, expression: string, awaitPromise = false): Promise<T> {
  const response = await call(page, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'renderer evaluation failed');
  }
  return response.result?.value as T;
}

async function setMetrics(page: BrowserPage, width: number, height: number): Promise<void> {
  await call(page, 'Emulation.setDeviceMetricsOverride', {
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function navigate(page: BrowserPage, url: string): Promise<void> {
  await call(page, 'Page.navigate', { url });
}

async function waitForValue<T>(page: BrowserPage, expression: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate<T | null>(page, expression);
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(50);
  }
  throw new Error(`renderer did not become ready: ${String(lastError || expression)}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function bounded<T>(operation: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolveOperation, rejectOperation) => {
    const timer = setTimeout(() => rejectOperation(new Error(`timed out during ${label}`)), timeoutMs);
    operation.then(
      value => { clearTimeout(timer); resolveOperation(value); },
      error => { clearTimeout(timer); rejectOperation(error); },
    );
  });
}

async function capture(page: BrowserPage, output: string, format: 'png' | 'jpeg' = 'png', quality?: number, clip?: Json): Promise<void> {
  const response = await call(page, 'Page.captureScreenshot', {
    format,
    ...(quality == null ? {} : { quality }),
    captureBeyondViewport: true,
    ...(clip ? { clip } : {}),
  });
  writeFileSync(output, Buffer.from(response.data, 'base64'));
}

async function waitForRenderer(page: BrowserPage): Promise<void> {
  await waitForValue(page, 'window.videoReady && window.videoReady()');
}

async function inspectMode(
  page: BrowserPage,
  name: string,
  reduced: boolean,
  samples: Array<{ time: number; label: string }>,
  reviewDirectory: string,
): Promise<Json> {
  await call(page, 'Emulation.setEmulatedMedia', {
    media: '',
    features: reduced ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [],
  });
  await call(page, 'Page.reload', { ignoreCache: true });
  await waitForRenderer(page);
  const preflight = await evaluate<Json>(page, 'window.videoPreflight()');
  const clicks = await evaluate<Json[]>(page, 'window.clickVisibility()');
  const captures: Capture[] = [];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    await evaluate(page, `window.seek(${JSON.stringify(sample.time)})`);
    const path = join(reviewDirectory, `${name}-beat-${String(index + 1).padStart(2, '0')}.png`);
    await capture(page, path);
    captures.push({ path, time: sample.time, label: sample.label });
  }
  const clickCaptures: Capture[] = [];
  for (let index = 0; index < clicks.length; index++) {
    const click = clicks[index]!;
    for (const [state, key] of [['click', 'time'], ['result', 'resultTime']] as const) {
      await evaluate(page, `window.seek(${JSON.stringify(click[key])})`);
      const path = join(reviewDirectory, `${name}-click-${String(index + 1).padStart(2, '0')}-${state}.png`);
      await capture(page, path);
      clickCaptures.push({ path, time: Number(click[key]), label: `beat ${click.beat} · ${state}` });
    }
  }
  return { preflight, clicks, captures, clickCaptures };
}

function privacyPageHtml(): string {
  return `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;background:#111;overflow:hidden}canvas{display:block}</style>
<canvas id="frame"></canvas>
<script src="composition.js"></script>
<script>
'use strict';
window.frameReady = null;
const name = new URLSearchParams(location.search).get('frame') || '';
if (!/^\\d+\\.jpg$/.test(name)) throw new Error('invalid frame');
const image = new Image();
image.onload = () => {
  const canvas = document.getElementById('frame');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
  const viewport = window.COMPOSITION.viewport;
  const sx = image.naturalWidth / viewport.w, sy = image.naturalHeight / viewport.h;
  const privacy = window.COMPOSITION.privacy || {}, mask = privacy.mask || {};
  for (const rectangle of (window.COMPOSITION.redact || {})[name] || []) {
    const pad = Number(rectangle.pad ?? privacy.pad ?? 8);
    const x = Math.max(0, (rectangle.x - pad) * sx), y = Math.max(0, (rectangle.y - pad) * sy);
    const w = Math.min(image.naturalWidth - x, (rectangle.w + pad * 2) * sx);
    const h = Math.min(image.naturalHeight - y, (rectangle.h + pad * 2) * sy);
    const radius = Number(rectangle.radius ?? mask.radius ?? 7) * Math.min(sx, sy);
    context.beginPath(); context.roundRect(x, y, w, h, radius);
    context.fillStyle = rectangle.fill || mask.fill || '#f2f4f7'; context.fill();
    const stroke = rectangle.stroke ?? mask.stroke;
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = Math.max(1, Math.min(sx, sy)); context.stroke(); }
  }
  window.frameReady = { width: image.naturalWidth, height: image.naturalHeight };
};
image.src = name;
</script>`;
}

async function privacyReview(page: BrowserPage, recording: string, composition: Json, baseUrl: string): Promise<Capture[]> {
  const directory = join(recording, '.privacy-review');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(recording, 'privacy-frame.html'), privacyPageHtml());
  const captures: Capture[] = [];
  for (const frame of usedFrames(composition)) {
    await navigate(page, `${baseUrl}/privacy-frame.html?frame=${encodeURIComponent(frame)}`);
    const dimensions = await waitForValue<{ width: number; height: number }>(page, 'window.frameReady');
    await setMetrics(page, dimensions.width, dimensions.height);
    const output = join(directory, frame);
    await capture(page, output, 'jpeg', 94, { x: 0, y: 0, width: dimensions.width, height: dimensions.height, scale: 1 });
    captures.push({
      path: output,
      time: 0,
      label: `privacy · ${frame} · masks:${(composition.redact?.[frame] || []).length}`,
    });
  }
  return captures;
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[character]!);
}

function relativeUrl(root: string, path: string): string {
  return relative(root, path).split(sep).map(encodeURIComponent).join('/');
}

function contactSheetHtml(recording: string, captures: Capture[], title: string): string {
  const tiles = captures.map(item => `<figure><img src="${relativeUrl(recording, item.path)}"><figcaption>${escapeHtml(item.label)} <span>${item.time.toFixed(2)}s</span></figcaption></figure>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;padding:18px;background:#171a20;color:#fff;font:14px system-ui,sans-serif}h1{font-size:18px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(4,400px);gap:10px}figure{width:400px;margin:0;background:#0f1116;padding:0 0 10px}img{display:block;width:400px;height:225px;object-fit:contain;background:#090b0f}figcaption{padding:9px 10px 0;color:#d7dbe3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}span{color:#8d96a8}</style><h1>${escapeHtml(title)}</h1><div class="grid">${tiles}</div>`;
}

async function makeContactSheet(page: BrowserPage, recording: string, captures: Capture[], output: string, title: string, baseUrl: string): Promise<void> {
  const html = output.endsWith('final-contact-sheet.jpg') ? 'renderer-final-contact-sheet.html' : 'video-review-contact-sheet.html';
  writeFileSync(join(recording, html), contactSheetHtml(recording, captures, title));
  await setMetrics(page, 1660, 900);
  await navigate(page, `${baseUrl}/${html}`);
  await waitForValue(page, '[...document.images].every(image => image.complete && image.naturalWidth)');
  const size = await evaluate<{ width: number; height: number }>(page, '({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})');
  await capture(page, output, 'jpeg', 91, { x: 0, y: 0, width: size.width, height: size.height, scale: 1 });
}

function artifactHashes(recording: string): Json {
  return Object.fromEntries([...REVIEW_ARTIFACTS].sort().map(name => [name, fileHash(join(recording, name))]));
}

function reviewArtifactHashes(recording: string, paths: string[]): Json {
  return Object.fromEntries(paths.sort().map(path => [relative(recording, path), fileHash(path)]));
}

export async function review(recordingPath: string): Promise<number> {
  const recording = resolve(recordingPath);
  const started = performance.now();
  const composition = compileRecording(recording, true);
  copyFileSync(TEMPLATE, join(recording, 'video.html'));
  const samples = reviewSamples(composition);
  const reviewDirectory = join(recording, '.renderer-review');
  rmSync(reviewDirectory, { recursive: true, force: true });
  mkdirSync(reviewDirectory, { recursive: true });

  const session = new Session();
  let page: BrowserPage | undefined;
  let normal: Json = {};
  let reduced: Json = {};
  let privacyCaptures: Capture[] = [];
  let sheet = '';
  try {
    await session.connect();
    await serveDirectory(recording, async baseUrl => {
      page = await openPage(session, `${baseUrl}/video.html`);
      normal = await inspectMode(page, 'normal', false, samples, reviewDirectory);
      reduced = await inspectMode(page, 'reduced', true, samples, reviewDirectory);
      await call(page, 'Emulation.setEmulatedMedia', { media: '', features: [] });
      privacyCaptures = await privacyReview(page, recording, composition, baseUrl);
      const allCaptures: Capture[] = [...privacyCaptures];
      for (const [name, result] of [['normal', normal], ['reduced', reduced]] as const) {
        allCaptures.push(...result.captures.map((captureItem: Capture) => ({ ...captureItem, label: `${name} · ${captureItem.label}` })));
        allCaptures.push(...result.clickCaptures.map((captureItem: Capture) => ({ ...captureItem, label: `${name} · ${captureItem.label}` })));
      }
      sheet = join(recording, 'video-review-contact-sheet.jpg');
      await makeContactSheet(page, recording, allCaptures, sheet, 'PRIVACY · EVERY BEAT · EXACT CLICK + RESULT', baseUrl);
    });
  } finally {
    if (page) await closePage(page);
    session.close();
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [name, result] of [['normal', normal!], ['reduced', reduced!]] as const) {
    errors.push(...(result.preflight.errors || []).map((error: unknown) => `${name}: ${String(error)}`));
    warnings.push(...(result.preflight.warnings || []).map((warning: unknown) => `${name}: ${String(warning)}`));
    errors.push(...result.clicks.filter((click: Json) => !click.visible).map((click: Json) => `${name}: beat ${click.beat} click is outside the safe viewport`));
  }
  const reviewPaths = [
    sheet!,
    ...privacyCaptures!.map(item => item.path),
    ...normal!.captures.map((item: Capture) => item.path),
    ...normal!.clickCaptures.map((item: Capture) => item.path),
    ...reduced!.captures.map((item: Capture) => item.path),
    ...reduced!.clickCaptures.map((item: Capture) => item.path),
  ];
  const report = {
    errors,
    warnings,
    duration: round((composition.beats || []).reduce((sum: number, beat: Json) => sum + Number(beat.dur || 0), 0)),
    artifactHashes: artifactHashes(recording),
    reviewArtifactHashes: reviewArtifactHashes(recording, reviewPaths),
    normal,
    reduced,
    contactSheet: sheet!,
    privacyReviewDir: join(recording, '.privacy-review'),
    elapsedSeconds: round((performance.now() - started) / 1000),
  };
  const reportPath = join(recording, 'renderer-review.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(recording, 'renderer-review.sha256'), fileHash(reportPath) + '\n');
  console.log(`review sheet: ${sheet!}`);
  console.log(`full-resolution privacy review: ${report.privacyReviewDir}`);
  console.log(`renderer review: ${errors.length} error(s), ${warnings.length} warning(s) in ${report.elapsedSeconds.toFixed(1)}s`);
  return errors.length ? 1 : 0;
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function run(command: string, args: string[], cwd: string, timeout = 120_000): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 10 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error((result.stderr || result.stdout || result.error?.message || `${command} failed`).trim());
  }
  return result.stdout;
}

function probe(path: string): Json {
  return JSON.parse(run('ffprobe', [
    '-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_name,width,height,pix_fmt,r_frame_rate',
    '-of', 'json', path,
  ], dirname(path)));
}

function verifyReviewArtifacts(recording: string, report: Json): void {
  const hashes = report.reviewArtifactHashes;
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) {
    throw new Error('renderer review lacks review artifact hashes; rerun it');
  }
  for (const [name, expected] of Object.entries(hashes)) {
    const path = resolve(recording, name);
    const child = relative(recording, path);
    if (child.startsWith('..') || isAbsolute(child)) throw new Error(`review artifact escapes recording: ${name}`);
    if (typeof expected !== 'string' || !existsSync(path) || fileHash(path) !== expected) {
      throw new Error(`review artifact changed after review: ${name}`);
    }
  }
}

async function exportWebm(page: BrowserPage, baseUrl: string, webm: string, expected: number): Promise<void> {
  const download = join(dirname(webm), `browser-harness-js-${randomUUID()}.webm`);
  const partial = download + '.crdownload';
  await call(page, 'Browser.setDownloadBehavior', {
    behavior: 'allow',
    browserContextId: page.browserContextId,
    downloadPath: dirname(webm),
    eventsEnabled: true,
  });
  try {
    await call(page, 'Target.activateTarget', { targetId: page.targetId });
    await setMetrics(page, 1920, 1080);
    await navigate(page, `${baseUrl}/video.html`);
    await waitForRenderer(page);
    const preflight = await evaluate<Json>(page, 'window.videoPreflight()');
    if (preflight.errors?.length) throw new Error('export preflight failed: ' + preflight.errors.join('; '));
    const clicks = await evaluate<Json[]>(page, 'window.clickVisibility()');
    if (clicks.some(click => !click.visible)) throw new Error('export click visibility failed');
    const filename = basename(download);
    await evaluate(page, `(() => { window.__exported = null; window.__exportError = null; window.exportVideo(${JSON.stringify(filename)}).catch(error => window.__exportError = String(error)); return true; })()`);
    const deadline = Date.now() + expected * 1000 + 30_000;
    while (Date.now() < deadline) {
      const browserError = await evaluate<string | null>(page, 'window.__exportError || null').catch(() => null);
      if (browserError) throw new Error(browserError);
      if (existsSync(download) && !existsSync(partial) && statSync(download).size) {
        const size = statSync(download).size;
        await delay(300);
        if (statSync(download).size === size) {
          renameSync(download, webm);
          return;
        }
      }
      await delay(250);
    }
    throw new Error(`timed out waiting for ${download}`);
  } finally {
    rmSync(download, { force: true });
    rmSync(partial, { force: true });
    try {
      await call(page, 'Browser.setDownloadBehavior', {
        behavior: 'default',
        browserContextId: page.browserContextId,
        eventsEnabled: false,
      });
    } catch {
      throw new Error('could not restore Chrome download behavior; restart Chrome');
    }
  }
}

export async function exportVideo(recordingPath: string, outputName: string, reviewed: boolean): Promise<number> {
  const recording = resolve(recordingPath);
  if (!reviewed) throw new Error('inspect the review sheet and full-resolution privacy frames, then rerun with --reviewed');
  if (!commandExists('ffmpeg') || !commandExists('ffprobe')) throw new Error('ffmpeg and ffprobe are required');
  const reviewPath = join(recording, 'renderer-review.json');
  if (!existsSync(reviewPath)) throw new Error('run browser-harness-js video review first');
  const sealPath = join(recording, 'renderer-review.sha256');
  if (!existsSync(sealPath) || readFileSync(sealPath, 'utf8').trim() !== fileHash(reviewPath)) {
    throw new Error('renderer-review.json changed after review; rerun it');
  }
  const report = loadJson(reviewPath);
  if (report.errors?.length) throw new Error('renderer review has blocking errors');
  verifySourceManifest(recording);
  const composition = loadComposition(join(recording, 'composition.js'));
  const expectedComposition = compileRecording(recording, false);
  if (JSON.stringify(composition) !== JSON.stringify(expectedComposition)) {
    throw new Error('composition.js is not the current compiled brief; rerun review');
  }
  const hashes = report.artifactHashes;
  if (!hashes || JSON.stringify(Object.keys(hashes).sort()) !== JSON.stringify([...REVIEW_ARTIFACTS].sort())) {
    throw new Error('renderer review lacks content hashes; rerun it');
  }
  for (const [name, expectedHash] of Object.entries(hashes)) {
    const path = join(recording, name);
    if (!existsSync(path) || fileHash(path) !== expectedHash) throw new Error(`${name} changed after review; rerun it`);
  }
  if (fileHash(join(recording, 'video.html')) !== fileHash(TEMPLATE)) throw new Error('renderer is not the current shared template; rerun review');
  verifyReviewArtifacts(recording, report);

  const output = isAbsolute(outputName) ? resolve(outputName) : resolve(recording, outputName);
  if (extname(output).toLowerCase() !== '.mp4') throw new Error('--output must end in .mp4');
  const webm = output.slice(0, -4) + '.webm';
  for (const path of [webm, output]) {
    if (existsSync(path) || existsSync(path + '.crdownload')) throw new Error(`refusing to overwrite ${path}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  const expected = (composition.beats || []).reduce((sum: number, beat: Json) => sum + Number(beat.dur || 0), 0);
  const started = performance.now();
  let captureSeconds = 0;
  let conversionSeconds = 0;
  let verificationSeconds = 0;
  let finalSheet = '';

  const session = new Session();
  let page: BrowserPage | undefined;
  let completed = false;
  try {
    await session.connect();
    await serveDirectory(recording, async baseUrl => {
      page = await openPage(session, `${baseUrl}/video.html`);
      const captureStarted = performance.now();
      await exportWebm(page, baseUrl, webm, expected);
      captureSeconds = (performance.now() - captureStarted) / 1000;

      const conversionStarted = performance.now();
      probe(webm);
      run('ffmpeg', ['-v', 'error', '-i', webm, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], recording, Math.max(120_000, expected * 10_000));
      conversionSeconds = (performance.now() - conversionStarted) / 1000;

      const verificationStarted = performance.now();
      const outputProbe = probe(output);
      const videoStreams = (outputProbe.streams || []).filter((stream: Json) => stream.codec_name);
      const stream = videoStreams[0];
      if (videoStreams.length !== 1 || stream?.codec_name !== 'h264' || stream?.width !== 1920
        || stream?.height !== 1080 || stream?.pix_fmt !== 'yuv420p') {
        throw new Error('export must contain one 1920x1080 H.264 yuv420p video stream');
      }
      const actual = Number(outputProbe.format.duration);
      if (Math.abs(actual - expected) > Math.max(1, expected * 0.08)) {
        throw new Error(`export duration ${actual.toFixed(2)}s does not match composition ${expected.toFixed(2)}s`);
      }
      run('ffmpeg', ['-v', 'error', '-err_detect', 'explode', '-i', output, '-f', 'null', '-'], recording, Math.max(120_000, expected * 5000));
      const captures: Capture[] = [];
      const times = [Math.min(1, expected / 4), expected / 2, Math.max(0, expected - 0.8)];
      const labels = ['intro', 'middle', 'outcome'];
      for (let index = 0; index < times.length; index++) {
        const path = join(recording, '.renderer-review', `final-${String(index + 1).padStart(2, '0')}.jpg`);
        run('ffmpeg', ['-v', 'error', '-y', '-ss', times[index]!.toFixed(3), '-i', output, '-frames:v', '1', path], recording);
        captures.push({ path, time: times[index]!, label: labels[index]! });
      }
      finalSheet = join(recording, 'renderer-final-contact-sheet.jpg');
      await makeContactSheet(page, recording, captures, finalSheet, 'FINAL MP4 SAMPLE', baseUrl);
      verificationSeconds = (performance.now() - verificationStarted) / 1000;

      const exportReport = {
        output,
        webm,
        expectedDuration: round(expected),
        actualDuration: actual,
        captureSeconds: round(captureSeconds),
        conversionSeconds: round(conversionSeconds),
        verificationSeconds: round(verificationSeconds),
        elapsedSeconds: round((performance.now() - started) / 1000),
        sha256: fileHash(output),
        probe: outputProbe,
        finalContactSheet: finalSheet,
      };
      writeFileSync(join(recording, 'video-export.json'), JSON.stringify(exportReport, null, 2) + '\n');
    });
    completed = true;
  } finally {
    if (page) await closePage(page);
    session.close();
    if (!completed) {
      rmSync(webm, { force: true });
      rmSync(webm + '.crdownload', { force: true });
      rmSync(output, { force: true });
    }
  }
  const exportReport = loadJson(join(recording, 'video-export.json'));
  console.log(`video: ${output}`);
  console.log(`final review: ${finalSheet}`);
  console.log(`verified ${Number(exportReport.actualDuration).toFixed(2)}s MP4 in ${Number(exportReport.elapsedSeconds).toFixed(1)}s`);
  return 0;
}
