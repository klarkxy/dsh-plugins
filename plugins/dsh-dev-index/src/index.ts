import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

import { CREATOR_GUIDANCE } from "./creator-guidance.js";
import { DocsClient } from "./docs.js";
import { docsTools } from "./docs-tools.js";
import { PluginRegistry } from "./registry.js";
import { registryTools } from "./registry-tools.js";

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
  const client = new DocsClient();
  ctx.effect(() => () => client.dispose(), "dsh-dev-index.docs-client");
  for (const tool of docsTools(client)) ctx.tools.register(tool);
  const registry = new PluginRegistry();
  ctx.effect(() => () => registry.dispose(), "dsh-dev-index.plugin-registry");
  for (const tool of registryTools(registry)) ctx.tools.register(tool);
  ctx.effect(() => ctx.systemPrompt.section({
    name: "dsh-dev-index.creator-docs",
    order: 100,
    text: ({ agent }) => agent !== undefined && ctx.agentPresets.composedPreset(agent.ctx) === "cordis"
      ? CREATOR_GUIDANCE
      : "",
  }), "dsh-dev-index.creator-docs");
}
