# pi-custom-header

**English** | [中文](./README.md)

A plugin that gives Pi dynamic request-header overrides, with provider defaults and dedicated Claude Code, Codex, or other templates for selected models, fully compatible with `pi-maestro-teammate` child agent processes.

It generates per-session / per-turn **dynamic** values (session id, Codex turn metadata, request id, …) that static `models.json` headers cannot express.

## Why

pi lets you set static `headers` per provider/model in `models.json`, but static config cannot produce values that follow the session id or change every turn. This extension runs **after** pi assembles the static headers (so it can override them) and fills the dynamic values at request time from `ctx`.

A provider rule can set default headers for a gateway, while model rules select dedicated client templates. For example, `Axon` can default to `custom.headers`, with `gpt-5.5` using the Codex template and `claude-opus-4-8` using the Claude Code template. When a model rule matches, it replaces the provider template completely, so headers from different clients are never mixed.

## Install

```bash
pi install /absolute/path/to/pi-custom-header     # local package
# or, once published: pi install npm:pi-custom-header
```

Installing only registers the code — **nothing is scaffolded automatically**. Without a `config.json` the extension has no rules and passes every request through untouched (the only file ever auto-generated is `installation-id`, on first use). So copy the example config and templates into the user config directory yourself, then reload:

```bash
# user config dir: ~/.pi/agent/extensions/pi-custom-header/
mkdir -p ~/.pi/agent/extensions/pi-custom-header
cp config/config.example.json ~/.pi/agent/extensions/pi-custom-header/config.json
cp templates/*.headers        ~/.pi/agent/extensions/pi-custom-header/
```

In pi: `/reload`.

## Layout

```
Code (npm package, this repo)          User data (~/.pi/agent/extensions/pi-custom-header/)
├── index.ts                           ├── config.json            # your rules, blacklist
├── src/                               ├── claude-code.headers    # your templates (may hold real tokens)
├── templates/  (bundled defaults)     ├── codex.headers
│   ├── claude-code.headers            ├── custom.headers         # provider default template
│   ├── codex.headers                  └── installation-id        # generated on first use, machine-stable
│   └── custom.headers
└── config/config.example.json
```

- Template lookup order, first match wins: **① user extension dir, flat** (alongside `config.json`, the recommended place to edit) → **② user `templates/` subdir** (legacy layout, still supported) → **③ bundled with the package**.
- Path resolution honors `PI_CODING_AGENT_DIR` (defaults to `~/.pi/agent`).

## Configuration (`config.json`)

```json
{
  "rules": [
    { "match": { "provider": "Axon", "modelId": "gpt-5.5" }, "template": "codex.headers" },
    { "match": { "provider": "Axon", "modelIdRegex": "^claude-" }, "template": "claude-code.headers" },
    { "match": { "provider": "Axon" }, "template": "custom.headers" }
  ],
  "blacklist": ["Authorization", "Content-Length", "Host", "Content-Encoding", "Connection", "Accept-Encoding"],
  "sandbox": "windows_sandbox",
  "teammate": true,
  "inheritParentSession": true,
  "debug": false
}
```

| Field | Meaning |
|-------|---------|
| `rules` | Rule list. Exactly one template is selected by fixed **model > provider > global catch-all** scope priority; first match wins within the same scope. |
| `match.provider` | Equals `ctx.model.provider` (e.g. `Axon`). Case-sensitive. Optional. |
| `match.modelId` | Equals `ctx.model.id` (e.g. `gpt-5.5`). Case-sensitive. Optional. |
| `match.modelIdRegex` | Regex tested against `ctx.model.id` (e.g. `^claude-` covers `claude-opus-4-8/4-7/4-6`). Optional. |
| `blacklist` | Header names never written (case-insensitive). Protects auth/transport headers. |
| `sandbox` | Value for the `sandbox` field in Codex turn metadata. Default `windows_sandbox`. Valid values: `windows_sandbox`, `windows_elevated`, `seatbelt` (macOS), `seccomp` (Linux), `none` (sandbox off / danger-full-access), `external`. Must match the platform your template's `user-agent` **claims**, not necessarily the real host — e.g. if you edit the UA to macOS, set `seatbelt`. |
| `teammate` | Whether to propagate this extension to `pi-maestro-teammate` child agent subprocesses. Default `true`. Child agent processes will also load this plugin and apply headers. |
| `inheritParentSession` | In teammate child agent subprocesses, whether `{{session_id}}` inherits the main task's session ID. Default `true`. Ensures child agents share the exact session ID with the main task so prompt caches hit on the backend. |
| `debug` | Debug-logging switch, default `false`. When `true`, writes diagnostics (secrets redacted) to `pi-custom-header.log` in the user extension dir. Off by default — zero side effects. |

A rule containing `modelId` or `modelIdRegex` has model scope; a rule containing only `provider` has provider scope; an empty `match: {}` is the global catch-all. Scope priority is fixed regardless of array position, while first match still wins within one scope. Fields in a `match` are ANDed. A matching model template is used alone and does not inherit any provider-template lines. A model that matches no rule (or a request with no model) is passed through untouched. A template line whose placeholder has no registered generator is dropped (never emitted as a raw `{{token}}`).

## Templates

A template is **raw HTTP header text**, one `Key: Value` per line, split on the first `:` (values may contain `:`). Blank lines and `#` comments are ignored. Header names are unrestricted except for the blacklist: add any valid header line to `custom.headers` and it takes effect.

HTTP header names are **case-insensitive**. Before writing a template line, the extension removes every case variant of that header already present in Pi's header object, then writes the template's key and value. Existing `User-Agent` and template `user-agent` keys therefore cannot coexist; exactly one remains. If a template repeats the same header with different casing, its last line wins. For session IDs, all case variants of both `Session-Id` / `SESSION-ID` and `Session_id` / `SESSION_ID` are removed, then only the canonical hyphenated `session-id` is emitted.

Dynamic lines use `{{placeholder}}`:

| Placeholder | Value |
|-------------|-------|
| `{{session_id}}` | Current session ID (in teammate child processes with `inheritParentSession` enabled, resolves the main task's session ID to hit server caches) |
| `{{parent_session_id}}` | Parent/main task session ID |
| `{{child_session_id}}` | Child process's own session ID (equals current session ID in the main process) |
| `{{correlation_id}}` | Teammate child correlation ID (`PI_TEAMMATE_CORRELATION_ID`) |
| `{{is_teammate}}` | Whether running in a teammate child process (`"true"` or `"false"`) |
| `{{window_id}}` | `<session_id>:0` |
| `{{request_id}}` | compatibility alias for the current session id (new templates should use `{{session_id}}`) |
| `{{installation_id}}` | persisted machine-stable UUID |
| `{{codex_turn_metadata}}` | compact JSON: `installation_id, session_id, thread_id, turn_id, window_id, request_kind, thread_source, sandbox, turn_started_at_unix_ms` (field order matches the real Codex capture; `sandbox` comes from the config `sandbox` option; `workspaces` intentionally omitted) |

Placeholder values are memoized per hook fire: `{{session_id}}` and the legacy `{{request_id}}` alias both resolve to the current session id; `turn_id` is still regenerated for each hook fire. Older templates using `x-client-request-id: {{request_id}}` therefore become session-bound automatically after the plugin is updated.

### Adding a backend

For provider-wide defaults, add a rule containing only `provider`. Add `modelId` or `modelIdRegex` rules for model-specific exceptions. Add a template file if needed and reuse existing placeholders. Only a brand-new dynamic field requires adding a generator in `src/placeholders.ts`.

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

## Thanks To

[LINUX DO](https://linux.do) 

## License

MIT
