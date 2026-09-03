import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import {
  BlockAssembler,
  createUserMessage,
  type FinishReason,
  type GenerateOptions,
  type Message,
} from "@deepseek-ai/dsh-llm";
import {
  SessionTitleProviderId,
  type SessionTitleModelProvenance,
  type SessionTitleProviderRequest,
  type SessionTitleProviderResult,
} from "@deepseek-ai/dsh-session-title";
import {
  SESSION_TITLE_TIMEOUT_CODE,
  SessionTitleLlmConfigFields,
  resolveSessionTitleLlmConfig,
  type ResolvedSessionTitleLlmConfig,
  type SessionTitleLlmConfig,
} from "@deepseek-ai/dsh-session-title-llm";
import { deadline } from "@deepseek-ai/dsh-timeout";

import { frameMessages, selectRecentMessages } from "./input.js";
import {
  TITLE_LOCALE_MODES,
  TITLE_TYPE_KEYS,
  formatTitle,
  parseModelTitle,
  resolveTitleLocale,
  type TitleLocaleMode,
} from "./output.js";

export const name = "dsh-current-title";
export const inject = ["sessionTitle", "llm", "sessions"];

export interface Config extends SessionTitleLlmConfig {
  readonly maxRecentMessages: number;
  readonly locale: TitleLocaleMode;
}

export const Config: z<Config> = z.object({
  maxRecentMessages: z.number().step(1).min(1).required(),
  locale: z.union(TITLE_LOCALE_MODES).required(),
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
});

export interface ResolvedConfig extends ResolvedSessionTitleLlmConfig {
  readonly maxRecentMessages: number;
  readonly locale: TitleLocaleMode;
}

const CONFIG_KEYS = new Set([
  "maxRecentMessages",
  "locale",
  "targetWords",
  "targetCjkCharacters",
  "maxInputBytes",
  "maxOutputTokens",
  "timeoutMs",
  "provider",
  "model",
]);

export function resolveConfig(config: Config): ResolvedConfig {
  if (config === null || typeof config !== "object") {
    throw new Error("dsh-current-title: configuration is required");
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`dsh-current-title: unknown config key "${key}"`);
  }
  if (!Number.isInteger(config.maxRecentMessages) || config.maxRecentMessages <= 0) {
    throw new Error("dsh-current-title: maxRecentMessages must be a positive integer");
  }
  if (!(TITLE_LOCALE_MODES as readonly string[]).includes(config.locale)) {
    throw new Error("dsh-current-title: locale must be auto, zh, or en");
  }

  const llm = resolveSessionTitleLlmConfig({
    targetWords: config.targetWords,
    targetCjkCharacters: config.targetCjkCharacters,
    maxInputBytes: config.maxInputBytes,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
  });
  return Object.freeze({
    ...llm,
    maxRecentMessages: config.maxRecentMessages,
    locale: config.locale,
  });
}

function resolveRoute(
  config: ResolvedConfig,
  request: SessionTitleProviderRequest,
): SessionTitleModelProvenance {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model };
  }
  if (request.route === undefined) {
    throw new Error(
      "dsh-current-title: no logged request route is available; configure provider and model together",
    );
  }
  return request.route;
}

function systemPrompt(config: ResolvedConfig): string {
  return [
    "Name the current task in an AI coding-assistant session.",
    "Prioritize the newest human messages. Older messages are context only and must not keep a completed task in the title.",
    `Allowed type values: ${TITLE_TYPE_KEYS.join(", ")}.`,
    'Return exactly one JSON object: {"type":"<allowed type>","summary":"<concise task>"}.',
    "Return no Markdown, code fence, explanation, date, or extra key.",
    "Keep the summary in the language of the recent messages.",
    `Aim for at most ${config.targetWords} non-CJK words or ${config.targetCjkCharacters} CJK characters.`,
  ].join("\n");
}

interface SettingsReader {
  get(namespace: string): unknown;
}

function localePreference(ctx: Context): string | undefined {
  const settings = (ctx as Context & { settings?: SettingsReader }).settings;
  const value = settings?.get("locale");
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const preference = (value as Record<string, unknown>).preference;
  return typeof preference === "string" ? preference : undefined;
}

function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case "stop":
      return undefined;
    case "error":
    case "aborted": {
      const error = new Error(finish.failure.message) as Error & { code?: string };
      error.code = finish.failure.code;
      return error;
    }
    case "max-tokens":
      return new Error("dsh-current-title: title output reached maxOutputTokens");
    case "tool-calls":
      return new Error("dsh-current-title: title model unexpectedly requested a tool");
    default:
      return new Error("dsh-current-title: unsupported finish reason");
  }
}

export async function generateCurrentTitle(
  ctx: Context,
  config: ResolvedConfig,
  request: SessionTitleProviderRequest,
  titleProvider = SessionTitleProviderId(name),
): Promise<SessionTitleProviderResult> {
  request.signal.throwIfAborted();
  const selected = selectRecentMessages(
    request.messages,
    config.maxRecentMessages,
    config.maxInputBytes,
  );
  if (selected.length === 0) {
    throw new Error("dsh-current-title: at least one source message is required");
  }

  const framedInput = frameMessages(selected);
  const locale = resolveTitleLocale(
    config.locale,
    selected.map((message) => message.text),
    localePreference(ctx),
  );
  const route = resolveRoute(config, request);
  const messages: Message[] = [
    createUserMessage({
      content: [{ type: "text", text: framedInput }],
      source: { kind: "plugin", plugin: name },
    }),
  ];
  const system = systemPrompt(config);
  using callDeadline = deadline(request.signal, config.timeoutMs, SESSION_TITLE_TIMEOUT_CODE);
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages,
    system,
    maxTokens: config.maxOutputTokens,
    sessionId: request.session.id,
    purpose: "session-title",
    signal: callDeadline.signal,
  };

  request.session.append("session/title-llm-request", {
    titleProvider,
    messageSeqs: selected.map((message) => message.seq),
    route,
    system,
    messages,
    maxTokens: config.maxOutputTokens,
  });

  callDeadline.signal.throwIfAborted();
  const assembler = new BlockAssembler();
  for await (const chunk of ctx.llm.stream(options)) {
    callDeadline.signal.throwIfAborted();
    assembler.push(chunk);
  }
  callDeadline.signal.throwIfAborted();

  const terminalError = finishError(assembler.finish);
  if (terminalError !== undefined) throw terminalError;
  const blocks = assembler.blocks();
  if (blocks.some((block) => block.type === "tool-call")) {
    throw new Error("dsh-current-title: title output must contain text only");
  }
  const raw = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join(" ");
  const parsed = parseModelTitle(raw, config.targetWords, config.targetCjkCharacters);

  return {
    title: formatTitle(parsed, locale),
    messageSeqs: selected.map((message) => message.seq),
    model: route,
  };
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config);
  const titleProvider = SessionTitleProviderId(name);
  ctx.sessionTitle.register({
    id: titleProvider,
    automatic: "all-prompts",
    generate(request) {
      return generateCurrentTitle(ctx, resolved, request, titleProvider);
    },
  });
}
