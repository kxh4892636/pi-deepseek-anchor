# pi-deepseek-anchor

> 中文说明：[README.zh-CN.md](./README.zh-CN.md)

pi-deepseek-anchor keeps DeepSeek V4 Pro on the Minimal-anchored trajectory in pi: request #1 uses the official Minimal tool pair and persona, and request #2 onward automatically restores the full pi tool catalog.

**Problem.** DeepSeek V4 Pro selects its trajectory based on the API-visible tool catalog. With the default full catalog, the first response typically starts with "Let me..." and follows the Standard trajectory (Project2: 91–92). With the official Minimal pair (`bash` + `str_replace_editor`), the first response starts with "We need..." and produces zero `let me` (Project2: 98–99). Staying on Minimal permanently loses the full toolset. This extension applies Minimal only to request #1 and restores the full catalog from request #2, so both are retained in one session.

## Install

```bash
pi install npm:pi-deepseek-anchor
```

Or from GitHub:

```bash
pi install git:github.com/kxh4892636/pi-deepseek-anchor@v1.0.0
```

Then `/reload` or restart pi. Works with the full-powered DeepSeek V4 Pro official release.

Manual fallback: copy `index.ts` to `~/.pi/agent/extensions/anchored-standard/index.ts` (global) or `<project>/.pi/extensions/anchored-standard/index.ts` (project-local).

## Behavior

| | Request #1 (bootstrap) | Request #2+ (promoted) |
| --- | --- | --- |
| Tools | `bash` + `str_replace_editor`, byte-identical to the official Minimal preset | full pi tool catalog |
| System prompt | `You are a helpful software engineer assistant.` (46 chars) | persona remains; stripped pi context returns as a user message |
| Output budget | adapter default (no cap; `bootstrapMaxTokens` is opt-in) | adapter default |

Promotion fires on the first durable signal: the first assistant message or the first tool call, whichever comes first (`promoteOn: "either"` default). State is durable, so `/resume` and reload preserve the phase.

## pi adaptation

| Upstream (dsh preset) | pi port |
| --- | --- |
| Minimal tool rows | `pi.registerTool` overrides: `bash` uses the byte-identical Minimal description and delegates to pi's built-in `createBashTool`; `str_replace_editor` implements the official schema and upstream filesystem semantics (`view` / `create` / `str_replace` / `insert`, 16000-char truncation, exact error messages) |
| `tool-bootstrap` pre-step filter | `before_agent_start` + `before_provider_request`: request #1 is Minimal-exact; late appends (e.g. pi-memory) are dropped on request #1 and moved to a user message after promotion |
| Persona row (`complete: true`) | `minimalPersona` + `personaScope: "always"` (default): persona remains the system prompt for the whole session; stripped context is re-delivered as a user message from request #2 |
| Durable event scan | phase derived from pi's durable session branch plus a `dsh-anchored-state` custom entry |
| Zero-Anchored Standard mode | `zeroAnchor: true` in `PI_DSH_ANCHOR_CONFIG` |

## Verification

End-to-end with official `deepseek-v4-pro`, `reasoningEffort=max`, `--mode rpc`:

```text
REQ#1: tools=[bash, str_replace_editor]
       system='You are a helpful software engineer assistant.' (46 chars)
       first thinking: "We need answer briefly about repository. Need inspect. Use tools."
REQ#2: full 26-tool catalog + normal pi context (delivered as a user message)
```

## Configuration

Edit `DEFAULT_CONFIG` in `index.ts`, or override at runtime:

```json
{"promoteOn": "tool-call", "bootstrapMaxTokens": 1024, "personaScope": "always"}
```

Keys: `bootstrapTools` (default `["bash","str_replace_editor"]`), `promoteOn` (`either` | `tool-call` | `assistant-message`), `bootstrapMaxTokens` (optional; unset = no cap), `minimalPersona` (default `true`), `personaScope` (`always` | `bootstrap`, default `always`), `personaText`, `stripContext`, `zeroAnchor` (default `false`), `zeroAnchorText`, `editorMaxOutputChars` (default `16000`).

## Verify & debug

- `/dsh-anchor` prints the phase; `/dsh-anchor promote` promotes now; `/dsh-anchor on|off` re-arms/disables the bootstrap for the session.
- The TUI footer shows `bootstrap: bash/str_replace_editor` until promotion.
- `PI_DSH_ANCHOR_DEBUG=1` dumps assembled payloads to `PI_DSH_ANCHOR_DEBUG_FILE` (default `/tmp/dsh-anchor-debug.jsonl`).

## Type check

```bash
npx tsc -p tsconfig.check.json
```

Adjust the three `paths` entries in `tsconfig.check.json` to the installed pi type-definition locations.

## Files

- `package.json` — pi package manifest
- `index.ts` — pi extension (single file, zero runtime deps)
- `README.zh-CN.md` — Chinese documentation
- `tsconfig.check.json` — type-check config
- `LICENSE` — MIT, including upstream copyright notices
- `NOTICE` — upstream derivation notice

## License

MIT. `index.ts` is a port of the MIT-licensed upstream preset; original copyright notices are retained.

## Upstream

This project is a pi port of [`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard). The upstream README and methodology are the basis for this port:

- Repository: https://github.com/xiaobright/dsh-anchored-standard
- README: [English](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.md) · [中文](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.zh-CN.md)
