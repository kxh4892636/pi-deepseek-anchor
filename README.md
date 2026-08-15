# pi-deepseek-anchor

> [中文说明](./README.zh-CN.md)

**DeepSeek V4 Pro can score 98–99 on Project2 — but pi's default tool catalog often makes it throw that away on the very first turn.** DeepSeek V4 Pro conditions heavily on the API-visible tool schema. With the full catalog it tends to open with *"Let me…"* and a standard-mode trajectory; with the official Minimal pair (`bash` + `str_replace_editor`) it opens with *"We need…"* and zero `let me`. This pi extension gives you both in one session: **request #1 is locked to the official Minimal schema and persona, then your full pi tool catalog comes back automatically from request #2 on.** You keep every tool. You only lose the bad first turn.

## Install

```bash
pi install npm:pi-deepseek-anchor
```

Or straight from GitHub:

```bash
pi install git:github.com/kxh4892636/pi-deepseek-anchor@v1.0.0
```

Then `/reload` or restart pi. That's it — request #1 is anchored, request #2+ is full power. Works with the **full-powered DeepSeek V4 Pro official release**; no quantized or distilled substitutes needed.

Manual fallback: copy `index.ts` to `~/.pi/agent/extensions/anchored-standard/index.ts` (global) or `<project>/.pi/extensions/anchored-standard/index.ts` (project-local).

## What it does

| | Request #1 (bootstrap) | Request #2+ (promoted) |
| --- | --- | --- |
| Tools | `bash` + `str_replace_editor` — byte-identical to the official Minimal preset | full pi tool catalog |
| System prompt | `You are a helpful software engineer assistant.` (46 chars) | persona stays (upstream `complete: true`); stripped pi context returns as a user message |
| Output budget | adapter default (no cap; `bootstrapMaxTokens` is opt-in) | adapter default |

Promotion fires on the first durable signal — `promoteOn: "either"` (default) means the first assistant message **or** the first tool call, whichever comes first. Phase state is durable, so `/resume` and reload preserve it.

## Why this works

DeepSeek V4 Pro conditions strongly on the API-visible tool catalog. In the upstream Project2 evaluation, Standard and PTC scored 91 and 92, while the official Minimal preset scored 99 and 96. Upstream issue #11 measured the decisive variable: at adapter-default maxTokens, the Minimal tool-schema identity anchored 5/5 runs with zero `let me` first lines, while every standard-family schema fell into standard-like behavior 11/11. No output cap is required — the tool schema alone does the anchoring.

## pi adaptation

The upstream repo is a DeepSeek Harness preset. This repo is a pi extension that maps every upstream mechanism onto pi's extension API:

| Upstream (dsh preset) | pi port |
| --- | --- |
| Minimal preset tool rows | `pi.registerTool` overrides: `bash` uses the byte-identical Minimal persistent-shell description and delegates execution to pi's built-in `createBashTool`; `str_replace_editor` implements the official schema and upstream filesystem semantics (`view` / `create` / `str_replace` / `insert`, 16000-char truncation, exact error messages) |
| `tool-bootstrap` pre-step filter | `before_agent_start` + `before_provider_request`: request #1 is Minimal-exact; late appends (e.g. pi-memory) are **dropped** on request #1 and **moved to a user message** after promotion |
| Persona row with `complete: true` | `minimalPersona` + `personaScope: "always"` (default): the persona stays the system prompt for the whole session; stripped workspace context is re-delivered as a user message from request #2 on |
| Durable `tool/call` / `assistant/message` scan | promotion state derived from pi's durable session branch + a `dsh-anchored-state` custom entry |
| Zero-Anchored Standard mode | `zeroAnchor: true` in `PI_DSH_ANCHOR_CONFIG` |

## Verified with full-powered DeepSeek V4 Pro

End-to-end (`--mode rpc`, official `deepseek-v4-pro`, `reasoningEffort=max`):

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

- `/dsh-anchor` prints the phase; `/dsh-anchor promote` promotes now, `/dsh-anchor on|off` re-arms/disables the bootstrap for this session.
- The TUI footer shows `bootstrap: bash/str_replace_editor` until promotion.
- `PI_DSH_ANCHOR_DEBUG=1` dumps assembled payloads to `PI_DSH_ANCHOR_DEBUG_FILE` (default `/tmp/dsh-anchor-debug.jsonl`).

## Type check

```bash
npx tsc -p tsconfig.check.json
```

Adjust the three `paths` entries in `tsconfig.check.json` to your installed pi type-definition locations.

## Files

- `package.json` — pi package manifest (`pi.extensions`, `pi-package` keyword)
- `index.ts` — the pi extension (single file, zero runtime deps)
- `tsconfig.check.json` — type-check config
- `LICENSE` — MIT, including upstream copyright notices
- `NOTICE` — upstream derivation notice

## License

MIT. `index.ts` is a faithful port of the MIT-licensed upstream preset; the original copyright notices are retained.

## Upstream

This project is a pi port of **[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)**. The upstream README and methodology are the basis for this port:

- Upstream repo: https://github.com/xiaobright/dsh-anchored-standard
- Upstream README: [English](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.md) · [中文](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.zh-CN.md)

Thanks to [`xiaobright`](https://github.com/xiaobright) and the DeepSeek Harness community for the original preset, methodology, and measurements.
