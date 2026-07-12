# pi-custom-header

A configurable [`before_provider_headers`](https://) extension for the **pi coding agent**. It matches each request by **provider + model** and injects a full set of request headers — including the per-session / per-turn **dynamic** values that `models.json` static overrides cannot express (session id, Codex turn metadata, request id) — so pi's outbound requests can mirror an official client (Claude Code, Codex).

## Why

pi lets you set static `headers` per provider/model in `models.json`, but static config cannot produce values that follow the session id or change every turn. This extension runs **after** pi assembles the static headers (so it can override them) and fills the dynamic values at request time from `ctx`.

It matches at the **model** level on purpose: one gateway provider (e.g. `Axon`) can front models from several vendors — `gpt-5.5` should look like Codex, `claude-opus-4-8` like Claude Code, and `deepseek`/`glm`/`grok` should be left untouched. Provider-only matching can't tell them apart.

## Install

```bash
pi install /absolute/path/to/pi-custom-header     # local package
# or, once published: pi install npm:pi-custom-header
```

Then copy the example config and templates into the user config directory and reload:

```bash
# user config dir: ~/.pi/agent/extensions/pi-custom-header/
mkdir -p ~/.pi/agent/extensions/pi-custom-header/templates
cp config/config.example.json ~/.pi/agent/extensions/pi-custom-header/config.json
cp templates/*.headers        ~/.pi/agent/extensions/pi-custom-header/templates/
```

In pi: `/reload`.

## Layout

```
Code (npm package, this repo)          User data (~/.pi/agent/extensions/pi-custom-header/)
├── index.ts                           ├── config.json        # your rules, blacklist, sandbox
├── src/                               ├── templates/         # your header templates (may hold real tokens)
├── templates/  (bundled defaults)     │   ├── claude-code.headers
│   ├── claude-code.headers            │   └── codex.headers
│   └── codex.headers                  └── installation-id    # generated, machine-stable
└── config/config.example.json
```

- Templates and config are read from the **user directory first**, falling back to the bundled defaults.
- Path resolution honors `PI_CODING_AGENT_DIR` (defaults to `~/.pi/agent`).

## Configuration (`config.json`)

```json
{
  "rules": [
    { "match": { "provider": "Axon", "modelId": "gpt-5.5" }, "template": "codex.headers" },
    { "match": { "provider": "Axon", "modelIdRegex": "^claude-" }, "template": "claude-code.headers" }
  ],
  "blacklist": ["Authorization", "Content-Length", "Host", "Content-Encoding", "Connection", "Accept-Encoding"],
  "unknownPlaceholder": "drop-line",
  "sandbox": "windows_sandbox"
}
```

| Field | Meaning |
|-------|---------|
| `rules` | Ordered list. **First match wins.** Each rule maps a `match` to a `template` file name. |
| `match.provider` | Equals `ctx.model.provider` (e.g. `Axon`). Case-sensitive. Optional. |
| `match.modelId` | Equals `ctx.model.id` (e.g. `gpt-5.5`). Case-sensitive. Optional. |
| `match.modelIdRegex` | Regex tested against `ctx.model.id` (e.g. `^claude-` covers `claude-opus-4-8/4-7/4-6`). Optional. |
| `blacklist` | Header names never written (case-insensitive). Protects auth/transport headers. |
| `unknownPlaceholder` | `drop-line` (default) drops a line whose placeholder has no generator; `keep` leaves the raw `{{token}}`. |
| `sandbox` | Value for the Codex turn-metadata `sandbox` field. |

Fields present in a `match` are ANDed. An empty `match: {}` is a catch-all — use with care. A model that matches no rule (or a request with no model) is passed through untouched.

## Templates

A template is **raw HTTP header text**, one `Key: Value` per line, split on the first `:` (values may contain `:`). Blank lines and `#` comments are ignored. Key casing and order are preserved to match captures byte-for-byte.

Dynamic lines use `{{placeholder}}`:

| Placeholder | Value |
|-------------|-------|
| `{{session_id}}` | `ctx.sessionManager.getSessionId()` |
| `{{window_id}}` | `<session_id>:0` |
| `{{request_id}}` | fresh UUID v7 |
| `{{installation_id}}` | persisted machine-stable UUID |
| `{{codex_turn_metadata}}` | compact JSON: `installation_id, session_id, thread_id, turn_id, window_id, request_kind, thread_source, sandbox, turn_started_at_unix_ms` (field order matches the real Codex capture; `workspaces` intentionally omitted) |

Placeholder values are memoized per hook fire (every `{{session_id}}` in one request is identical; `request_id`/`turn_id` are generated once per fire).

### Adding a backend

Most of the time: add one `rule` and (if needed) one template file, reusing existing placeholders. Only a brand-new dynamic field requires adding a generator in `src/placeholders.ts`.

## Safety

- **`Authorization` must stay blacklisted.** Templates transcribed from captures may contain a real `Bearer` token; the blacklist ensures the extension never overwrites pi's real credential.
- **Never commit real tokens or `installation-id`.** The in-repo templates use placeholders only. `.gitignore` guards against committing `installation-id` and `*.local.headers` / `*.real.headers`.
- Every failure path (missing/broken config, unreadable template, absent model, bad regex) degrades to **transparent passthrough** — the extension never throws or blocks a provider request.

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # unit + integration
```

## License

MIT
