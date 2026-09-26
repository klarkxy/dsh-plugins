import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { renderSkillBody, SKILL_DESCRIPTION, SKILL_NAME, SKILL_WHEN_TO_USE } from "./skill-body.js";

export const name = "@klarkxy/dsh-dev-index";
export const inject = ["skills"];

export const DEFAULT_PAGES_BASE_URL = "https://klarkxy.github.io/dsh-plugins/";

export interface Config {
  pagesBaseUrl: string;
}

export const Config: z<Config> = z.object({
  pagesBaseUrl: z.string().default(DEFAULT_PAGES_BASE_URL),
});

export interface ResolvedConfig {
  readonly pagesBaseUrl: string;
}

const CONFIG_KEYS = new Set(["pagesBaseUrl"]);

export interface IndexedSkill {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly source: "bundled";
  readonly content: string;
  readonly invocation: {
    readonly modelInvocable: true;
    readonly userInvocable: true;
  };
}

export interface SkillHost {
  skills: {
    register(skill: IndexedSkill): () => void;
  };
}

export function normalizePagesBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("dsh-dev-index: pagesBaseUrl must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("dsh-dev-index: pagesBaseUrl must be an absolute http(s) URL");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

export function resolveConfig(config: Config): ResolvedConfig {
  if (config === null || typeof config !== "object") {
    throw new Error("dsh-dev-index: configuration is required");
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`dsh-dev-index: unknown config key "${key}"`);
  }
  return Object.freeze({
    pagesBaseUrl: normalizePagesBaseUrl(config.pagesBaseUrl),
  });
}

export function createSkill(pagesBaseUrl: string): IndexedSkill {
  return {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    whenToUse: SKILL_WHEN_TO_USE,
    source: "bundled",
    invocation: { modelInvocable: true, userInvocable: true },
    content: renderSkillBody(pagesBaseUrl),
  };
}

export function apply(ctx: Context & SkillHost, config: Config): void {
  const resolved = resolveConfig(config);
  ctx.skills.register(createSkill(resolved.pagesBaseUrl));
}
