# pi-studio-opencode

`pi-studio-opencode` is an experimental opencode plugin implementation of π Studio, modelled on the original `pi-studio` extension for Pi. It aims to keep Studio behaviour as host-neutral as practical while using opencode as the first standalone host.

Current prototype support includes:

- a Studio-like two-pane editor/response workspace
- run / queue steering / stop / history flows
- response and editor preview with math fallback
- file load/save, working-dir-based preview resolution, and editor syntax highlighting
- `.qmd`/Markdown preview improvements including targeted HTML comment stripping, preview page-break markers, Quarto-style callouts, `fig-align`, and local PDF figure preview via `pdf.js`

Full parity with `pi-studio` is still in progress.

## Install

```bash
cd "/Users/omac010/Git-Working/pi-studio-opencode"
npm install
```

## Run

Start a local opencode server automatically:

```bash
npm start -- --directory "/path/to/project"
```

Connect to an already running opencode server instead:

```bash
npm start -- --base-url "http://127.0.0.1:4096" --directory "/path/to/project"
```

Run the fuller smoke suite:

```bash
npm run smoke -- --directory "/path/to/project"
```

Run the adapter-managed opencode queue demo:

```bash
npm run host-demo -- --directory "/path/to/project"
```

Run the mocked pi host sketch demo:

```bash
npm run pi-host-demo
```

Run the minimal browser prototype:

```bash
npm run prototype -- --directory "/path/to/project"
```

If you already have `opencode serve` running, attach to it to avoid cold-start overhead:

```bash
npm run prototype -- --base-url "http://127.0.0.1:4096" --directory "/path/to/project"
```

Then open:

```text
http://127.0.0.1:4312
```

## Optional flags

- `--session <id>` reuse an existing session instead of creating one
- `--title <title>` session title for a newly created session
- `--host <host>` prototype server bind host (for `npm run prototype`)
- `--port <port>` prototype server bind port (for `npm run prototype`)
- `--queue-delay-ms <n>` delay before queueing the first steer
- `--second-queue-delay-ms <n>` delay before queueing the second steer
- `--settle-timeout-ms <n>` wait timeout for queued replies
- `--poll-interval-ms <n>` polling interval when waiting for idle/replies
- `--artifacts-dir <dir>` output directory for logs / normalized history
- `--multi-steer-test` queue a second steer while the first chain is still busy
- `--new-run-after-idle-test` start a fresh run in the same session after the first chain settles
- `--abort-test` start another fresh run and abort it
- `--abort-delay-ms <n>` delay before calling `session.abort()`

Prompt overrides:

- `--run-prompt <text>`
- `--queue-prompt <text>`
- `--second-queue-prompt <text>`
- `--second-run-prompt <text>`
- `--abort-prompt <text>`

## Artifacts

The script writes:

- `events.jsonl` raw SSE event log
- `messages-final.json` normalized final session messages
- `prompt-submissions.json` explicit local prompt provenance + matched message IDs
- `response-history.json` reconstructed response history using the local provenance
- `chains.json` chain summaries
- `matching-diagnostics.json` unmatched / extra message diagnostics
- `summary.json` top-level run summary

## Adapter prototype

New files:

- `src/studio-host-types.ts` — small host-neutral interface and shared types
- `src/host-opencode.ts` — `studio-host-opencode` prototype
- `src/demo-host.ts` — opencode demo driver using a local adapter-managed steering queue
- `src/host-pi.ts` — `studio-host-pi` sketch against a minimal Pi session interface
- `src/mock-pi-session.ts` — mock Pi session used for local validation
- `src/demo-host-pi.ts` — demo driver for the Pi host sketch
- `src/prototype-server.ts` — tiny HTTP server exposing the opencode host to a browser UI
- `static/prototype.html` / `static/prototype.css` / `static/prototype.js` — minimal browser prototype

### Shared host contract

`src/studio-host-types.ts` defines the small shared surface:

- `startRun(prompt)`
- `queueSteer(prompt)`
- `stop()`
- `subscribe(listener)`
- `getState()`
- `getCapabilities()`
- `getHistory()`
- `waitUntilIdle()`
- `close()`

### Host capability / mode layer

The shared host contract now exposes a small static capability descriptor:

- `steeringMode: "native-steer" | "adapter-queue" | "native-queue"`
- `stopSupported: boolean`

Current adapters advertise:

- `opencode` host → `adapter-queue`
- `pi` host sketch → `native-steer`

That keeps the semantic distinction explicit without forcing `studio-core` to care how each backend delivers steering.

### Browser prototype

The browser prototype is still intentionally lightweight, but it now covers a larger Studio-shaped slice:

- one shared `OpencodeStudioHost`
- Studio-like two-pane layout
- editor pane with:
  - load file content
  - save / save as
  - working-directory control for preview/resource resolution
  - syntax highlighting toggle
  - language selection
- response pane on the right with:
  - **Response (Raw)**
  - **Response (Preview)** via pandoc HTML
  - **Editor (Preview)** via the same pandoc preview path
- preview/math behavior including:
  - preserved multiline matrix-style display math
  - selective MathJax fallback for pandoc-unsupported math
  - targeted Markdown/QMD HTML comment stripping
  - preview-only page-break dividers for standalone `\newpage` / `\pagebreak` / `\clearpage`
  - Quarto-style callout styling and `fig-align` support
  - local PDF figure preview via `pdf.js`
  - response-pane repaint and scroll-reset behavior closer to `pi-studio`
- **Run**, **Queue steering**, and **Stop** controls
- live host/session status
- current provider/model indicator
- active-turn timing diagnostics:
  - submitted time
  - time to backend busy
  - time to first assistant event
  - time to first output text
  - live output preview while the turn is running
- response history with prompt provenance
- chain-grouped history with follow-latest mode
- selectable raw prompt vs effective prompt reload into the composer
- recent host event log

It is still deliberately narrower than full `pi-studio` (for example PDF export, annotation workflow, and Pi-specific editor integration are not ported), but it is now meant to be genuinely human-testable rather than just a queue/history spike.

### opencode adapter

The key design choice in the opencode adapter is:

- **never send more than one Studio prompt to opencode at a time**

So if Studio queues multiple steering messages while a run is active, the adapter:

1. stores them locally
2. waits for the active opencode turn to reach idle
3. sends the next steering prompt
4. repeats until the local queue is empty

This deliberately emulates more predictable Studio semantics even if raw busy-session opencode prompts sometimes collapse into fewer assistant turns.

### pi adapter sketch

The Pi host sketch takes the opposite approach:

- it assumes Pi already has meaningful native steering semantics
- it forwards steering via the Pi session immediately
- it uses local metadata mainly for chain/history reconstruction, not queue emulation

So the side-by-side comparison is now explicit:

- **Pi:** trust native steering queue semantics, add local provenance
- **opencode:** preserve Studio semantics in the adapter with a local queue
