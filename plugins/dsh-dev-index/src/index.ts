import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { renderSkillBody, SKILL_DESCRIPTION, SKILL_NAME, SKILL_WHEN_TO_USE } from "./skill-body.js";

export const name = "@klarkxy/dsh-dev-index";
export const inject = ["skills"];

export interface Config {}

export const Config: z<Config> = z.object({});

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

export function resolveConfig(config: Config | undefined): Config {
  const value = config ?? {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dsh-dev-index: configuration must be an object");
  }
  for (const key of Object.keys(value)) {
    throw new Error(`dsh-dev-index: unknown config key "${key}"`);
  }
  return Object.freeze({});
}

export function createSkill(): IndexedSkill {
  return {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    whenToUse: SKILL_WHEN_TO_USE,
    source: "bundled",
    invocation: { modelInvocable: true, userInvocable: true },
    content: renderSkillBody(),
  };
}

export function apply(ctx: Context & SkillHost, config: Config): void {
  resolveConfig(config);
  ctx.skills.register(createSkill());
}
