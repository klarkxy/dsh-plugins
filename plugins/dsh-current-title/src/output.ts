import { normalizeSessionTitle } from "@deepseek-ai/dsh-session-title";

export const TITLE_TYPE_KEYS = [
  "feature",
  "fix",
  "optimize",
  "refactor",
  "test",
  "docs",
  "release",
  "config",
  "explore",
  "discuss",
] as const;

export const TITLE_LOCALES = ["zh", "en"] as const;
export const TITLE_LOCALE_MODES = ["auto", ...TITLE_LOCALES] as const;

export type TitleType = (typeof TITLE_TYPE_KEYS)[number];
export type TitleLocale = (typeof TITLE_LOCALES)[number];
export type TitleLocaleMode = (typeof TITLE_LOCALE_MODES)[number];

const TITLE_TYPE_LABELS: Record<TitleLocale, Record<TitleType, string>> = {
  zh: {
    feature: "功能",
    fix: "修复",
    optimize: "优化",
    refactor: "重构",
    test: "测试",
    docs: "文档",
    release: "发布",
    config: "配置",
    explore: "探索",
    discuss: "讨论",
  },
  en: {
    feature: "Feature",
    fix: "Fix",
    optimize: "Optimize",
    refactor: "Refactor",
    test: "Test",
    docs: "Docs",
    release: "Release",
    config: "Config",
    explore: "Explore",
    discuss: "Discussion",
  },
};

export interface ParsedTitle {
  type: TitleType;
  summary: string;
}

function isTitleType(value: string): value is TitleType {
  return (TITLE_TYPE_KEYS as readonly string[]).includes(value);
}

export function resolveTitleLocale(
  mode: TitleLocaleMode,
  messages: readonly string[],
  preference?: string,
): TitleLocale {
  if (mode !== "auto") return mode;

  const preferred = preference?.trim().toLowerCase().split("-")[0];
  if (preferred === "zh" || preferred === "en") return preferred;

  const text = messages.join("\n");
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return "en";
  return /\p{Script=Han}/u.test(text) ? "zh" : "en";
}

function removeTitleSyntax(value: string): string {
  return value.replace(/[|`*_~#\[\]"“”]/gu, " ");
}

function truncateSummary(value: string, targetWords: number, targetCjkCharacters: number): string {
  const containsCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
  if (containsCjk) {
    return Array.from(value.replace(/\s+/gu, "")).slice(0, targetCjkCharacters).join("");
  }
  return value.split(/\s+/u).filter(Boolean).slice(0, targetWords).join(" ");
}

export function parseModelTitle(
  raw: string,
  targetWords: number,
  targetCjkCharacters: number,
): ParsedTitle {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch (cause) {
    throw new Error("dsh-current-title: title model returned invalid JSON", { cause });
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dsh-current-title: title model response must be an object");
  }

  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "summary,type") {
    throw new Error("dsh-current-title: title model response must contain only type and summary");
  }
  if (typeof candidate.type !== "string" || !isTitleType(candidate.type)) {
    throw new Error("dsh-current-title: title model returned an unsupported type");
  }
  if (typeof candidate.summary !== "string") {
    throw new Error("dsh-current-title: title model summary must be a string");
  }

  const normalized = normalizeSessionTitle(removeTitleSyntax(candidate.summary), Number.MAX_SAFE_INTEGER);
  const summary = truncateSummary(normalized, targetWords, targetCjkCharacters);
  if (summary.length === 0) {
    throw new Error("dsh-current-title: title model returned an empty summary");
  }

  return { type: candidate.type, summary };
}

export function localMonthDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}${day}`;
}

export function formatTitle(parsed: ParsedTitle, locale: TitleLocale, now = new Date()): string {
  return `${localMonthDay(now)} | ${TITLE_TYPE_LABELS[locale][parsed.type]} | ${parsed.summary}`;
}
