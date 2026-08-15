# pi-deepseek-anchor

[English](#english) · [中文](#中文) · [上游项目 / Upstream](#upstream)

A **pi extension** port of
[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard):
it anchors the **full-powered DeepSeek V4 Pro official release** into the
Minimal-mode trajectory on the first request (`bash` + `str_replace_editor`,
Minimal persona, zero `let me` first lines), then restores pi's complete tool
catalog from request #2 on. You get the full Standard toolset **and** the
Minimal-anchored first reasoning trajectory in the same session.

> Community project. This is not an official pi preset, not an official
> DeepSeek preset, and it is not affiliated with or endorsed by DeepSeek.

---

## English

### Why

DeepSeek V4 Pro conditions strongly on the API-visible tool catalog. In the
upstream Project2 evaluation, Standard and PTC scored 91 and 92, while the
official Minimal preset scored 99 and 96 — but staying on Minimal permanently
gives up the Standard toolset. Upstream issue #11 measured the decisive
first-request variable: at the adapter-default maxTokens, the **Minimal tool
schema identity** (`bash` + `str_replace_editor`) anchored 5/5 runs with zero
`let me` first lines, while every standard-family schema fell into
standard-like behavior 11/11. No output cap is needed.

This extension reproduces that two-phase behavior inside pi:

| | Request #1 (bootstrap) | Request #2+ (promoted) |
| --- | --- | --- |
| Tools | `bash` + `str_replace_editor` — the official Minimal preset's exact pair, byte-identical schemas | full pi tool catalog |
| System prompt | `You are a helpful software engineer assistant.` (46 chars) | persona stays (upstream `complete: true`); stripped pi context returns as a user message |
| Output budget | adapter default (no cap; `bootstrapMaxTokens` is opt-in) | adapter default |

Promotion happens on the first durable signal — `promoteOn: "either"` (default)
means the first assistant message **or** the first tool call, whichever comes
first. The phase is derived from durable session entries, so `/resume` and
reload preserve it.

### pi adaptation (differences from upstream)

The upstream repo is a DeepSeek Harness preset. This repo is a **pi extension**
that maps every upstream mechanism onto the pi extension API:

| Upstream (dsh preset) | pi port (extension hooks) |
| --- | --- |
| Minimal preset tool rows | `pi.registerTool` overrides: `bash` keeps the byte-identical Minimal persistent-shell description and delegates execution to pi's built-in `createBashTool`; `str_replace_editor` implements the official schema and upstream filesystem semantics (`view` / `create` / `str_replace` / `insert`, 16000-char truncation, exact error messages) |
| `tool-bootstrap` pre-step filter | `before_agent_start` + `before_provider_request`: request #1 is Minimal-exact; late appends (e.g. pi-memory) are **dropped** on request #1 and **moved to a user message** after promotion |
| Persona row with `complete: true` | `minimalPersona` + `personaScope: "always"` (default): the persona is the system prompt for the whole session; stripped workspace context is re-delivered as a user message from request #2 on |
| Durable `tool/call` / `assistant/message` scan | promotion state derived from pi's durable session branch + `dsh-anchored-state` custom entry |
| Zero-Anchored Standard mode | `zeroAnchor: true` in `PI_DSH_ANCHOR_CONFIG` |

### Verified with full-powered DeepSeek V4 Pro

End-to-end verification (`--mode rpc`, official `deepseek-v4-pro`,
`reasoningEffort=max`):

```text
REQ#1: tools=[bash, str_replace_editor]
       system='You are a helpful software engineer assistant.' (46 chars)
       first thinking: "We need answer briefly about repository. Need inspect. Use tools."
REQ#2: full 26-tool catalog + normal pi context (delivered as a user message)
```

No quantization substitutes or distilled variants are required — this works
with the full DeepSeek V4 Pro official endpoint.

### Install

Copy `index.ts` into one of pi's extension roots:

```text
~/.pi/agent/extensions/anchored-standard/index.ts      # global
<project>/.pi/extensions/anchored-standard/index.ts    # project-local (trusted project only)
```

Then reload pi (`/reload`) or restart it. No npm dependencies at runtime —
`typebox`, `@earendil-works/pi-ai`, and `@earendil-works/pi-coding-agent` are
provided by pi's extension runtime.

### Configuration

Edit `DEFAULT_CONFIG` in `index.ts`, or override at runtime:

```json
{"promoteOn": "tool-call", "bootstrapMaxTokens": 1024, "personaScope": "always"}
```

Keys: `bootstrapTools` (default `["bash","str_replace_editor"]`),
`promoteOn` (`either` | `tool-call` | `assistant-message`),
`bootstrapMaxTokens` (optional; unset = no cap),
`minimalPersona` (default `true`),
`personaScope` (`always` | `bootstrap`, default `always`),
`personaText`,
`stripContext`,
`zeroAnchor` (default `false`),
`zeroAnchorText`,
`editorMaxOutputChars` (default `16000`).

### Verify & debug

- `/dsh-anchor` prints the phase; `/dsh-anchor promote` promotes now,
  `/dsh-anchor on|off` re-arms/disables the bootstrap for this session.
- The TUI footer shows `bootstrap: bash/str_replace_editor` until promotion.
- `PI_DSH_ANCHOR_DEBUG=1` dumps assembled payloads to
  `PI_DSH_ANCHOR_DEBUG_FILE` (default `/tmp/dsh-anchor-debug.jsonl`).

### Type check

```bash
npx tsc -p tsconfig.check.json
```

Adjust the three `paths` entries in `tsconfig.check.json` to your installed pi
type-definition locations.

### Files

- `index.ts` — the pi extension (single file, zero runtime deps)
- `tsconfig.check.json` — type-check config
- `LICENSE` — MIT, including upstream copyright notices
- `NOTICE` — upstream derivation notice

### License

MIT. `index.ts` is a faithful port of the MIT-licensed upstream preset; the
original copyright notices are retained.

---

## 中文

### 为什么

DeepSeek V4 Pro 会强烈依赖 API 中可见的工具目录选择执行轨迹。上游 Project2
评测中，Standard 与 PTC 得分为 91、92，官方 Minimal 得分为 99、96；但若全程
停留在 Minimal，会失去 Standard 的完整工具集。上游 issue #11 证明首轮锚定的
决定变量是 **Minimal 工具 schema 本身**（`bash` + `str_replace_editor`）：
在 adapter 默认 maxTokens 下 5/5 锚定、`let me` 为 0，而所有 standard 系
schema 11/11 落入 standard-like 行为。无需输出封顶。

本扩展把上游的两阶段行为完整移植到 pi：

| | 请求 #1（bootstrap） | 请求 #2+（promote 后） |
| --- | --- | --- |
| 工具目录 | `bash` + `str_replace_editor` — 官方 Minimal 预设原样工具对（schema 逐字节一致） | pi 完整工具目录 |
| 系统提示 | `You are a helpful software engineer assistant.`（46 字符） | persona 保持（上游 `complete: true`）；被剥离的 pi 上下文以 user message 返回 |
| 输出预算 | adapter 默认（不封顶；`bootstrapMaxTokens` 为 opt-in） | adapter 默认 |

晋升条件：首次持久信号（默认 `promoteOn: "either"` — 首个 assistant message
或首个 tool call，先到者为准）。阶段从持久会话记录推导，`/resume` 与 reload
不会丢失状态。

### 对 pi 的适配说明

上游是 DeepSeek Harness preset，本仓库是 **pi 扩展**，把上游机制逐一映射到
pi 扩展 API：

| 上游（dsh preset） | pi 移植（扩展钩子） |
| --- | --- |
| Minimal 预设工具行 | `pi.registerTool` 覆盖：`bash` 使用与官方 Minimal 逐字节一致的持久 shell 描述、执行委托给 pi 内置 `createBashTool`；`str_replace_editor` 按官方 schema 实现，并复刻上游文件语义（`view` / `create` / `str_replace` / `insert`、16000 字符截断、逐字错误文案） |
| `tool-bootstrap` pre-step 过滤器 | `before_agent_start` + `before_provider_request`：请求 #1 保持 Minimal-exact，晚追加内容（如 pi-memory）在请求 #1 **丢弃**、promote 后**移入 user message** |
| persona 行 `complete: true` | `minimalPersona` + `personaScope: "always"`（默认）：persona 整个会话都是系统提示；被剥离的工作区上下文从请求 #2 起以 user message 重新注入 |
| 持久 `tool/call` / `assistant/message` 扫描 | 基于 pi 持久 session branch + `dsh-anchored-state` custom entry 推导阶段 |
| Zero-Anchored Standard 模式 | `PI_DSH_ANCHOR_CONFIG` 设 `zeroAnchor: true` |

### 满血 DeepSeek V4 Pro 正式版验证

已在 `--mode rpc`、官方 `deepseek-v4-pro`、`reasoningEffort=max` 下端到端验证：

```text
REQ#1: tools=[bash, str_replace_editor]
       system='You are a helpful software engineer assistant.' (46 字符)
       首段思维链: "We need answer briefly about repository. Need inspect. Use tools."
REQ#2: 完整 26 工具目录 + 常规 pi 上下文（以 user message 注入）
```

不需要任何量化版或蒸馏替代品，可直接使用**满血 DeepSeek V4 Pro 正式版**
（官方端点）。

### 安装

把 `index.ts` 复制到 pi 的扩展目录之一：

```text
~/.pi/agent/extensions/anchored-standard/index.ts      # 全局
<project>/.pi/extensions/anchored-standard/index.ts    # 项目级（仅可信项目）
```

然后 `/reload` 或重启 pi。运行时不依赖任何 npm 包——`typebox`、
`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent` 由 pi 扩展运行时提供。

### 配置

编辑 `index.ts` 中的 `DEFAULT_CONFIG`，或运行时通过环境变量覆盖：

```json
{"promoteOn": "tool-call", "bootstrapMaxTokens": 1024, "personaScope": "always"}
```

配置项：`bootstrapTools`（默认 `["bash","str_replace_editor"]`）、
`promoteOn`（`either` | `tool-call` | `assistant-message`）、
`bootstrapMaxTokens`（可选，不设 = 不封顶）、
`minimalPersona`（默认 `true`）、
`personaScope`（`always` | `bootstrap`，默认 `always`）、
`personaText`、`stripContext`、
`zeroAnchor`（默认 `false`）、`zeroAnchorText`、
`editorMaxOutputChars`（默认 `16000`）。

### 验证与调试

- `/dsh-anchor` 显示当前阶段；`/dsh-anchor promote` 立即晋升，
  `/dsh-anchor on|off` 为当前会话重新开启/关闭 bootstrap。
- TUI 底栏在晋升前显示 `bootstrap: bash/str_replace_editor`。
- `PI_DSH_ANCHOR_DEBUG=1` 会把组装后的 payload 写入
  `PI_DSH_ANCHOR_DEBUG_FILE`（默认 `/tmp/dsh-anchor-debug.jsonl`）。

### 类型检查

```bash
npx tsc -p tsconfig.check.json
```

请按本机 pi 类型定义的实际位置调整 `tsconfig.check.json` 中的三个 `paths`。

### 文件

- `index.ts` — pi 扩展本体（单文件、零运行时依赖）
- `tsconfig.check.json` — 类型检查配置
- `LICENSE` — MIT（保留上游版权声明）
- `NOTICE` — 上游衍生说明

### 许可证

MIT。`index.ts` 是对 MIT 许可的上游 preset 的忠实移植，原始版权声明已保留。

---

## Upstream

本项目 README 参考并移植自以下上游仓库：

- 上游仓库：**[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)**
- 上游 README：[`README.md`](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.md) ·
  [`README.zh-CN.md`](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.zh-CN.md)

Thanks to [`xiaobright`](https://github.com/xiaobright) and the DeepSeek Harness
community for the original preset, methodology, and measurements.
