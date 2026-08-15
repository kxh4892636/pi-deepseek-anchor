# pi-deepseek-anchor

> [English](./README.md)

**DeepSeek V4 Pro 明明能在 Project2 拿到 98–99 分，pi 的默认全量工具目录却经常让它从第一轮就把分数扔了。** DeepSeek V4 Pro 会强烈依赖 API 里可见的工具 schema：看到全量工具，它往往以 *"Let me…"* 开局、滑进 standard 轨迹；看到官方 Minimal 工具对（`bash` + `str_replace_editor`），它以 *"We need…"* 开局、`let me` 为零。这个 pi 扩展让你一个会话同时拥有两者：**请求 #1 锁定官方 Minimal schema 与 persona，请求 #2 起自动恢复 pi 的完整工具目录。** 一个工具都不少，只是把那个糟糕的开局换掉了。

## 安装

```bash
pi install npm:pi-deepseek-anchor
```

或直接从 GitHub 安装：

```bash
pi install git:github.com/kxh4892636/pi-deepseek-anchor@v1.0.0
```

然后 `/reload` 或重启 pi。就这么简单——请求 #1 被锚定，请求 #2 起满血运行。可直接使用**满血 DeepSeek V4 Pro 正式版**，不需要量化版或蒸馏替代品。

手动安装兜底：把 `index.ts` 复制到 `~/.pi/agent/extensions/anchored-standard/index.ts`（全局）或 `<project>/.pi/extensions/anchored-standard/index.ts`（项目级）。

## 它做什么

| | 请求 #1（bootstrap） | 请求 #2+（promote 后） |
| --- | --- | --- |
| 工具目录 | `bash` + `str_replace_editor` — 与官方 Minimal 预设逐字节一致 | pi 完整工具目录 |
| 系统提示 | `You are a helpful software engineer assistant.`（46 字符） | persona 保持（上游 `complete: true`）；被剥离的 pi 上下文以 user message 返回 |
| 输出预算 | adapter 默认（不封顶；`bootstrapMaxTokens` 为 opt-in） | adapter 默认 |

晋升条件：首次持久信号（默认 `promoteOn: "either"` — 首个 assistant message 或首个 tool call，先到者为准）。阶段状态持久化，`/resume` 与 reload 不会丢失。

## 为什么有效

DeepSeek V4 Pro 会强烈依赖 API 中可见的工具目录选择执行轨迹。上游 Project2 评测中，Standard 与 PTC 得分为 91、92，官方 Minimal 得分为 99、96。上游 issue #11 证明了决定变量：在 adapter 默认 maxTokens 下，Minimal 工具 schema 5/5 锚定、`let me` 为 0，而所有 standard 系 schema 11/11 落入 standard-like 行为。不需要输出封顶——工具 schema 本身就能完成锚定。

## 对 pi 的适配

上游是 DeepSeek Harness preset，本仓库是 pi 扩展，把上游机制逐一映射到 pi 扩展 API：

| 上游（dsh preset） | pi 移植 |
| --- | --- |
| Minimal 预设工具行 | `pi.registerTool` 覆盖：`bash` 使用与官方 Minimal 逐字节一致的持久 shell 描述、执行委托给 pi 内置 `createBashTool`；`str_replace_editor` 按官方 schema 实现并复刻上游文件语义（`view` / `create` / `str_replace` / `insert`、16000 字符截断、逐字错误文案） |
| `tool-bootstrap` pre-step 过滤器 | `before_agent_start` + `before_provider_request`：请求 #1 保持 Minimal-exact，晚追加内容（如 pi-memory）在请求 #1 **丢弃**、promote 后**移入 user message** |
| persona 行 `complete: true` | `minimalPersona` + `personaScope: "always"`（默认）：persona 整个会话都是系统提示；被剥离的工作区上下文从请求 #2 起以 user message 重新注入 |
| 持久 `tool/call` / `assistant/message` 扫描 | 基于 pi 持久 session branch + `dsh-anchored-state` custom entry 推导阶段 |
| Zero-Anchored Standard 模式 | `PI_DSH_ANCHOR_CONFIG` 设 `zeroAnchor: true` |

## 满血 DeepSeek V4 Pro 正式版验证

端到端验证（`--mode rpc`、官方 `deepseek-v4-pro`、`reasoningEffort=max`）：

```text
REQ#1: tools=[bash, str_replace_editor]
       system='You are a helpful software engineer assistant.' (46 字符)
       首段思维链: "We need answer briefly about repository. Need inspect. Use tools."
REQ#2: 完整 26 工具目录 + 常规 pi 上下文（以 user message 注入）
```

## 配置

编辑 `index.ts` 中的 `DEFAULT_CONFIG`，或运行时通过环境变量覆盖：

```json
{"promoteOn": "tool-call", "bootstrapMaxTokens": 1024, "personaScope": "always"}
```

配置项：`bootstrapTools`（默认 `["bash","str_replace_editor"]`）、`promoteOn`（`either` | `tool-call` | `assistant-message`）、`bootstrapMaxTokens`（可选，不设 = 不封顶）、`minimalPersona`（默认 `true`）、`personaScope`（`always` | `bootstrap`，默认 `always`）、`personaText`、`stripContext`、`zeroAnchor`（默认 `false`）、`zeroAnchorText`、`editorMaxOutputChars`（默认 `16000`）。

## 验证与调试

- `/dsh-anchor` 显示当前阶段；`/dsh-anchor promote` 立即晋升，`/dsh-anchor on|off` 为当前会话重新开启/关闭 bootstrap。
- TUI 底栏在晋升前显示 `bootstrap: bash/str_replace_editor`。
- `PI_DSH_ANCHOR_DEBUG=1` 会把组装后的 payload 写入 `PI_DSH_ANCHOR_DEBUG_FILE`（默认 `/tmp/dsh-anchor-debug.jsonl`）。

## 类型检查

```bash
npx tsc -p tsconfig.check.json
```

请按本机 pi 类型定义的实际位置调整 `tsconfig.check.json` 中的三个 `paths`。

## 文件

- `package.json` — pi 包 manifest（`pi.extensions`、`pi-package` keyword）
- `index.ts` — pi 扩展本体（单文件、零运行时依赖）
- `tsconfig.check.json` — 类型检查配置
- `LICENSE` — MIT（保留上游版权声明）
- `NOTICE` — 上游衍生说明

## 许可证

MIT。`index.ts` 是对 MIT 许可的上游 preset 的忠实移植，原始版权声明已保留。

## 上游项目

本项目是 **[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)** 的 pi 移植，README 与方法论均以该上游为基准：

- 上游仓库：https://github.com/xiaobright/dsh-anchored-standard
- 上游 README：[English](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.md) · [中文](https://github.com/xiaobright/dsh-anchored-standard/blob/main/README.zh-CN.md)

感谢 [`xiaobright`](https://github.com/xiaobright) 与 DeepSeek Harness 社区提供的原始预设、方法与评测数据。
