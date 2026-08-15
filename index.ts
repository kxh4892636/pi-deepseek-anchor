/**
 * dsh-anchored-standard for pi
 *
 * A faithful port of https://github.com/xiaobright/dsh-anchored-standard
 * (MIT) to the pi extension API. It reproduces the two-phase DeepSeek
 * Harness preset that anchors DeepSeek V4 Pro into the Minimal-mode
 * trajectory while keeping the full Standard tool catalog:
 *
 * Phase 1 — bootstrap (first model request only):
 *   - The API-visible tool catalog is narrowed to the OFFICIAL Minimal
 *     preset's exact tool pair: `bash` + `str_replace_editor`. This schema
 *     identity — not the output budget — is the decisive first-request
 *     variable (upstream issue #11: the Minimal pair anchored 5/5 runs
 *     with zero `let me` first-lines, while every standard-family schema
 *     such as bash/read fell into standard-like behavior 11/11).
 *   - The whole system prompt is replaced by the Minimal persona
 *     ("You are a helpful software engineer assistant."), mirroring the
 *     upstream persona row (`complete: true`, `includeRuntimeContext:
 *     false`). With `personaScope: "always"` (default) the persona stays
 *     the system prompt for the WHOLE session and the stripped prompt
 *     content (AGENTS.md digest, skills reminder, late appends such as
 *     pi-memory's block) is re-delivered as user messages from the
 *     promoted phase on — upstream's pre-step injection shape. With
 *     "bootstrap" only request #1 gets the persona.
 *   - Optionally capped at `bootstrapMaxTokens` (upstream: OPT-IN; the
 *     Minimal schema anchors at the adapter default without a cap, so the
 *     pi port defaults to no cap as well).
 *
 * Phase 2 — promotion (after the first durable signal, default
 * `promoteOn: either`: the first assistant message OR the first tool call,
 * whichever comes first):
 *   - The full tool catalog (snapshot taken before bootstrap) is restored,
 *     including `str_replace_editor` (the upstream preset keeps both
 *     bootstrap tools in its full catalog too).
 *   - The maxTokens cap is released and the normal pi system prompt
 *     (with all injected context) returns unchanged from request #2 on.
 *
 * The phase is derived from durable session entries (a custom entry plus
 * assistant/toolResult messages), so resume and reload preserve it.
 *
 * Zero-Anchored Standard mode (dsh's comparison mode): set `zeroAnchor:
 * true`. The first user message is replaced by a fixed anchor notice and
 * the first request carries ZERO tools; after the anchor reply, the real
 * user message is re-delivered as a follow-up with the full catalog.
 * zeroAnchor keeps the standard system prompt, matching upstream.
 *
 * Configuration — edit the DEFAULT_CONFIG below, or override at runtime
 * with the JSON env var PI_DSH_ANCHOR_CONFIG:
 *
 *   PI_DSH_ANCHOR_CONFIG='{"promoteOn":"tool-call","bootstrapMaxTokens":1024}'
 *
 * Debug the first-request payload with PI_DSH_ANCHOR_DEBUG=1.
 *
 * Escape hatch — `/dsh-anchor` command: status | promote | on | off.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, type Stats } from "fs";
import { dirname, isAbsolute, join } from "path";

// ─── Configuration (mirrors the dsh preset config) ─────────────────────────

interface DshAnchorConfig {
  /** Tool pair exposed on the first request. Upstream: the official Minimal pair. */
  bootstrapTools: string[];
  /** Promotion trigger. */
  promoteOn: "either" | "tool-call" | "assistant-message";
  /** Optional maxTokens cap for the first model request. undefined = no cap (upstream default). */
  bootstrapMaxTokens?: number;
  /** Replace the system prompt with the Minimal persona.
   *  "always" (upstream-faithful default): the persona is the system prompt for
   *  the WHOLE session; the stripped prompt content (AGENTS.md digest, skills
   *  reminder, late appends like pi-memory) is re-delivered as user messages
   *  from the promoted phase on, mirroring upstream's pre-step injections.
   *  "bootstrap": only request #1 gets the persona; later turns return to the
   *  normal pi system prompt. */
  minimalPersona: boolean;
  /** Persona scope: "always" (default) or "bootstrap" (request #1 only). */
  personaScope: "always" | "bootstrap";
  /** The Minimal persona text (upstream persona row, byte-identical). */
  personaText: string;
  /** Fallback strip mode when minimalPersona=false: drop pi's AGENTS.md/skills blocks. */
  stripContext: boolean;
  /** Zero-Anchored Standard comparison mode. */
  zeroAnchor: boolean;
  /** Anchor text used by zeroAnchor mode. */
  zeroAnchorText: string;
  /** Editor view truncation threshold (upstream preset config). */
  editorMaxOutputChars: number;
}

const DEFAULT_CONFIG: DshAnchorConfig = {
  bootstrapTools: ["bash", "str_replace_editor"],
  promoteOn: "either",
  bootstrapMaxTokens: undefined,
  minimalPersona: true,
  personaScope: "always",
  personaText: "You are a helpful software engineer assistant.",
  stripContext: true,
  zeroAnchor: false,
  zeroAnchorText:
    "This round is a test. Tools are not open yet; all tools will open next round.",
  editorMaxOutputChars: 16000,
};

/** Durable custom-entry type recording that a session reached the promoted phase. */
const STATE_ENTRY = "dsh-anchored-state";

const STATUS_KEY = "dsh-anchor";

// ─── Minimal preset tool schemas (byte-identical to the official preset) ───

/**
 * The official Minimal preset's persistent bash description
 * (deepseek-harness apps/cli/config/agent-presets/minimal/agent.cordis.yml).
 */
const MINIMAL_BASH_DESCRIPTION = `Run commands in a bash shell
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* You don't have access to the internet via this tool.
* You do have access to a mirror of common linux and python packages via apt and pip.
* State is persistent across command calls and discussions with the user.
* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`;

/**
 * The official Minimal preset's str_replace_editor default description
 * (@deepseek-ai/dsh-tool-str-replace-editor DEFAULT_DESCRIPTION).
 */
const EDITOR_DESCRIPTION = `Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If \`path\` is a file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`

Notes for using the \`str_replace\` command:
* The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
* The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``;

const EDITOR_TRUNCATED_MESSAGE =
  "<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>";

type EditorCommand = "view" | "create" | "str_replace" | "insert";

interface EditorArgs {
  command: EditorCommand;
  path: string;
  file_text?: string;
  insert_line?: number;
  new_str?: string;
  old_str?: string;
  view_range?: number[];
}

// ─── str_replace_editor implementation (upstream semantics over local fs) ──

function maybeTruncate(content: string, maxOutputChars: number): string {
  return content.length <= maxOutputChars
    ? content
    : content.slice(0, maxOutputChars) + EDITOR_TRUNCATED_MESSAGE;
}

function matchOffsets(content: string, search: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  while (true) {
    const match = content.indexOf(search, offset);
    if (match < 0) return offsets;
    offsets.push(match);
    offset = match + search.length;
  }
}

function lineNumbersAt(content: string, offsets: readonly number[]): number[] {
  let line = 1;
  let cursor = 0;
  return offsets.map((offset) => {
    while (cursor < offset) {
      if (content[cursor] === "\n") line += 1;
      cursor += 1;
    }
    return line;
  });
}

function resolveEditorPath(path: string): string {
  if (path.trim().length === 0) throw new Error("path must be a non-empty string");
  if (!isAbsolute(path)) {
    throw new Error(
      `The path ${path} is not an absolute path, it should start with \`/\`. Maybe you meant /${path}?`,
    );
  }
  return path;
}

function statExisting(
  path: string,
  command: "view" | "str_replace" | "insert",
): Stats {
  let info: Stats | undefined;
  try {
    info = statSync(path);
  } catch {
    throw new Error(`The path ${path} does not exist. Please provide a valid path.`);
  }
  if (info === undefined) {
    throw new Error(`The path ${path} does not exist. Please provide a valid path.`);
  }
  if (info.isDirectory() && command !== "view") {
    throw new Error(
      `The path ${path} is a directory and only the \`view\` command can be used on directories`,
    );
  }
  return info;
}

function requiredForCommand(
  value: string | undefined,
  parameter: string,
  command: string,
  allowEmpty = true,
): string {
  if (value === undefined) throw new Error(`Parameter \`${parameter}\` is required for command: ${command}`);
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Parameter \`${parameter}\` is empty for command: ${command}`);
  }
  return value;
}

function formatFileView(
  path: string,
  content: string,
  maxOutputChars: number,
  viewRange?: number[],
): string {
  const allLines = content.split("\n");
  let lines = allLines;
  let initialLine = 1;
  let finalLine: number | undefined;
  let prompt = `Here's the content of ${path} with line numbers (which has a total of ${allLines.length} lines)`;
  if (viewRange !== undefined) {
    const [requestedInitialLine, requestedFinalLine] = viewRange;
    if (
      viewRange.length !== 2
      || requestedInitialLine === undefined
      || requestedFinalLine === undefined
      || !viewRange.every(Number.isInteger)
    ) {
      throw new Error("Invalid `view_range`. It should be a list of two integers.");
    }
    initialLine = requestedInitialLine;
    finalLine = requestedFinalLine;
    if (initialLine < 1 || initialLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(", ")}]. Its first element \`${initialLine}\` should be within the range of lines of the file: [1, ${allLines.length}]`,
      );
    }
    if (finalLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(", ")}]. Its second element \`${finalLine}\` should be smaller than the number of lines in the file: \`${allLines.length}\``,
      );
    }
    if (finalLine !== -1 && finalLine < initialLine) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(", ")}]. Its second element \`${finalLine}\` should be larger or equal than its first \`${initialLine}\``,
      );
    }
    lines = finalLine === -1
      ? allLines.slice(initialLine - 1)
      : allLines.slice(initialLine - 1, finalLine);
    prompt += ` with view_range=[${initialLine}, ${finalLine}]`;
  }
  const numbered = lines
    .map((line, index) => `${String(initialLine + index).padStart(6, " ")}  ${line}`)
    .join("\n");
  return maybeTruncate(`${prompt}:\n${numbered}\n`, maxOutputChars);
}

function listDirectory(path: string, maxOutputChars: number): string {
  function visit(dir: string, depth: number): string[] {
    const rows: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".")
        || entry.name === "node_modules"
        || entry.name === "__pycache__"
      ) {
        continue;
      }
      const entryPath = join(dir, entry.name);
      const type = entry.isDirectory() ? "d" : entry.isFile() ? "f" : "?";
      rows.push(`${type}\t${entryPath}`);
      if (entry.isDirectory() && depth < 2) {
        rows.push(...visit(entryPath, depth + 1));
      }
    }
    return rows;
  }
  const rows = [`d\t${path}`, ...visit(path, 1)];
  rows.sort((left, right) => {
    const leftPath = left.slice(left.indexOf("\t") + 1);
    const rightPath = right.slice(right.indexOf("\t") + 1);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
  const listing = maybeTruncate(rows.join("\n") + "\n", maxOutputChars);
  return `Here're the files and directories up to 2 levels deep in ${path}, excluding hidden items, node_modules, and Python cache directories:\n${listing}\n`;
}

function executeEditor(args: EditorArgs, maxOutputChars: number): string {
  const path = resolveEditorPath(args.path);
  switch (args.command) {
    case "view": {
      const info = statExisting(path, "view");
      if (info.isDirectory()) {
        if (args.view_range !== undefined) {
          throw new Error(
            "The `view_range` parameter is not allowed when `path` points to a directory.",
          );
        }
        return listDirectory(path, maxOutputChars);
      }
      if (!info.isFile()) {
        throw new Error(`cannot view "${path}": not a regular file or directory`);
      }
      return formatFileView(path, readFileSync(path, "utf-8"), maxOutputChars, args.view_range);
    }
    case "create": {
      const fileText = requiredForCommand(args.file_text, "file_text", "create");
      if (existsSync(path)) {
        throw new Error(
          `File already exists at: ${path}. Cannot overwrite files using command \`create\`.`,
        );
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, fileText, "utf-8");
      return `New file created successfully at: ${path}`;
    }
    case "str_replace": {
      const oldValue = requiredForCommand(args.old_str, "old_str", "str_replace", false);
      const newValue = args.new_str ?? "";
      const info = statExisting(path, "str_replace");
      if (!info.isFile()) {
        throw new Error(`cannot edit "${path}": not a regular file`);
      }
      const before = readFileSync(path, "utf-8");
      const offsets = matchOffsets(before, oldValue);
      const offset = offsets[0];
      if (offset === undefined) {
        throw new Error(
          `No replacement was performed, old_str \`${oldValue}\` did not appear verbatim in ${path}.`,
        );
      }
      if (offsets.length > 1) {
        const lines = lineNumbersAt(before, offsets);
        throw new Error(
          `No replacement was performed. Multiple occurrences of old_str \`${oldValue}\` in lines [${lines.join(", ")}]. Please ensure it is unique`,
        );
      }
      writeFileSync(
        path,
        before.slice(0, offset) + newValue + before.slice(offset + oldValue.length),
        "utf-8",
      );
      return `The file ${path} has been edited successfully.`;
    }
    case "insert": {
      if (args.insert_line === undefined) {
        throw new Error("Parameter `insert_line` is required for command: insert");
      }
      const value = requiredForCommand(args.new_str, "new_str", "insert");
      const info = statExisting(path, "insert");
      if (!info.isFile()) {
        throw new Error(`cannot insert into "${path}": not a regular file`);
      }
      const before = readFileSync(path, "utf-8");
      const lines = before.split("\n");
      if (!Number.isInteger(args.insert_line) || args.insert_line < 0 || args.insert_line > lines.length) {
        throw new Error(
          `Invalid \`insert_line\` parameter: ${args.insert_line}. It should be within the range of lines of the file: [0, ${lines.length}]`,
        );
      }
      const after = [
        ...lines.slice(0, args.insert_line),
        ...value.split("\n"),
        ...lines.slice(args.insert_line),
      ].join("\n");
      writeFileSync(path, after, "utf-8");
      return `The file ${path} has been edited successfully.`;
    }
    default:
      throw new Error(
        `Unknown command: ${String((args as { command?: unknown }).command)}. Allowed options are: \`view\`, \`create\`, \`str_replace\`, \`insert\`.`,
      );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface SessionState {
  sessionId: string;
  promoted: boolean;
  /** Full catalog snapshot (tools active before bootstrap was applied). */
  fullTools: string[] | null;
  /** Zero-anchor: the user's real first message, re-delivered after the anchor reply. */
  pendingRealMessage: string | null;
  /** personaScope="always": whether the stripped pre-replacement prompt has been re-injected as a user message. */
  contextInjected: boolean;
}

/** Per-session phase state for this process. Promotion is append-only. */
const sessionStates = new Map<string, SessionState>();

/**
 * Catalog snapshot shared across sessions in this process. If one session
 * leaves the bootstrap set active and the next session starts in the same
 * process, `getActiveTools()` alone would return the tainted set; the union
 * with this snapshot recovers the real full catalog.
 */
let knownFullTools: string[] | null = null;

function loadConfig(): DshAnchorConfig {
  const raw = process.env.PI_DSH_ANCHOR_CONFIG;
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged: DshAnchorConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      // Back-compat: the first pi port used shellTools/commonTools.
      bootstrapTools:
        (parsed.bootstrapTools as string[] | undefined)
        ?? (parsed.shellTools || parsed.commonTools
          ? [...(parsed.shellTools as string[] ?? []), ...(parsed.commonTools as string[] ?? [])]
          : DEFAULT_CONFIG.bootstrapTools),
    };
    return merged;
  } catch (error) {
    console.warn(`[dsh-anchor] invalid PI_DSH_ANCHOR_CONFIG JSON, using defaults: ${String(error)}`);
    return { ...DEFAULT_CONFIG };
  }
}

function normalizeConfig(config: DshAnchorConfig): DshAnchorConfig {
  if (config.promoteOn !== "either" && config.promoteOn !== "tool-call" && config.promoteOn !== "assistant-message") {
    console.warn(`[dsh-anchor] invalid promoteOn ${JSON.stringify(config.promoteOn)}, using "either"`);
    config.promoteOn = "either";
  }
  if (
    config.bootstrapMaxTokens !== undefined
    && (!Number.isSafeInteger(config.bootstrapMaxTokens) || config.bootstrapMaxTokens <= 0)
  ) {
    console.warn("[dsh-anchor] invalid bootstrapMaxTokens, dropping the cap");
    config.bootstrapMaxTokens = undefined;
  }
  if (
    !Array.isArray(config.bootstrapTools) || config.bootstrapTools.length === 0
  ) {
    console.warn("[dsh-anchor] invalid bootstrapTools, using the Minimal pair");
    config.bootstrapTools = DEFAULT_CONFIG.bootstrapTools;
  }
  if (config.personaScope !== "always" && config.personaScope !== "bootstrap") {
    console.warn(`[dsh-anchor] invalid personaScope ${JSON.stringify(config.personaScope)}, using "always"`);
    config.personaScope = "always";
  }
  return config;
}

/**
 * Derive the phase from durable session entries. A session is promoted once
 * it has our marker entry OR any assistant/toolResult message — the pi
 * equivalents of dsh's durable `assistant/message` and `tool/call` events.
 */
function scanPromotionSignal(ctx: ExtensionContext): boolean {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === STATE_ENTRY) {
      const data = entry.data as { promoted?: boolean } | undefined;
      if (data?.promoted) return true;
    } else if (
      entry.type === "message"
      && (entry.message.role === "assistant" || entry.message.role === "toolResult")
    ) {
      return true;
    }
  }
  return false;
}

/** A session with no user/assistant/toolResult message yet (first turn). */
function isFreshSession(ctx: ExtensionContext): boolean {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (
      entry.type === "message"
      && (entry.message.role === "user" || entry.message.role === "assistant" || entry.message.role === "toolResult")
    ) {
      return false;
    }
  }
  return true;
}

function stateFor(ctx: ExtensionContext): SessionState {
  const sessionId = ctx.sessionManager.getSessionId();
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = {
      sessionId,
      promoted: scanPromotionSignal(ctx),
      fullTools: null,
      pendingRealMessage: null,
      contextInjected: false,
    };
    sessionStates.set(sessionId, state);
  }
  return state;
}

function resolveFullTools(pi: ExtensionAPI, state: SessionState, bootstrapTools: string[]): string[] {
  if (state.fullTools) return state.fullTools;
  const current = pi.getActiveTools();
  // The full catalog always includes the bootstrap tools (upstream keeps the
  // persistent bash and str_replace_editor in its full catalog too) — the
  // editor is extension-registered, so it may not be in the active set yet.
  const full = knownFullTools
    ? [...new Set([...current, ...knownFullTools, ...bootstrapTools])]
    : [...new Set([...current, ...bootstrapTools])];
  state.fullTools = full;
  knownFullTools = full;
  return full;
}

// ─── Extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = normalizeConfig(loadConfig());

  // ── Minimal tool pair registration ───────────────────────────────────────
  // The bash override replaces pi's built-in bash with the Minimal persistent
  // bash description while delegating execution to the built-in
  // implementation (upstream: the persistent bash IS the preset's bash; the
  // standard row is disabled).
  const bashToolCache = new Map<string, ReturnType<typeof createBashTool>>();

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: MINIMAL_BASH_DESCRIPTION,
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    parameters: Type.Object({
      command: Type.String({ description: "The bash command to run. Relative path is preferred in the command." }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      let tool = bashToolCache.get(ctx.cwd);
      if (!tool) {
        tool = createBashTool(ctx.cwd);
        bashToolCache.set(ctx.cwd, tool);
      }
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    name: "str_replace_editor",
    label: "str_replace_editor",
    description: EDITOR_DESCRIPTION,
    parameters: Type.Object({
      command: StringEnum(["view", "create", "str_replace", "insert"] as const, {
        description: "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
      }),
      path: Type.String({ description: "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`." }),
      file_text: Type.Optional(Type.String({ description: "Required parameter of `create` command, with the content of the file to be created." })),
      insert_line: Type.Optional(Type.Integer({ description: "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`." })),
      new_str: Type.Optional(Type.String({ description: "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert." })),
      old_str: Type.Optional(Type.String({ description: "Required parameter of `str_replace` command containing the string in `path` to replace." })),
      view_range: Type.Optional(Type.Array(Type.Integer(), { description: "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const text = executeEditor(params as EditorArgs, config.editorMaxOutputChars);
      return {
        content: [{ type: "text", text }],
        details: { command: (params as EditorArgs).command, path: (params as EditorArgs).path },
      };
    },
  });

  // zero-anchor promotes on the anchor reply; an assistant message is always
  // a promotion signal there, otherwise the session could never leave the
  // zero-tool phase (the anchor turn makes no tool call by design).
  const promoteOnToolCall = !config.zeroAnchor && config.promoteOn !== "assistant-message";
  const promoteOnAssistantMessage = config.zeroAnchor || config.promoteOn !== "tool-call";

  /** Bootstrap catalog names that are actually registered (checked lazily: pi action methods are unavailable during extension loading). */
  const availableBootstrapTools = () =>
    [...new Set(config.bootstrapTools)].filter(
      (name) => pi.getAllTools().some((tool) => tool.name === name),
    );

  /** Point the active tool set at the current phase (bootstrap or full). */
  const applyPhaseTools = (ctx: ExtensionContext) => {
    const state = stateFor(ctx);
    // Snapshot the full catalog while the user's catalog is still active:
    // this is the restore target for promotion and must never be captured
    // from the narrowed bootstrap set.
    const full = resolveFullTools(pi, state, config.bootstrapTools);
    const target = state.promoted ? full : config.zeroAnchor ? [] : availableBootstrapTools();
    const active = pi.getActiveTools();
    const same = active.length === target.length && target.every((name) => active.includes(name));
    if (!same) pi.setActiveTools(target);
  };

  /** Move the session to the promoted phase: full catalog, no cap, no strip. */
  const promote = (ctx: ExtensionContext) => {
    const state = stateFor(ctx);
    if (state.promoted) return;
    state.promoted = true;
    try {
      pi.appendEntry(STATE_ENTRY, { promoted: true, promoteOn: config.promoteOn, at: Date.now() });
    } catch (error) {
      // The in-memory state still promotes; only cross-process resume loses it.
      console.warn(`[dsh-anchor] failed to persist promotion marker: ${String(error)}`);
    }
    const full = resolveFullTools(pi, state, config.bootstrapTools);
    pi.setActiveTools(full);
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify(`[dsh-anchor] promoted: full tool catalog restored (${full.length} tools)`, "info");
    }
  };

  // ── phase setup / restore ──────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    const state = stateFor(ctx);
    applyPhaseTools(ctx);
    if (ctx.hasUI) {
      if (state.promoted) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
      } else {
        const label = config.zeroAnchor
          ? "bootstrap: 0 tools (zero-anchor)"
          : `bootstrap: ${availableBootstrapTools().join("/")}`
            + (config.bootstrapMaxTokens !== undefined ? ` · maxTokens ${config.bootstrapMaxTokens}` : "");
        ctx.ui.setStatus(STATUS_KEY, label);
      }
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionStates.delete(ctx.sessionManager.getSessionId());
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  // ── request #1: Minimal persona system prompt + bootstrap tool set ────────

  pi.on("before_agent_start", (event, ctx) => {
    const state = stateFor(ctx);
    // Defensive: re-assert the phase tool set each unpromoted turn in case
    // another extension or a mid-turn reload changed it.
    applyPhaseTools(ctx);

    if (state.promoted) {
      // Upstream keeps the persona row for the WHOLE session (`complete:
      // true`); the workspace context returns as pre-step USER messages from
      // request #2 on, never as system-prompt content. With
      // personaScope="always" the promoted phase does the same: the full pi
      // prompt captured here is re-delivered as a persistent user message,
      // while the system prompt stays the bare persona.
      if (
        config.zeroAnchor
        || !config.minimalPersona
        || config.personaScope !== "always"
      ) {
        return undefined;
      }
      if (!state.contextInjected) {
        state.contextInjected = true;
        const context = event.systemPrompt === config.personaText
          ? ""
          : event.systemPrompt;
        return {
          systemPrompt: config.personaText,
          ...(context
            ? {
                message: {
                  customType: "dsh-anchor-context",
                  content: context,
                  display: false,
                },
              }
            : {}),
        };
      }
      if (event.systemPrompt !== config.personaText) {
        return { systemPrompt: config.personaText };
      }
      return undefined;
    }

    if (!config.zeroAnchor && config.minimalPersona) {
      // Bootstrap request: the ENTIRE system prompt is the Minimal persona.
      // Nothing else (AGENTS.md, skills, pi guidance) may appear.
      if (event.systemPrompt !== config.personaText) {
        return { systemPrompt: config.personaText };
      }
      return undefined;
    }
    if (!config.zeroAnchor && config.stripContext) {
      const stripped = stripBootstrapSections(event.systemPrompt);
      if (stripped !== event.systemPrompt) return { systemPrompt: stripped };
    }

    return undefined;
  });

  // ── enforce the persona on the assembled provider payload ──────────────────
  // before_agent_start handlers chain in registration order, so packages that
  // load after this extension (e.g. pi-memory) append their own sections —
  // such as the `## Memory` block — to the system prompt AFTER our
  // replacement. Upstream's anchor requires the system prompt to stay
  // Minimal-exact, so re-assert it at the last interception point before the
  // payload reaches the provider. Late-appended sections are moved into a
  // user-role message right after the system message (upstream's pre-step
  // injection shape) instead of being dropped.
  pi.on("before_provider_request", (event, ctx) => {
    if (config.zeroAnchor) return;
    if (!config.minimalPersona) return;
    const state = stateFor(ctx);
    if (state.promoted && config.personaScope !== "always") return;
    const payload = event.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const record = payload as { messages?: unknown };
    if (!Array.isArray(record.messages)) return;
    // The bootstrap request must be Minimal-exact: late appends are DROPPED.
    // In the promoted phase (personaScope="always") they are MOVED into a
    // user-role message right after the system message (upstream's pre-step
    // injection shape) instead of being dropped.
    const moveExtras = state.promoted;
    const moved: { role: string; content: string }[] = [];
    let systemIndex = -1;
    for (let i = 0; i < record.messages.length; i++) {
      const entry = record.messages[i] as { role?: unknown; content?: unknown } | null;
      if (!entry || (entry.role !== "system" && entry.role !== "developer")) continue;
      systemIndex = i;
      const content = entry.content;
      if (typeof content !== "string" || content === config.personaText) continue;
      const extra = content.startsWith(config.personaText)
        ? content.slice(config.personaText.length).replace(/^\n+/, "")
        : "";
      entry.content = config.personaText;
      if (extra && moveExtras) moved.push({ role: "user", content: extra });
    }
    if (moved.length > 0 && systemIndex >= 0) {
      record.messages.splice(systemIndex + 1, 0, ...moved);
    }
  });

  // ── zero-anchor: swap the first user message for the fixed anchor turn ────

  pi.on("input", (event, ctx) => {
    if (!config.zeroAnchor) return;
    if (event.source === "extension") return; // our own follow-up re-entry
    const state = stateFor(ctx);
    if (state.promoted) return;
    if (!isFreshSession(ctx)) return;
    state.pendingRealMessage = event.text;
    return { action: "transform", text: config.zeroAnchorText };
  });

  // ── promotion signals (first assistant message / first tool call) ─────────

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const state = stateFor(ctx);
    if (promoteOnAssistantMessage) promote(ctx);
    // zero-anchor: re-deliver the real user message with the full catalog.
    // The runtime wrapper routes async failures to runner.emitError itself.
    if (config.zeroAnchor && state.pendingRealMessage !== null) {
      const text = state.pendingRealMessage;
      state.pendingRealMessage = null;
      try {
        pi.sendUserMessage(text, { deliverAs: "followUp" });
      } catch (error) {
        console.warn(`[dsh-anchor] failed to queue the real message as follow-up: ${String(error)}`);
      }
    }
  });

  pi.on("tool_call", (_event, ctx) => {
    if (promoteOnToolCall) promote(ctx);
  });

  // ── optional output budget cap on the bootstrap request ───────────────────

  if (config.bootstrapMaxTokens !== undefined) {
    pi.on("before_provider_request", (event, ctx) => {
      if (config.zeroAnchor) return; // dsh zero-anchored keeps the normal budget
      const state = stateFor(ctx);
      if (state.promoted) return;
      const payload = event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      const record = payload as Record<string, unknown>;
      if (typeof record.max_completion_tokens === "number") {
        record.max_completion_tokens = config.bootstrapMaxTokens;
      } else if (typeof record.max_tokens === "number") {
        record.max_tokens = config.bootstrapMaxTokens;
      } else if (typeof record.maxOutputTokens === "number") {
        record.maxOutputTokens = config.bootstrapMaxTokens;
      } else if ("messages" in record) {
        // Chat-style payload without an explicit budget: inject the cap.
        record.max_tokens = config.bootstrapMaxTokens;
      }
    });
  }

  // ── observability ─────────────────────────────────────────────────────────

  if (process.env.PI_DSH_ANCHOR_DEBUG === "1") {
    const dumpPath = process.env.PI_DSH_ANCHOR_DEBUG_FILE ?? "/tmp/dsh-anchor-debug.jsonl";
    const dump = (line: object) => {
      try {
        appendFileSync(dumpPath, JSON.stringify(line) + "\n");
      } catch {
        // Debug output must never break the session.
      }
    };

    pi.on("before_agent_start", (event) => {
      dump({
        event: "before_agent_start",
        promptLen: event.systemPrompt.length,
        prompt: event.systemPrompt.slice(0, 600),
      });
    });

    pi.on("before_provider_request", (event) => {
      const payload = event.payload as { tools?: unknown[]; messages?: unknown[]; system?: string } | null;
      const names = Array.isArray(payload?.tools)
        ? payload.tools.map((tool) => {
            const entry = tool as { name?: string; function?: { name?: string } } | null;
            return entry?.function?.name ?? entry?.name ?? "?";
          })
        : [];
      const maxTokens =
        (event.payload as { max_tokens?: unknown; max_completion_tokens?: unknown } | null)
          ?.max_tokens
        ?? (event.payload as { max_completion_tokens?: unknown } | null)?.max_completion_tokens
        ?? "default";
      // Dump the system-level parts of the payload to verify the persona
      // replacement actually reaches the provider (RPC mode swallows console).
      const systemParts: string[] = [];
      if (typeof payload?.system === "string") systemParts.push(payload.system);
      for (const message of payload?.messages ?? []) {
        const role = (message as { role?: string })?.role;
        if (role === "system" || role === "developer") {
          const content = (message as { content?: unknown })?.content;
          systemParts.push(typeof content === "string" ? content : JSON.stringify(content).slice(0, 400));
        }
      }
      dump({
        event: "before_provider_request",
        tools: names,
        maxTokens: String(maxTokens),
        messageCount: payload?.messages?.length ?? 0,
        systemParts,
      });
    });
  }

  pi.registerCommand("dsh-anchor", {
    description: "dsh-anchored-standard: show bootstrap phase, or promote/disable for this session",
    handler: async (args, ctx) => {
      const command = (args ?? "").trim().toLowerCase();
      const state = stateFor(ctx);
      if (command === "promote") {
        promote(ctx);
        return;
      }
      if (command === "off") {
        state.promoted = true;
        pi.setActiveTools(resolveFullTools(pi, state, config.bootstrapTools));
        if (ctx.hasUI) ctx.ui.notify("[dsh-anchor] bootstrap disabled for this session", "info");
        return;
      }
      if (command === "on") {
        state.promoted = false;
        applyPhaseTools(ctx);
        if (ctx.hasUI) ctx.ui.notify("[dsh-anchor] bootstrap re-armed for this session", "info");
        return;
      }
      let phase: string;
      if (state.promoted) {
        phase = "promoted (full catalog)";
      } else if (config.zeroAnchor) {
        phase = "bootstrap (0 tools)";
      } else {
        phase = `bootstrap (${availableBootstrapTools().join("/")})`;
      }
      const line = [
        `[dsh-anchor] phase: ${phase}`,
        `promoteOn: ${config.promoteOn}`,
        `bootstrapMaxTokens: ${config.bootstrapMaxTokens ?? "unset (no cap)"}`,
        `minimalPersona: ${config.minimalPersona}${config.minimalPersona ? ` ("${config.personaText}", scope: ${config.personaScope})` : ""}`,
        `stripContext: ${config.stripContext}`,
        `zeroAnchor: ${config.zeroAnchor}`,
        `full catalog (${resolveFullTools(pi, state, config.bootstrapTools).length} tools): ${resolveFullTools(pi, state, config.bootstrapTools).join(", ")}`,
      ].join("\n");
      if (ctx.hasUI) ctx.ui.notify(line, "info");
      return undefined;
    },
  });
}

/**
 * Fallback strip used when minimalPersona=false: drop the two automatic
 * context injections from the system prompt — pi's equivalents of dsh's
 * `agent-instructions` (AGENTS.md/CLAUDE.md digest) and `skill-catalog`
 * (available-skills reminder) pre-step injections.
 */
function stripBootstrapSections(systemPrompt: string): string {
  let out = systemPrompt;
  out = out.replace(/<project_context>[\s\S]*?<\/project_context>/g, "");
  out = out.replace(
    /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/g,
    "",
  );
  out = out.replace(
    /\n\nIn addition to the tools above, you may have access to other custom tools depending on the project\./g,
    "",
  );
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}
