import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { CREATOR_PRESET_ID } from "@klarkxy/dsh-plugin-kit/contracts";
import { installPluginLogger } from "@klarkxy/dsh-plugin-kit/logger";

import { CREATOR_GUIDANCE } from "./creator-guidance.js";
import { DocsClient } from "./docs.js";
import { docsTool } from "./docs-tools.js";
import { GitHubClient } from "./github.js";
import { PluginRegistry } from "./registry.js";
import { pluginsTool } from "./registry-tools.js";

export const name = "@klarkxy/dsh-dev-index";
export const inject = ["systemPrompt", "agentPresets", "tools"];

export interface Config {}

export const Config: z<Config> = z.object({});

interface PromptSection {
  name: string;
  order: number;
  text: (context: { agent?: { ctx: Context } }) => string;
}

export interface CreatorPromptHost {
  tools: { register(tool: ToolDefinition): () => void };
  systemPrompt: { section(section: PromptSection): () => void };
  agentPresets: { composedPreset(context: Context): string | undefined };
  effect(callback: () => () => void | Promise<void>, label: string): () => void;
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

export function apply(ctx: Context & CreatorPromptHost, config: Config): void {
  resolveConfig(config);
  const logger = installPluginLogger(ctx, name);
  const client = new DocsClient();
  ctx.effect(() => () => client.dispose(), "dsh-dev-index.docs-client");
  ctx.tools.register(docsTool(client, logger));
  const registry = new PluginRegistry();
  ctx.effect(() => () => registry.dispose(), "dsh-dev-index.plugin-registry");
  const github = new GitHubClient();
  ctx.effect(() => () => github.dispose(), "dsh-dev-index.github-client");
  ctx.tools.register(pluginsTool(registry, github, logger));
  ctx.effect(() => ctx.systemPrompt.section({
    name: "dsh-dev-index.creator-docs",
    order: 100,
    text: ({ agent }) => agent !== undefined && ctx.agentPresets.composedPreset(agent.ctx) === CREATOR_PRESET_ID
      ? CREATOR_GUIDANCE
      : "",
  }), "dsh-dev-index.creator-docs");
}
