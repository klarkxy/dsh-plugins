import { readFileSync } from "node:fs";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { contentDir, contentDirUrl, loadCatalog, normalizePagesBaseUrl, type Catalog } from "./catalog.js";
import { renderSkillBody } from "./skill-body.js";

export const name = "dsh-dev-index";
export const inject = ["skills"];

export interface Config {
  pagesBaseUrl: string;
}

export const Config: z<Config> = z.object({
  pagesBaseUrl: z.string().default("https://klarkxy.github.io/dsh-plugins/"),
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
  readonly resourceBase: {
    readonly kind: "directory";
    readonly path: string;
  };
}

export interface SkillHost {
  skills: {
    register(skill: IndexedSkill): () => void;
  };
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

export function createSkill(catalog: Catalog, pagesBaseUrl: string, baseDir = contentDir): IndexedSkill {
  return {
    name: catalog.skill.name,
    description: catalog.skill.description,
    whenToUse: catalog.skill.whenToUse,
    source: "bundled",
    invocation: { modelInvocable: true, userInvocable: true },
    resourceBase: { kind: "directory", path: baseDir },
    content: renderSkillBody(catalog, pagesBaseUrl),
  };
}

export function readArea(catalog: Catalog, id: string, dir: URL = contentDirUrl): string {
  const area = catalog.areas.find((candidate) => candidate.id === id);
  if (area === undefined) throw new Error(`dsh-dev-index: unknown area "${id}"`);
  return readFileSync(new URL(area.file, dir), "utf8");
}

export function apply(ctx: Context & SkillHost, config: Config): void {
  const resolved = resolveConfig(config);
  const catalog = loadCatalog();
  ctx.skills.register(createSkill(catalog, resolved.pagesBaseUrl));
}
