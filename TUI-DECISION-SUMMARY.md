# Homebox TUI: Technical Decision Summary

Date: 2026-07-23

## Context

We are considering a standalone terminal client for Homebox. The TUI will run
locally on a laptop while the Homebox server is hosted elsewhere. It should be
a remote HTTP client, not an embedded server UI and not a direct consumer of
Homebox's repositories, services, Ent models, or database.

The two leading implementation choices were:

- Go with Bubble Tea, Bubbles, Lip Gloss, and Huh.
- Python with Textual.

The developer knows Python best but prefers the terminal-native components and
interaction style of the Charm ecosystem. AI-assisted development and ongoing
human maintainability are both important.

## Recommendation

Use **Go with Bubble Tea v2**.

Overall project-fit scores:

| Option | Score |
| --- | ---: |
| Go + Bubble Tea | **8.8/10** |
| Python + Textual | **8.6/10** |

The difference is small. Bubble Tea wins because it better matches the desired
terminal-native product, offers strong compiler feedback during AI-assisted
development, and produces a simple standalone binary. Textual remains the safer
choice if learning Go would prevent the human maintainer from confidently
reviewing and changing the code.

The recommendation is based on framework and product fit, not on the Homebox
backend also being written in Go. Since the server is remote, the TUI must stay
behind the HTTP API boundary regardless of language.

## Why Go and Bubble Tea

### Advantages

- The Charm components have a cohesive, keyboard-first terminal feel.
- `bubbles/list`, `table`, `viewport`, `filepicker`, `help`, `progress`, and
  text input map well to Homebox workflows.
- Huh can cover bounded forms and prompts.
- Bubble Tea's model/update/view architecture makes state transitions explicit
  and unit-testable.
- Go's compiler catches many mistakes introduced during generated or
  AI-assisted refactors.
- Go is strong for HTTP, multipart uploads, cancellation, and concurrent work.
- A release can be one cross-platform executable with no runtime installation.
- Generated API types provide valuable compile-time feedback once the OpenAPI
  contract is ready.

### Costs

- Bubble Tea is a component toolkit and runtime, not a complete application
  framework like Textual.
- Child components require explicit message and command forwarding.
- Focus, screen navigation, modal behavior, and responsive layout require an
  intentional application architecture.
- Lip Gloss layout is manual rather than CSS- or flexbox-driven.
- Complex CRUD forms require more work even with Huh.
- Image rendering requires a third-party integration such as `go-termimg`.
- Bubble Tea v2 is relatively new, so v1 examples must not be followed blindly.
- The human maintainer will need to become comfortable reviewing ordinary Go.

## Why Textual Was Close

Textual would provide faster initial development for a Python-fluent maintainer
and includes more application-level machinery: screens, modals, focus handling,
reactive state, workers, validation, CSS layout, data tables, trees, and Pilot
tests. Its image and filesystem ecosystem also fits the media workflow well:

- `DirectoryTree` for filesystem navigation.
- `SelectionList` for multi-file selection.
- `textual-fspicker` for ready-made file dialogs.
- `textual-image` for Kitty/Sixel image rendering with a Unicode fallback.

Its main disadvantages are packaging, weaker compile-time enforcement, more
runtime lifecycle failures, and a default interaction style that can feel more
like a web application rendered in a terminal. It remains the fallback choice
if Go ownership becomes a material concern.

## Homebox Repository Findings

The fork already has the important remote-client foundations:

- A committed Swagger 2 and OpenAPI 3 contract.
- Static API-key authentication through the `Authorization` header.
- Collection selection through `X-Tenant`.
- Endpoints for entities, entity trees, tags, templates, maintenance,
  statistics, attachments, groups, and user information.
- A generation chain from handler annotations to Swagger/OpenAPI and generated
  TypeScript types.

The existing frontend is itself an HTTP client, so the TUI should follow the
same boundary rather than import backend internals.

### OpenAPI limitation

The current OpenAPI document is useful for documentation and models but is not
yet a clean full-client contract:

- It has 46 `/v1` paths but only two explicit `operationId` values.
- It exposes numerous generated Ent persistence schemas and edge types.
- The existing TypeScript generation deliberately uses `--no-client` and only
  generates types.

For the first TUI release, generate models only or hand-write a narrow typed
client around the required endpoints. Before generating a complete Go client:

1. Add stable Swagger `@ID` annotations to relevant handlers.
2. Keep transport DTOs separate from Ent persistence structures.
3. Verify multipart attachment operations in the generated contract.
4. Generate the client from a pinned, reproducible OpenAPI document.

`oapi-codegen` is the likely first choice for a conventional Go client. `ogen`
is a stricter alternative if generated validation and a larger generated API
are desirable.

## Proposed Architecture

```text
Local laptop

┌────────────────────────────────────┐
│ homebox-tui                        │
│                                    │
│ Bubble Tea screens and components  │
│              │                     │
│ Application/domain state           │
│              │                     │
│ Typed Homebox HTTP client           │
└──────────────┬─────────────────────┘
               │ HTTPS
               │ Authorization: <API key>
               │ X-Tenant: <collection ID>
               ▼
┌────────────────────────────────────┐
│ Remotely hosted Homebox server     │
└────────────────────────────────────┘
```

Suggested module shape:

```text
cmd/homebox-tui/
internal/api/          HTTP transport and Homebox types
internal/domain/       TUI-facing models
internal/app/          root Bubble Tea model and routing
internal/screens/      search, locations, item detail, maintenance
internal/components/   reusable leaf models
internal/config/       profiles and non-secret preferences
internal/theme/        semantic colors and styles
```

Keep one root model, a small number of screen models, and reusable leaf
components. Avoid a deeply nested graph of Bubble Tea models and avoid a single
giant `Update` method.

## Authentication and Configuration

- Use a dedicated Homebox API key rather than storing a username/password or
  browser session token.
- Require HTTPS for remote connections unless the user explicitly opts into a
  local insecure development profile.
- Store server URL, default collection, theme, and view preferences in a normal
  profile file.
- Store the API key in the operating-system credential store or accept it from
  an environment variable. Do not save it in plaintext by default.
- Support multiple named Homebox server profiles.
- Treat collection switching as first-class state and send `X-Tenant` when a
  non-default collection is selected.

## Product Shape

The TUI should complement the web UI rather than reproduce every web screen.
The strongest terminal workflows are:

- Instant global search.
- Dense item browsing and filtering.
- Persistent list/detail navigation.
- Location and tag trees.
- Collection switching.
- Quantity adjustment and other quick mutations.
- Move, tag, archive, and maintenance actions.
- Review queues for repeated item creation or correction.
- Opening an item, attachment, or advanced workflow in the browser.

Complex administration and graphical workflows can remain in the web UI until
there is a compelling terminal-native design for them.

## Suggested Initial Layout

Wide layout:

```text
┌ Items / Search ───────────────────┬ Item detail ─────────────────────┐
│ filter and result list            │ identity, location, tags         │
│                                   │ quantity and important metadata  │
│                                   │ maintenance and attachments      │
└───────────────────────────────────┴──────────────────────────────────┘
 / search   Enter open   e edit   m move   ? help   q quit
```

Responsive behavior:

- Above 120 columns: persistent result and detail panes.
- Between 80 and 120 columns: narrower two-pane layout with secondary fields
  hidden behind detail-on-Enter.
- Around a 60-column tmux split: single-pane drill-down; Enter opens detail and
  Escape returns to the list.
- Below the supported floor: render a clear terminal-too-small message rather
  than clipping controls or crashing.

Panel positions must remain stable. Focus may change, but panels must not move
or reorder automatically.

## Photo Selection, Preview, and Upload

Photo upload is feasible in Bubble Tea and should not automatically be left to
the web UI.

### Selection

`bubbles/filepicker` provides terminal filesystem navigation, extension
filtering, hidden-file handling, sizes, and permissions. It selects one path at
a time, so multi-photo selection should be implemented as a queue owned by the
application:

1. Navigate through the file picker.
2. Press Space to add or remove the highlighted file from the queue.
3. Show selected files in an adjacent list.
4. Press `p` to mark the primary photo.
5. Upload the queue with multipart requests in Bubble Tea commands.

Upload sequentially initially and display file-level progress such as `2/5`.
Add byte-level progress only if real usage shows it is valuable.

### Preview

Use a terminal image library such as `go-termimg` for automatic protocol
selection and Bubble Tea integration:

```text
Kitty/TGP → Sixel/iTerm2 → Unicode half-blocks → metadata-only
```

Image preview must be optional. Selection and upload must remain fully usable
when the terminal cannot display graphics.

Terminal graphics require explicit cleanup and repositioning when previews
change, screens scroll, modals appear, the terminal resizes, or the application
exits. Test these cases, including tmux passthrough.

For formats without a local decoder, show filename, dimensions when available,
MIME type, and size; upload the original unchanged and display Homebox's
generated thumbnail afterward.

## Homebox Companion

`duelion/homebox-companion` is worth studying as a workflow reference. It
validates a photo-first flow in which users submit several photos, review
AI-detected items, correct fields, choose locations and tags, and then create
Homebox records.

This suggests a potentially stronger product than a simple terminal clone:

> The fastest keyboard-driven way to put things into and retrieve things from
> Homebox.

An optional later workflow could provide a review queue for AI-proposed items.
That could call a separate companion/AI service rather than embedding the AI
pipeline in the Go binary. Concepts may be studied freely, but code reuse must
respect Homebox Companion's GPL-3.0 license.

## Testing Strategy

Use three layers:

1. Pure update tests: send Bubble Tea messages and assert state transitions.
2. Pinned-size render/golden tests with a fixed color profile.
3. A very small number of PTY smoke tests for real keyboard and terminal
   behavior.

API tests should use an HTTP fake server and cover authentication, tenant
headers, pagination, errors, timeouts, cancellation, uploads, and malformed
responses. Image tests should keep protocol-specific output separate from the
core application state tests.

Always test at wide, 80x24, and approximately 60-column sizes. Do not design
only at the developer's normal terminal size.

## Proposed First Release

1. Named server profile and API-key authentication.
2. Collection selection.
3. Searchable, paginated item list.
4. Item detail view.
5. Location tree.
6. Tag filtering.
7. Quick quantity, move, tag, and archive actions.
8. Open item in the web UI.
9. Focused tests at all supported terminal sizes.

Photo selection, preview, and upload are good candidates for the next vertical
slice once the API client and navigation model are stable. AI-assisted intake
should follow only after the ordinary review-and-create workflow is proven.

## Decision Reversal Conditions

Reconsider Python and Textual if any of these become true:

- The human maintainer cannot confidently review and modify the Go code.
- Complex form construction dominates the product.
- Embedded Python-only AI or image-processing libraries become a core
  requirement.
- Browser deployment through the same UI code becomes important.
- Go image-protocol integration proves unreliable in the target terminals.

Otherwise, proceed with Go and Bubble Tea.
