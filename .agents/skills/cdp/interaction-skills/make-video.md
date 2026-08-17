# Make a short explanatory video

Use captured browser frames as evidence. Never reenact a finished task or
fabricate cleaner footage. This workflow compacts a long action trace; it does
not accelerate a screen recording.

## Capture with consent

Fresh installs do not record. A natural request to “record,” “show,” “demo,” or
“make a video” opts in for that task; ordinary browser work does not.

Start before browser work and keep the exact returned directory:

```js
const recordingDir = await startRecording('azure-admin', 'Make Aitor superadmin')
// Perform and verify the task with raw CDP calls.
await stopRecording()
return recordingDir
```

Use real `Input.*` calls for visible clicks and typing. Arbitrary page-side
`Runtime.evaluate` expressions such as `element.click()` cannot be interpreted
as user actions and therefore are not recorded as action beats. Recording is
local, best-effort, and must never be allowed to break the browser task.

For persistent background consent:

```bash
browser-harness-js recordings enable
browser-harness-js recordings disable
browser-harness-js recordings
```

`CDP_RECORD=1` or `CDP_RECORD=0` overrides that preference for the daemon
process. Typed text fails closed to a fixed mask if focused-element inspection
fails, so plaintext is never written on an uncertain field. Automatic
recordings roll over after 180 idle seconds by default
(`CDP_RECORD_IDLE_SECONDS` changes it).

## Produce the video

Use the exact recording selected above. For a post-task request,
`recordings --latest` is usable only after verifying its timestamps and pages
match the task. If they do not, say that the work was not captured.

```bash
browser-harness-js video init <recording> --require-explicit
# Write <recording>/edit-brief.json.
browser-harness-js video review <recording>
# Inspect video-review-contact-sheet.jpg and every image in .privacy-review/.
browser-harness-js video export <recording> --reviewed
```

Omit `--require-explicit` only for a verified automatic recording. Never edit
generated `composition.js` or `video.html`; change the brief or shared SDK.
Export refuses to overwrite existing output, so use `--output video-v2.mp4`
for another cut. MP4 export requires `ffmpeg` and `ffprobe`; review and WebM
rendering use Chromium itself. Review/export jobs are globally serialized and the
canvas records at 1920×1080, 30 fps to bound GPU/encoder pressure. Do not run
parallel exports or repeatedly retry one that destabilizes the user's browser.

## Editorial contract

- Optimize for first-time comprehension. The raw trace remains the debugging
  artifact. Start with the task and a 2–5 step plan, then end on verified
  outcomes.
- Build one causal chain: intent → action → visible result. Remove waits,
  retries, and repetition that add no understanding, but show every item or
  state explicitly claimed by the outcome.
- Narration is optional and sticky. Add a short present-tense thought only when
  it changes, then omit `narration` while 2–3 screenshots advance underneath.
- Preserve representative captured clicks, cursor endpoints, typing, and result
  frames. A recorded click automatically uses its pre-action frame and captured
  result; override with `frameEvent` or `afterEvent` only when necessary.
- Keep a useful wrong turn when it changed the approach. Explain it once as
  Observed → Mistake → Correction; remove failures that teach nothing.
- Keep raw frames unlabelled. Subtitles and progress stay outside the app. Use
  semantic routes and let the compiler own timing, camera, motion, and style.
- The default 22-second budget and 380 WPM cards are deliberately concise and
  pause-friendly.

## Edit brief

Events are one-based entries in `recording-summary.json`; chapters are
zero-based plan entries.

```json
{
  "task": "Extract the top five stories and comments",
  "summary": "Collect each discussion and save structured JSON.",
  "plan": ["Collect stories", "Capture discussions", "Verify JSON"],
  "actions": [
    {
      "event": 3,
      "chapter": 0,
      "route": "Hacker News / Front page",
      "afterRoute": "Hacker News / Discussion",
      "narration": "Open the first discussion.",
      "label": "Open discussion"
    },
    {
      "event": 8,
      "afterEvent": 9,
      "chapter": 1,
      "route": "Hacker News / Discussion",
      "afterRoute": "Hacker News / Next discussion",
      "label": "Continue in rank order"
    }
  ],
  "explanations": [{
    "afterAction": 2,
    "title": "Why the first approach failed",
    "observed": "Navigation links appeared in the result",
    "mistake": "Every page link was selected",
    "correction": "Restrict extraction to story rows"
  }],
  "outcomeTitle": "Five discussions captured",
  "outcomeSummary": "The requested JSON is verified.",
  "outcomes": ["Five current stories saved", "Comment trees preserved"],
  "privacy": {
    "reviewedFrames": ["0002.jpg", "0003.jpg", "0008.jpg", "0009.jpg"],
    "redact": {"0003.jpg": [{"x": 10, "y": 10, "w": 120, "h": 32}]}
  }
}
```

Each action requires `event`, `chapter`, and a short semantic `route`.
Optional fields are `frameEvent`, `afterEvent`, `afterRoute`, `narration`,
`label`, `detour`, `error`, `context`, and `showTyping`. Narration is at
most seven words. Explanations reveal Observed → Mistake → Correction. Outcomes
must be verified.

## Privacy and provenance

Typed text is hidden unless its exact non-password event is inspected and
explicitly enabled with `showTyping: true`. Passwords cannot be revealed.
Credential-bearing URL parameters are scrubbed during capture. Private app
URLs, identities, credentials, tokens, tenant data, and unrelated people stay
private.

Use opaque redaction rectangles in page coordinates and list every used frame
in `privacy.reviewedFrames` only after inspecting its final full-resolution
image. Public task evidence such as authors, post text, and link domains may
remain. Automated sensitive-data detection is a backstop, not a guarantee.

Initialization hashes the trace and every source frame. Review hashes the brief,
composition, renderer, contact sheet, and every reviewed image, then seals the
review report itself. Export refuses
changed evidence or review artifacts, verifies the final duration and decoder,
and creates a final MP4 contact sheet.
