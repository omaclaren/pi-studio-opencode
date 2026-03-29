# pi-studio-opencode

OpenCode plug-in adaptation of the [pi](https://pi.dev/) extension [`pi-studio`](https://github.com/omaclaren/pi-studio).

It provides a local browser-based Studio workspace for [OpenCode](https://opencode.ai/), with an editor on the left and response/preview on the right.

If you use pi itself, use the original [`pi-studio`](https://github.com/omaclaren/pi-studio). This repo is for OpenCode.

## Status

Usable and actively improving.

The main goal is a good OpenCode version of Studio rather than full feature parity with `pi-studio`.

## Features

- Launch Studio from an active OpenCode session with `/studio`
- Attach Studio to the same session you are already using
- Two-pane editor + response/preview workspace
- Run, queue steering, stop, and browse response history
- Raw response, rendered response preview, and editor preview
- Load and save local files
- Markdown / QMD / LaTeX preview with practical support for:
  - math fallback
  - Quarto-style callouts
  - preview page-break markers
  - local PDF figure preview via `pdf.js`
- PDF export of the right-pane preview via `pandoc` + `xelatex`
- Theme-aware Studio UI based on the active OpenCode theme
- Footer/status info, pane focus controls, and response highlighting inspired by `pi-studio`

## Install

Run the package's installer CLI with one of:

```bash
bunx pi-studio-opencode@latest install
npx pi-studio-opencode@latest install
```

That updates your OpenCode config to add:

- the `pi-studio-opencode@latest` plugin entry
- the `/studio` command entry

If you prefer a persistent global CLI instead of a one-shot runner:

```bash
npm install -g pi-studio-opencode
pi-studio-opencode install
```

For a project-local install instead of a user-wide one:

```bash
bunx pi-studio-opencode@latest install --project
npx pi-studio-opencode@latest install --project
```

Then restart OpenCode and run:

```text
/studio
```

> `bunx` / `npx` are recommended because `pi-studio-opencode` is primarily used as a CLI installer here. A plain `npm install` by itself only downloads the package; it does not update your OpenCode config or register the `/studio` command.

## Manual config

If you prefer to edit config yourself, add this to either:

- `.opencode/opencode.jsonc`
- `~/.config/opencode/opencode.json`
- `~/.config/opencode/opencode.jsonc`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["pi-studio-opencode@latest"],
  "command": {
    "studio": {
      "template": "Open π Studio for this active opencode session.",
      "description": "Open π Studio attached to the current opencode session"
    }
  }
}
```

## Notes

- `/studio` opens a browser-based Studio linked to the current OpenCode session.
- If `/studio` gets sent to the model as ordinary text, the plug-in probably did not load. Rebuild or reinstall the package, then fully restart OpenCode.
- If you use `--no-open`, open the full tokenized URL shown by Studio, not just the bare port root.
- `--base-url`, `--session`, and `--directory` are taken from the active OpenCode session during `/studio`.
- The Studio UI is external to OpenCode; it is not an embedded pane.
- Preview and PDF quality depend on local tooling:
  - `pandoc` for preview/PDF workflows
  - `xelatex` for PDF export

## Standalone launcher

You can also launch the browser surface directly:

```bash
pi-studio-opencode --directory "/path/to/project"
```

or:

```bash
npx pi-studio-opencode --directory "/path/to/project"
```

To attach manually to an existing OpenCode server/session:

```bash
pi-studio-opencode --base-url "http://127.0.0.1:4096" --session "<session-id>" --directory "/path/to/project"
```

