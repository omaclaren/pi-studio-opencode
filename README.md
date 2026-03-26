# pi-studio-opencode

`pi-studio-opencode` is an experimental opencode plugin implementation of π Studio, modelled on the original `pi-studio` extension for Pi. It aims to keep Studio behaviour as host-neutral as practical while using opencode as the first standalone host.

Current prototype support includes:

- a Studio-like two-pane editor/response workspace
- run / queue steering / stop / history flows
- response and editor preview with math fallback
- file load/save, working-dir-based preview resolution, and editor syntax highlighting
- `.qmd`/Markdown preview improvements including targeted HTML comment stripping, preview page-break markers, Quarto-style callouts, `fig-align`, and local PDF figure preview via `pdf.js`
- PDF export of the current right-pane preview via pandoc + xelatex

Full parity with `pi-studio` is still in progress.

## Install

```bash
cd "/Users/omac010/Git-Working/pi-studio-opencode"
npm install
```

## Run

Launch the browser Studio surface directly:

```bash
npm run launch -- --directory "/path/to/project"
```

That starts the local Studio browser server, auto-opens your browser, and either:

- starts a local opencode server automatically, or
- reuses an existing opencode server/session when you pass `--base-url` / `--session`

Example attaching to an existing opencode server/session:

```bash
npm run launch -- --base-url "http://127.0.0.1:4096" --session "<session-id>" --directory "/path/to/project"
```

Build the standalone CLI bin:

```bash
npm run build
node dist/launcher.js --directory "/path/to/project"
```

The compiled launcher is also exposed as:

```bash
pi-studio-opencode --directory "/path/to/project"
```

Start a local opencode server automatically for the non-browser queue/provenance driver:

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

## Launch from an active opencode session

There is now a thin opencode-side launcher/bridge plugin in:

- `src/opencode-plugin.ts`

What it does:

- intercepts a `studio` command from the active opencode session
- starts a local Studio browser server for that session
- binds Studio to the current opencode session via the plugin client/event hooks
- opens the browser Studio surface
- cancels the placeholder command before a normal model turn is sent

### Current reliable setup

The launcher plugin can best-effort inject a `studio` command entry, but the **reliable** current setup is still to add an explicit command entry in your opencode config.

Ready-to-copy examples are now included in:

- `examples/opencode/opencode.local-path.jsonc`
- `examples/opencode/INSTALL.md`

Example `opencode.json` snippet:

```json
{
  "plugin": ["/absolute/path/to/pi-studio-opencode"],
  "command": {
    "studio": {
      "template": "Open π Studio for this active opencode session.",
      "description": "Open π Studio attached to the current opencode session"
    }
  }
}
```

After editing config, start a fresh plain interactive opencode session, then run:

```text
/studio
```

Optional launcher flags can be forwarded after the command, for example:

```text
/studio --no-open --port 4312
```

Notes:

- `--base-url`, `--session`, and `--directory` are intentionally taken from the **current active opencode session** and user-supplied overrides are ignored.
- the normal interactive `/studio` flow now works from plain `opencode`; `opencode --port 4096` is no longer required.
- if you launch with `--no-open`, use the **full tokenized URL** shown by the Studio toast/log, not just the bare port root.
- the browser UI now shows linked project/session information in the footer/tooltip and follows the current opencode light/dark/system theme choice.
- the current implementation keeps the Studio browser surface external; it does **not** try to embed Studio inside opencode.
- if `/studio` gets sent to the model as ordinary text instead of opening Studio, the plugin likely did not load; rebuild/restart opencode and try again.

## Optional flags

Shared launcher/prototype flags:

- `--session <id>` reuse an existing session instead of creating one
- `--title <title>` session title for a newly created session
- `--host <host>` Studio browser server bind host
- `--port <port>` Studio browser server bind port (`0` = auto-select; launcher default)
- `--no-open` start the browser server without opening a browser automatically (launcher only)

Driver/smoke flags:

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
- `src/launcher.ts` — standalone browser-launch CLI / bin
- `src/opencode-plugin.ts` — thin opencode command hook that launches Studio for the current session
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
  - **Export right preview as PDF** via pandoc + xelatex
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

It is still deliberately narrower than full `pi-studio` (for example some deeper annotation workflow details and Pi-specific editor integration are not ported), but it is now meant to be genuinely human-testable rather than just a queue/history spike.

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
