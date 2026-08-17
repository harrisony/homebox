/** Compile privacy-reviewed action recordings into deterministic video compositions. */

import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activeRecording, recordingHome } from './recording.ts';

type Json = Record<string, any>;

export const SOURCE_MANIFEST = 'video-source.json';
export const COMPOSITION_PREFIX = 'window.COMPOSITION =';
export const TEMPLATE = fileURLToPath(new URL('./video-template.html', import.meta.url));
export const HOUSE_STYLE: Json = {
  version: 1,
  frameStyle: 'native',
  readingWpm: 380,
  background: ['#efece4', '#dce7e7'],
  cursorStart: { x: 700, y: 280 },
  pacing: {
    captionBaseSeconds: 0.35,
    captionSecondsPerWord: 0.2,
    rawToCardHoldSeconds: 0.55,
    baseDurationBudget: 22,
    extraActionSeconds: 1.25,
    extraExplanationSeconds: 3,
    maximumDurationBudget: 32,
  },
  motion: {
    autoFollow: true,
    autoZoom: 1.7,
    cursorDuration: 0.48,
    zoomDuration: 0.42,
    panDuration: 0.55,
    wideScale: 0.78,
    reactionLag: 0.025,
    reactionFade: 0.04,
  },
  privacy: { pad: 10, mask: { fill: '#ffffff', stroke: false, radius: 0 } },
};

const SENSITIVE = /@|onmicrosoft\.com|(?:tenant|user|object)[_-]?id|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const ROUTE_UNSAFE = /@|[?#]|:\/\/|onmicrosoft|(?:tenant|user|object)[_-]?id|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;
const ACTION_KEYS = new Set(['event', 'frameEvent', 'afterEvent', 'chapter', 'route', 'afterRoute', 'narration', 'label', 'detour', 'error', 'context', 'showTyping']);
const BRIEF_KEYS = new Set(['task', 'summary', 'plan', 'actions', 'explanations', 'outcomeTitle', 'outcomeSummary', 'outcomes', 'privacy']);
const PRIVACY_KEYS = new Set(['reviewedFrames', 'redact']);
const EXPLANATION_KEYS = new Set(['afterAction', 'title', 'summary', 'observed', 'mistake', 'correction']);
const REDACTION_KEYS = new Set(['x', 'y', 'w', 'h', 'fill', 'stroke', 'radius', 'pad']);
const TYPE_HELPERS = new Set(['type_text', 'fill', 'fill_input']);
const CLICK_HELPERS = new Set(['click_at_xy']);
const VIEWPORT_TOLERANCE = 2;

export class BriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefError';
  }
}

export function loadJson(path: string): Json {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new BriefError(`cannot read ${path}: ${String(error)}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BriefError(`${path} must contain a JSON object`);
  }
  return value as Json;
}

export function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function loadComposition(path: string): Json {
  let text: string;
  try { text = readFileSync(path, 'utf8').trim(); }
  catch (error) { throw new BriefError(`cannot read ${path}: ${String(error)}`); }
  if (!text.startsWith(COMPOSITION_PREFIX) || !text.endsWith(';')) {
    throw new BriefError(`${path} is not a generated composition`);
  }
  let value: unknown;
  try { value = JSON.parse(text.slice(COMPOSITION_PREFIX.length, -1).trim()); }
  catch (error) { throw new BriefError(`cannot read ${path}: ${String(error)}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BriefError(`${path} must set a JSON object`);
  }
  return value as Json;
}

export function usedFrames(composition: Json): string[] {
  const frames: string[] = [];
  for (const beat of composition.beats || []) {
    for (const key of ['frame', 'after']) {
      const frame = beat[key];
      if (frame && !frames.includes(String(frame))) frames.push(String(frame));
    }
  }
  return frames;
}

function sourceFiles(recording: string): string[] {
  const required = ['events.jsonl', 'meta.json', 'recording-summary.json']
    .map(name => join(recording, name)).filter(existsSync);
  const frames = readdirSync(recording)
    .filter(name => /^\d+\.jpg$/.test(name)).sort().map(name => join(recording, name));
  return [...required, ...frames];
}

export function writeSourceManifest(recording: string): Json {
  const metaPath = join(recording, 'meta.json');
  const meta = existsSync(metaPath) ? loadJson(metaPath) : {};
  const files = Object.fromEntries(sourceFiles(recording).map(path => [basename(path), fileHash(path)]));
  const manifest = {
    recording: basename(recording),
    started: meta.started,
    explicit: existsSync(metaPath) && meta.auto !== true,
    files,
  };
  writeFileSync(join(recording, SOURCE_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function verifySourceManifest(recording: string): Json {
  const manifest = loadJson(join(recording, SOURCE_MANIFEST));
  if (manifest.recording !== basename(recording)) {
    throw new BriefError('recording directory does not match video-source.json');
  }
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new BriefError('video-source.json has no source hashes');
  }
  const paths = sourceFiles(recording);
  const names = paths.map(path => basename(path)).sort();
  const expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new BriefError('recording source files changed after initialization');
  }
  for (const path of paths) {
    if (manifest.files[basename(path)] !== fileHash(path)) {
      throw new BriefError(`recording source changed after initialization: ${basename(path)}`);
    }
  }
  return manifest;
}

function rejectUnknown(value: Json, allowed: Set<string>, where: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.has(key)).sort();
  if (unknown.length) throw new BriefError(`${where} has unsupported field(s): ${unknown.join(', ')}`);
}

function requireText(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BriefError(`${where} must be non-empty text`);
  return value.trim();
}

function optionalText(value: unknown, where: string): string | undefined {
  return value == null ? undefined : requireText(value, where);
}

function requireTextList(value: unknown, where: string, low: number, high: number): string[] {
  if (!Array.isArray(value) || value.length < low || value.length > high) {
    throw new BriefError(`${where} must contain ${low}–${high} items`);
  }
  return value.map((item, index) => requireText(item, `${where}[${index}]`));
}

function words(value: unknown): number {
  return String(value || '').match(/\S+/g)?.length ?? 0;
}

function cardDuration(title: string, summary: string | undefined, details: string[], kind: string, readingWpm: number): number {
  const text = [title, summary, ...details].filter(Boolean).join(' ');
  const base = kind === 'intro' || kind === 'outcome' ? 4.5 : 4;
  return round(Math.max(base, 0.4 + words(text) * 60 / readingWpm));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function validateNarration(value: unknown, where: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new BriefError(`${where} must be text`);
  if (words(value) > 7) throw new BriefError(`${where} exceeds seven words`);
  return value.trim();
}

function eventAt(events: Json[], number: unknown, where: string): Json {
  if (!Number.isInteger(number) || typeof number !== 'number') {
    throw new BriefError(`${where} must be a one-based integer`);
  }
  if (number < 1 || number > events.length) throw new BriefError(`${where} is outside recording-summary.json`);
  const event = events[number - 1];
  if (!event?.frame) throw new BriefError(`${where} has no captured frame`);
  return event;
}

function eventTarget(event: Json): { x: number; y: number } | undefined {
  const cursor = event.cursor;
  if (cursor && cursor.x != null && cursor.y != null) return { x: Number(cursor.x), y: Number(cursor.y) };
  const box = event.box;
  if (box && ['x', 'y', 'w', 'h'].every(key => box[key] != null)) {
    return { x: Number(box.x) + Number(box.w) * 0.3, y: Number(box.y) + Number(box.h) / 2 };
  }
  return undefined;
}

function requireMatchingViewport(event: Json, viewport: Json, where: string): void {
  const candidate = event.viewport || {};
  const dw = Math.abs(Number(candidate.w) - Number(viewport.w));
  const dh = Math.abs(Number(candidate.h) - Number(viewport.h));
  if (![dw, dh].every(Number.isFinite)) throw new BriefError(`${where} has no valid viewport`);
  if (dw > VIEWPORT_TOLERANCE || dh > VIEWPORT_TOLERANCE) {
    throw new BriefError(`${where} uses a different viewport; split or normalize the recording first`);
  }
}

function defaultActionDuration(beat: Json, pacing: Json): number {
  let base = 0.7;
  if (beat.click) base = 1.15;
  if (beat.after) base = Math.max(base, 1.4);
  if (beat.type) base = Math.max(base, 0.6 + String(beat.type.text || '').length * 0.035);
  if (beat.narration) {
    base = Math.max(base, Number(pacing.captionBaseSeconds) + Number(pacing.captionSecondsPerWord) * words(beat.narration));
  }
  return round(base);
}

function durationBudget(actionCount: number, explanationCount: number, rawToCardCount: number, pacing: Json): number {
  let budget = Number(pacing.baseDurationBudget);
  budget += Math.max(0, actionCount - 5) * Number(pacing.extraActionSeconds);
  budget += Math.max(0, explanationCount - 1) * Number(pacing.extraExplanationSeconds);
  budget += rawToCardCount * Number(pacing.rawToCardHoldSeconds);
  return round(Math.min(budget, Number(pacing.maximumDurationBudget)));
}

function addRawToCardHolds(beats: Json[], pacing: Json): number {
  const hold = Number(pacing.rawToCardHoldSeconds);
  let count = 0;
  for (let index = 0; index < beats.length - 1; index++) {
    const beat = beats[index];
    const next = beats[index + 1];
    if (!beat || !next || beat.card || !next.card) continue;
    beat.endStateHold = hold;
    beat.dur = round(Number(beat.dur) + hold);
    count++;
  }
  return count;
}

function validateNarrationCadence(beats: Json[]): void {
  const segments: Json[][] = [];
  let current: Json[] = [];
  for (const beat of beats) {
    if (beat.card) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(beat);
  }
  if (current.length) segments.push(current);
  for (const segment of segments) {
    const cues = segment.filter(beat => beat.narration);
    if (segment.length >= 3 && cues.length > Math.ceil(segment.length / 2)) {
      throw new BriefError('narration is sticky: set it only when the thought changes, then omit it while 2–3 screenshots advance underneath');
    }
    let consecutive = 0;
    for (const beat of segment) {
      consecutive = beat.narration ? consecutive + 1 : 0;
      if (consecutive >= 3) {
        throw new BriefError('three consecutive actions change narration; omit narration on intervening actions so text and screenshots use different pacing');
      }
    }
  }
}

function compileAction(
  action: Json,
  index: number,
  events: Json[],
  plan: string[],
  firstTs: number,
  previousTarget: { x: number; y: number } | undefined,
  viewport: Json,
  pacing: Json,
  revealedText: Map<number, string>,
): [Json, { x: number; y: number } | undefined] {
  rejectUnknown(action, ACTION_KEYS, `actions[${index}]`);
  if ('showTyping' in action && typeof action.showTyping !== 'boolean') {
    throw new BriefError(`actions[${index}].showTyping must be true or false`);
  }
  const event = eventAt(events, action.event, `actions[${index}].event`);
  requireMatchingViewport(event, viewport, `actions[${index}].event`);
  let frameEvent = event;
  if (action.frameEvent != null) {
    frameEvent = eventAt(events, action.frameEvent, `actions[${index}].frameEvent`);
    requireMatchingViewport(frameEvent, viewport, `actions[${index}].frameEvent`);
  }
  if (!Number.isInteger(action.chapter) || action.chapter < 0 || action.chapter >= plan.length) {
    throw new BriefError(`actions[${index}].chapter must index plan`);
  }
  const route = requireText(action.route, `actions[${index}].route`);
  if (ROUTE_UNSAFE.test(route)) throw new BriefError(`actions[${index}].route must be semantic, not a raw URL or identity`);

  const helper = String(event.helper || '');
  const automaticClickPair = CLICK_HELPERS.has(helper) && action.frameEvent == null && event.beforeFrame;
  const beat: Json = {
    frame: automaticClickPair ? event.beforeFrame : frameEvent.frame,
    route,
    chapter: action.chapter,
  };
  if (action.afterEvent != null) {
    const after = eventAt(events, action.afterEvent, `actions[${index}].afterEvent`);
    requireMatchingViewport(after, viewport, `actions[${index}].afterEvent`);
    beat.after = after.frame;
  } else if (automaticClickPair) {
    beat.after = event.frame;
  }
  if (beat.after && action.afterRoute != null) {
    const afterRoute = requireText(action.afterRoute, `actions[${index}].afterRoute`);
    if (ROUTE_UNSAFE.test(afterRoute)) throw new BriefError(`actions[${index}].afterRoute must be semantic`);
    beat.afterRoute = afterRoute;
  }
  const narration = validateNarration(action.narration, `actions[${index}].narration`);
  if (narration != null) beat.narration = narration;
  if (action.label != null) beat.label = requireText(action.label, `actions[${index}].label`);
  if (action.detour === true) beat.detour = true;
  if (action.error === true) beat.error = true;

  const cursor = event.cursor;
  if (CLICK_HELPERS.has(helper)) {
    if (!cursor || cursor.x == null || cursor.y == null) {
      throw new BriefError(`actions[${index}] identifies a click without captured coordinates`);
    }
    beat.cursor = { x: cursor.x, y: cursor.y };
    beat.click = true;
  } else if (TYPE_HELPERS.has(helper)) {
    const box = event.box;
    if (!box || !['x', 'y', 'w', 'h'].every(key => box[key] != null)) {
      throw new BriefError(`actions[${index}] identifies typing without a captured box`);
    }
    const showTyping = action.showTyping === true;
    if (showTyping && event.password) throw new BriefError(`actions[${index}].showTyping cannot reveal a password field`);
    const sourceLine = Number(event.sourceLine);
    if (showTyping && !revealedText.has(sourceLine)) {
      throw new BriefError(`actions[${index}].showTyping requires the original typed event`);
    }
    beat.type = {
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
      text: showTyping ? revealedText.get(sourceLine) : '••••••',
      ...(showTyping ? {} : { redact: true }),
    };
  } else if (action.showTyping != null) {
    throw new BriefError(`actions[${index}].showTyping requires a typing event`);
  }

  const target = eventTarget(event);
  if (action.context === true && !beat.click && !beat.type) beat.wide = true;
  else if (target && previousTarget) {
    const distance = Math.hypot(target.x - previousTarget.x, target.y - previousTarget.y);
    const diagonal = Math.hypot(Number(viewport.w), Number(viewport.h));
    if (distance > diagonal * 0.58) beat.cameraCut = true;
  }
  if (typeof event.ts === 'number') beat.t = round(Math.max(0, event.ts - firstTs));
  beat.dur = defaultActionDuration(beat, pacing);
  return [beat, target || previousTarget];
}

function validatePrivacy(reviewed: string[], redact: Json, composition: Json): void {
  const frames = usedFrames(composition);
  for (const frame of [...frames, ...reviewed, ...Object.keys(redact)]) {
    if (basename(frame) !== frame || !frame.toLowerCase().endsWith('.jpg')) throw new BriefError(`invalid frame name: ${frame}`);
  }
  if (new Set(reviewed).size !== reviewed.length) throw new BriefError('privacy.reviewedFrames contains duplicates');
  const missing = frames.filter(frame => !reviewed.includes(frame));
  if (missing.length) throw new BriefError('privacy review missing: ' + missing.join(', '));
  const unknown = Object.keys(redact).filter(frame => !frames.includes(frame)).sort();
  if (unknown.length) throw new BriefError('privacy.redact lists unused frames: ' + unknown.join(', '));
  for (const [frame, rectangles] of Object.entries(redact)) {
    if (!Array.isArray(rectangles)) throw new BriefError(`privacy.redact.${frame} must be a list`);
    rectangles.forEach((rectangle, index) => {
      const where = `privacy.redact.${frame}[${index}]`;
      if (!rectangle || typeof rectangle !== 'object' || Array.isArray(rectangle)) throw new BriefError(`${where} must be an object`);
      rejectUnknown(rectangle as Json, REDACTION_KEYS, where);
      for (const key of ['x', 'y', 'w', 'h']) {
        if (typeof rectangle[key] !== 'number' || !Number.isFinite(rectangle[key])) throw new BriefError(`${where}.${key} must be a finite number`);
      }
      if (rectangle.w <= 0 || rectangle.h <= 0) throw new BriefError(`${where} must have positive width and height`);
      for (const key of ['fill', 'stroke']) {
        const value = rectangle[key];
        if (value != null && value !== false && (typeof value !== 'string' || !OPAQUE_HEX.test(value))) {
          throw new BriefError(`${where}.${key} must be false or opaque six-digit hex`);
        }
      }
    });
  }
}

export function compileBrief(summary: Json, brief: Json, style: Json = HOUSE_STYLE, revealedText = new Map<number, string>()): Json {
  rejectUnknown(brief, BRIEF_KEYS, 'edit brief');
  const task = requireText(brief.task, 'task');
  const summaryText = optionalText(brief.summary, 'summary');
  const plan = requireTextList(brief.plan, 'plan', 2, 5);
  const outcomes = requireTextList(brief.outcomes, 'outcomes', 1, 5);
  if (!Array.isArray(brief.actions) || !brief.actions.length) throw new BriefError('actions must contain at least one action');
  if (!Array.isArray(summary.events) || !summary.events.length) throw new BriefError('recording-summary.json has no events');
  const events = summary.events as Json[];
  const firstAction = brief.actions[0];
  if (!firstAction || typeof firstAction !== 'object' || Array.isArray(firstAction)) throw new BriefError('actions[0] must be an object');
  const viewportEvent = eventAt(events, firstAction.frameEvent ?? firstAction.event, firstAction.frameEvent != null ? 'actions[0].frameEvent' : 'actions[0].event');
  if (!viewportEvent.viewport?.w || !viewportEvent.viewport?.h) throw new BriefError('recording-summary.json has no viewport');
  const viewport = viewportEvent.viewport;
  const firstTs = Number(events.find(event => typeof event.ts === 'number')?.ts ?? 0);

  if (!brief.privacy || typeof brief.privacy !== 'object' || Array.isArray(brief.privacy)) throw new BriefError('privacy must be an object');
  rejectUnknown(brief.privacy, PRIVACY_KEYS, 'privacy');
  if (!Array.isArray(brief.privacy.reviewedFrames) || !brief.privacy.reviewedFrames.every((frame: unknown) => typeof frame === 'string')) {
    throw new BriefError('privacy.reviewedFrames must be a list of frame names');
  }
  const reviewed = brief.privacy.reviewedFrames as string[];
  const redact = brief.privacy.redact || {};
  if (!redact || typeof redact !== 'object' || Array.isArray(redact)) throw new BriefError('privacy.redact must be an object');
  const explanations = brief.explanations || [];
  if (!Array.isArray(explanations)) throw new BriefError('explanations must be a list');

  const pacing = style.pacing;
  const readingWpm = Number(style.readingWpm);
  const explanationByAction = new Map<number, Json[]>();
  explanations.forEach((explanation: unknown, index: number) => {
    if (!explanation || typeof explanation !== 'object' || Array.isArray(explanation)) throw new BriefError(`explanations[${index}] must be an object`);
    const item = explanation as Json;
    rejectUnknown(item, EXPLANATION_KEYS, `explanations[${index}]`);
    if (!Number.isInteger(item.afterAction) || item.afterAction < 1 || item.afterAction > brief.actions.length) {
      throw new BriefError(`explanations[${index}].afterAction must index actions`);
    }
    const title = requireText(item.title, `explanations[${index}].title`);
    const sub = optionalText(item.summary, `explanations[${index}].summary`);
    const points = [
      { label: 'Observed', text: requireText(item.observed, `explanations[${index}].observed`) },
      { label: 'Mistake', text: requireText(item.mistake, `explanations[${index}].mistake`) },
      { label: 'Correction', text: requireText(item.correction, `explanations[${index}].correction`) },
    ];
    const card: Json = {
      card: true, kind: 'explanation', title,
      ...(sub ? { sub } : {}), points,
      dur: cardDuration(title, sub, points.flatMap(point => [point.label, point.text]), 'explanation', readingWpm),
    };
    explanationByAction.set(item.afterAction, [...(explanationByAction.get(item.afterAction) || []), card]);
  });

  const beats: Json[] = [{
    card: true, kind: 'intro', title: task,
    ...(summaryText ? { sub: summaryText } : {}),
    dur: cardDuration(task, summaryText, plan, 'intro', readingWpm),
  }];
  let previousTarget: { x: number; y: number } | undefined;
  brief.actions.forEach((raw: unknown, index: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BriefError(`actions[${index}] must be an object`);
    const [beat, target] = compileAction(raw as Json, index, events, plan, firstTs, previousTarget, viewport, pacing, revealedText);
    previousTarget = target;
    beats.push(beat, ...(explanationByAction.get(index + 1) || []));
  });
  const outcomeTitle = requireText(brief.outcomeTitle || 'Task complete', 'outcomeTitle');
  const outcomeSummary = optionalText(brief.outcomeSummary, 'outcomeSummary');
  beats.push({
    card: true, kind: 'outcome', title: outcomeTitle,
    ...(outcomeSummary ? { sub: outcomeSummary } : {}), outcomes,
    dur: cardDuration(outcomeTitle, outcomeSummary, outcomes, 'outcome', readingWpm),
  });

  validateNarrationCadence(beats);
  const rawToCardCount = addRawToCardHolds(beats, pacing);
  const budget = durationBudget(brief.actions.length, explanations.length, rawToCardCount, pacing);
  const duration = round(beats.reduce((sum, beat) => sum + Number(beat.dur), 0));
  if (duration > budget + 0.001) {
    throw new BriefError(`compiled video is ${duration.toFixed(1)}s; house-style budget is ${budget.toFixed(1)}s. Shorten card copy, remove redundant actions, or set narration only when the thought changes; viewers can pause for detail`);
  }
  const composition: Json = {
    schemaVersion: style.version,
    viewport: { w: viewport.w, h: viewport.h },
    cursorStart: style.cursorStart,
    frameStyle: style.frameStyle,
    readingWpm: style.readingWpm,
    pacing,
    durationBudget: budget,
    bg: style.background,
    plan,
    motion: style.motion,
    privacy: {
      reviewedFrames: reviewed,
      pad: style.privacy.pad,
      mask: style.privacy.mask,
    },
    redact,
    beats,
  };
  validatePrivacy(reviewed, redact, composition);
  return composition;
}

export function writeComposition(path: string, composition: Json): void {
  writeFileSync(path, `${COMPOSITION_PREFIX} ${JSON.stringify(composition, null, 2)};\n`);
}

export function loadRevealedText(eventsPath: string): Map<number, string> {
  const revealed = new Map<number, string>();
  let lines: string[];
  try { lines = readFileSync(eventsPath, 'utf8').split(/\r?\n/); }
  catch (error) { throw new BriefError(`cannot read ${eventsPath}: ${String(error)}`); }
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let event: Json;
    try { event = JSON.parse(line); }
    catch (error) { throw new BriefError(`cannot read ${eventsPath}: ${String(error)}`); }
    if (TYPE_HELPERS.has(event.helper) && event.input !== 'password' && event.password !== true && event.textRedacted !== true && event.text != null) {
      revealed.set(index + 1, String(event.text));
    }
  });
  return revealed;
}

function safeText(event: Json): string | undefined {
  if (event.text == null) return undefined;
  if (TYPE_HELPERS.has(event.helper)) return '<typed text hidden>';
  const value = String(event.text);
  if (event.input === 'password' || event.password === true || SENSITIVE.test(value)) return '<sensitive>';
  return value.slice(0, 120);
}

function safeLabel(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value);
  return SENSITIVE.test(text) ? '<sensitive>' : text.slice(0, 120);
}

export function initRecording(recordingPath: string, requireExplicit = false): Json {
  const recording = resolve(recordingPath);
  const eventsPath = join(recording, 'events.jsonl');
  if (!existsSync(eventsPath)) throw new BriefError(`missing ${eventsPath}`);
  const metaPath = join(recording, 'meta.json');
  const meta = existsSync(metaPath) ? loadJson(metaPath) : {};
  if (requireExplicit && (!existsSync(metaPath) || meta.auto === true)) {
    throw new BriefError('not an explicit recording; use the exact path returned by startRecording()');
  }
  copyFileSync(TEMPLATE, join(recording, 'video.html'));
  const events: Json[] = [];
  readFileSync(eventsPath, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let raw: Json;
    try { raw = JSON.parse(line); }
    catch (error) { throw new BriefError(`cannot read ${eventsPath}: ${String(error)}`); }
    if (!raw.frame) return;
    events.push({
      frame: raw.frame,
      ...(raw.beforeFrame ? { beforeFrame: raw.beforeFrame } : {}),
      sourceLine: index + 1,
      helper: raw.helper,
      method: raw.method,
      ts: raw.ts,
      route: 'Browser',
      tab: safeLabel(raw.title),
      viewport: { w: raw.w, h: raw.h },
      cursor: raw.x != null && raw.y != null ? { x: raw.x, y: raw.y } : undefined,
      box: raw.box,
      text: safeText(raw),
      textLength: raw.password === true || raw.input === 'password' || raw.textRedacted === true
        ? undefined
        : String(raw.text || '').length,
      password: raw.input === 'password' || raw.password === true,
      textRedacted: raw.textRedacted === true,
    });
  });
  const summary = {
    recording: basename(recording),
    title: safeLabel(meta.title),
    eventCount: events.length,
    events,
  };
  writeFileSync(join(recording, 'recording-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  writeSourceManifest(recording);
  return summary;
}

async function withVideoLock<T>(operation: () => Promise<T>): Promise<T> {
  const home = recordingHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const lock = join(home, 'video.lock');
  const acquire = (): number => {
    try {
      const descriptor = openSync(lock, 'wx', 0o600);
      writeFileSync(descriptor, String(process.pid));
      return descriptor;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = Number(readFileSync(lock, 'utf8').trim());
      if (!Number.isInteger(owner) || owner <= 0) {
        unlinkSync(lock);
        return acquire();
      }
      try { process.kill(owner, 0); }
      catch {
        unlinkSync(lock);
        return acquire();
      }
      throw new BriefError(`another video review/export is running (pid ${owner || 'unknown'})`);
    }
  };
  const descriptor = acquire();
  try { return await operation(); }
  finally {
    closeSync(descriptor);
    try { unlinkSync(lock); } catch { /* A stale-lock cleanup may have won the race. */ }
  }
}

export async function runVideoCli(args: string[]): Promise<number> {
  const [command, path, ...options] = args;
  if (!command || !path || !['init', 'review', 'export'].includes(command)) {
    console.error('usage: browser-harness-js video init|review|export <recording> [options]');
    return 2;
  }
  const recording = resolve(path);
  const active = await activeRecording();
  if (active) throw new BriefError(`stop the active recording before video processing: ${active}`);
  if (command === 'init') {
    if (options.some(option => option !== '--require-explicit') || options.filter(option => option === '--require-explicit').length > 1) {
      throw new BriefError('usage: browser-harness-js video init <recording> [--require-explicit]');
    }
    initRecording(recording, options.includes('--require-explicit'));
    console.log(`summary: ${join(recording, 'recording-summary.json')}`);
    console.log(`next: write ${join(recording, 'edit-brief.json')}, then run browser-harness-js video review`);
    return 0;
  }
  const render = await import('./video-render.ts');
  if (command === 'review') {
    if (options.length) throw new BriefError('usage: browser-harness-js video review <recording>');
    return withVideoLock(() => render.review(recording));
  }
  let reviewed = false;
  let output = 'video.mp4';
  let outputSet = false;
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (option === '--reviewed' && !reviewed) reviewed = true;
    else if (option === '--output' && !outputSet) {
      const value = options[++index];
      if (!value || value.startsWith('--')) throw new BriefError('--output requires a value');
      output = value;
      outputSet = true;
    } else {
      throw new BriefError(`unsupported or duplicate export option: ${option}`);
    }
  }
  return withVideoLock(() => render.exportVideo(recording, output, reviewed));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runVideoCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
