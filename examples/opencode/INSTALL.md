# opencode install example

Current reliable setup for `pi-studio-opencode` is:

1. build the local repo
2. point opencode at the local plugin path
3. add an explicit `studio` command entry
4. start a new opencode session and run `/studio`

## 1. Build the repo

```bash
cd "/absolute/path/to/pi-studio-opencode"
npm install
npm run build
```

## 2. Add plugin + command config

Use `opencode.local-path.jsonc` as the template.

Project-local example:

```bash
mkdir -p .opencode
cp "/absolute/path/to/pi-studio-opencode/examples/opencode/opencode.local-path.jsonc" ".opencode/opencode.jsonc"
```

Then edit the plugin path inside that file.

Or merge the same snippet into:

- `.opencode/opencode.jsonc` in a project, or
- `~/.config/opencode/opencode.json` / `opencode.jsonc` for user-wide install

## 3. Restart / start a new opencode session

OpenCode loads config/plugins at startup, so after editing config it is safest to start a fresh opencode session.

The normal interactive `/studio` flow now works from plain opencode:

```bash
opencode
```

## 4. Launch Studio

Inside the active opencode session:

```text
/studio
```

Optional launcher flags can be forwarded after the command, for example:

```text
/studio --no-open --port 4312
```

## Notes

- `--base-url`, `--session`, and `--directory` are always taken from the current active opencode session.
- User-supplied values for those launcher flags are intentionally ignored.
- You do **not** need `opencode --port 4096` for the normal interactive `/studio` flow anymore.
- If you use `--no-open`, open the full tokenized Studio URL shown by the Studio toast/log, not just `http://127.0.0.1:<port>/`.
- If `/studio` gets sent to the model as ordinary text, the plugin likely did not load; rebuild the repo, then fully restart opencode.
- The browser UI is external and linked to the same opencode session; this is not a native embedded pane.
