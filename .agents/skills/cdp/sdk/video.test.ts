import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RecordingManager, autoRecordingSetting, setAutoRecording } from './recording.ts';
import {
  BriefError,
  HOUSE_STYLE,
  compileBrief,
  initRecording,
  loadJson,
  loadRevealedText,
  verifySourceManifest,
} from './video.ts';

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'browser-harness-js-video-'));
  writeFileSync(join(directory, 'meta.json'), JSON.stringify({ name: 'fixture', title: 'Safe task', started: 1 }));
  for (const name of ['0001.jpg', '0002.jpg', '0003.jpg']) writeFileSync(join(directory, name), name);
  const events = [
    { ts: 1, helper: 'start_recording', w: 800, h: 600, frame: '0001.jpg', title: 'Example' },
    { ts: 2, helper: 'click_at_xy', w: 800, h: 600, x: 200, y: 150, beforeFrame: '0001.jpg', frame: '0002.jpg', title: 'Example' },
    { ts: 3, helper: 'type_text', w: 800, h: 600, box: { x: 20, y: 30, w: 200, h: 40 }, input: 'text', text: 'private draft', beforeFrame: '0002.jpg', frame: '0003.jpg', title: 'Example' },
  ];
  writeFileSync(join(directory, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  return directory;
}

function brief(showTyping = false): Record<string, unknown> {
  return {
    task: 'Complete the example task',
    summary: 'Demonstrate the verified result.',
    plan: ['Open the item', 'Enter the value'],
    actions: [
      { event: 2, chapter: 0, route: 'Example / Item', narration: 'Open the item' },
      { event: 3, chapter: 1, route: 'Example / Form', showTyping },
    ],
    outcomeTitle: 'Task complete',
    outcomeSummary: 'The result is visible.',
    outcomes: ['Item updated'],
    privacy: { reviewedFrames: ['0001.jpg', '0002.jpg', '0003.jpg'], redact: {} },
  };
}

test('recording initialization hides typing and hashes exact evidence', () => {
  const directory = fixture();
  try {
    const summary = initRecording(directory, true);
    assert.equal(summary.events[2].text, '<typed text hidden>');
    assert.equal(summary.events[1].beforeFrame, '0001.jpg');
    verifySourceManifest(directory);
    writeFileSync(join(directory, 'edit-brief.json'), JSON.stringify(brief()));
    const composition = compileBrief(summary, loadJson(join(directory, 'edit-brief.json')), HOUSE_STYLE, loadRevealedText(join(directory, 'events.jsonl')));
    assert.equal(composition.beats[1].frame, '0001.jpg');
    assert.equal(composition.beats[1].after, '0002.jpg');
    assert.equal(composition.beats[1].click, true);
    assert.deepEqual(composition.beats[2].type, {
      box: { x: 20, y: 30, w: 200, h: 40 },
      text: '••••••',
      redact: true,
    });
    writeFileSync(join(directory, '0002.jpg'), 'tampered');
    assert.throws(() => verifySourceManifest(directory), /source changed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('typing requires explicit reveal and unsafe semantic routes are rejected', () => {
  const directory = fixture();
  try {
    const summary = initRecording(directory);
    const revealed = loadRevealedText(join(directory, 'events.jsonl'));
    const shown = compileBrief(summary, brief(true), HOUSE_STYLE, revealed);
    assert.equal(shown.beats[2].type.text, 'private draft');
    const unsafe = brief() as any;
    unsafe.actions[0].route = 'https://example.com/?user=a@example.com';
    assert.throws(() => compileBrief(summary, unsafe, HOUSE_STYLE, revealed), BriefError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('recording preference is off by default and persists explicit consent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'browser-harness-js-home-'));
  const previousHome = process.env.BROWSER_HARNESS_JS_HOME;
  const previousOverride = process.env.CDP_RECORD;
  process.env.BROWSER_HARNESS_JS_HOME = home;
  delete process.env.CDP_RECORD;
  try {
    assert.deepEqual(await autoRecordingSetting(), { enabled: false, source: 'default' });
    await setAutoRecording(true);
    assert.deepEqual(await autoRecordingSetting(), { enabled: true, source: 'config' });
    process.env.CDP_RECORD = '0';
    assert.deepEqual(await autoRecordingSetting(), { enabled: false, source: 'CDP_RECORD' });
  } finally {
    if (previousHome == null) delete process.env.BROWSER_HARNESS_JS_HOME;
    else process.env.BROWSER_HARNESS_JS_HOME = previousHome;
    if (previousOverride == null) delete process.env.CDP_RECORD;
    else process.env.CDP_RECORD = previousOverride;
    rmSync(home, { recursive: true, force: true });
  }
});

test('recorder masks password text and scrubs credential URLs', async () => {
  const home = mkdtempSync(join(tmpdir(), 'browser-harness-js-recorder-'));
  const previousHome = process.env.BROWSER_HARNESS_JS_HOME;
  const previousOverride = process.env.CDP_RECORD;
  process.env.BROWSER_HARNESS_JS_HOME = home;
  delete process.env.CDP_RECORD;
  const mockSession = {
    getActiveSession: () => 'sid',
    _call: async (method: string) => method === 'Runtime.evaluate'
      ? { result: { value: { url: 'https://alice:pw@example.test/token/secret-value?code=secret#oauth-state', title: 'Private', w: 900, h: 700, input: 'password', box: { x: 1, y: 2, w: 3, h: 4 } } } }
      : { data: Buffer.from('jpeg').toString('base64') },
  };
  try {
    const manager = new RecordingManager(mockSession as any);
    const directory = await manager.start('masked', 'Password test');
    await manager.observe({ method: 'Input.insertText', params: { text: 'hunter2' }, sessionId: 'sid', result: {}, durationMs: 2 });
    await manager.stop();
    const lines = readFileSync(join(directory, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const typed = lines.find(event => event.helper === 'type_text');
    assert.equal(typed.text, '••••••');
    assert.equal(typed.textRedacted, true);
    assert.equal(typed.password, true);
    assert.equal(typed.url, 'https://REDACTED:REDACTED@example.test/token/REDACTED?code=REDACTED');
    const summary = initRecording(directory);
    const summarized = summary.events.find((event: any) => event.helper === 'type_text');
    assert.equal(summarized.textLength, undefined);
    const diskEvent = loadJson(join(directory, 'recording-summary.json')).events.find((event: any) => event.helper === 'type_text');
    assert.equal('textLength' in diskEvent, false);
    assert.equal(summarized.textRedacted, true);
  } finally {
    if (previousHome == null) delete process.env.BROWSER_HARNESS_JS_HOME;
    else process.env.BROWSER_HARNESS_JS_HOME = previousHome;
    if (previousOverride == null) delete process.env.CDP_RECORD;
    else process.env.CDP_RECORD = previousOverride;
    rmSync(home, { recursive: true, force: true });
  }
});


test('typed text fails closed when focused-element inspection fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'browser-harness-js-fail-closed-'));
  const previousHome = process.env.BROWSER_HARNESS_JS_HOME;
  const previousOverride = process.env.CDP_RECORD;
  process.env.BROWSER_HARNESS_JS_HOME = home;
  delete process.env.CDP_RECORD;
  const mockSession = {
    getActiveSession: () => 'sid',
    _call: async (method: string) => {
      if (method === 'Runtime.evaluate') throw new Error('target navigated');
      return { data: Buffer.from('jpeg').toString('base64') };
    },
  };
  try {
    const manager = new RecordingManager(mockSession as any);
    const directory = await manager.start('fail-closed');
    await manager.observe({ method: 'Input.insertText', params: { text: 'must-not-reach-disk' }, sessionId: 'sid', result: {}, durationMs: 1 });
    await manager.stop();
    const evidence = readFileSync(join(directory, 'events.jsonl'), 'utf8');
    assert.equal(evidence.includes('must-not-reach-disk'), false);
    const typed = evidence.trim().split('\n').map(line => JSON.parse(line)).find(event => event.helper === 'type_text');
    assert.equal(typed.text, '••••••');
    assert.equal(typed.textRedacted, true);
  } finally {
    if (previousHome == null) delete process.env.BROWSER_HARNESS_JS_HOME;
    else process.env.BROWSER_HARNESS_JS_HOME = previousHome;
    if (previousOverride == null) delete process.env.CDP_RECORD;
    else process.env.CDP_RECORD = previousOverride;
    rmSync(home, { recursive: true, force: true });
  }
});
