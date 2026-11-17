import { describe, expect, it } from "vitest";
import { CREATOR_PRESET_ID } from "@klarkxy/dsh-plugin-kit/contracts";

import { CREATOR_GUIDANCE, OFFICIAL_LLMS_TXT, OFFICIAL_REPOSITORY } from "../src/creator-guidance.js";
import { apply, resolveConfig, type CreatorPromptHost } from "../src/index.js";

type Registration = Parameters<CreatorPromptHost["tools"]["register"]>;
type Section = Parameters<CreatorPromptHost["systemPrompt"]["section"]>[0];

describe("creator documentation guidance", () => {
  it("accepts an empty config and rejects leftover keys", () => {
    expect(resolveConfig(undefined)).toEqual({});
    expect(resolveConfig({})).toEqual({});
    expect(() => resolveConfig({ pagesBaseUrl: "https://example.com" } as never)).toThrow(/unknown config key/);
  });

  it("contributes both tools and the official docs only to the Creator preset", () => {
    let section: Section | undefined;
    let preset: string | undefined = CREATOR_PRESET_ID;
    const registrations: Registration[] = [];
    const composedWith: unknown[] = [];
    const host: CreatorPromptHost = {
      tools: {
        register(tool, options) {
          registrations.push([tool, options]);
          return () => undefined;
        },
      },
      systemPrompt: {
        section(value) {
          section = value;
          return () => undefined;
        },
      },
      agentPresets: {
        composedPreset(context) {
          composedWith.push(context);
          return preset;
        },
      },
      effect(callback) {
        callback();
        return () => undefined;
      },
    };
    apply(host as never, {});

    expect(registrations.map(([tool]) => tool.name)).toEqual(["dsh_docs", "dsh_plugins"]);
    const agent = { ctx: {} as never };
    for (const [, options] of registrations) {
      expect(options?.when).toBeTypeOf("function");
      expect(options?.when?.({ agent } as never)).toBe(true);
      expect(composedWith.at(-1)).toBe(agent.ctx);
    }

    preset = "standard";
    for (const [, options] of registrations) expect(options?.when?.({ agent } as never)).toBe(false);
    preset = undefined;
    for (const [, options] of registrations) expect(options?.when?.({ agent } as never)).toBe(false);

    expect(section?.name).toBe("dsh-dev-index.creator-docs");
    preset = CREATOR_PRESET_ID;
    expect(section?.text({ agent: { ctx: {} as never } })).toBe(CREATOR_GUIDANCE);
    preset = "standard";
    expect(section?.text({ agent: { ctx: {} as never } })).toBe("");
    expect(section?.text({})).toBe("");
    expect(CREATOR_GUIDANCE).toContain(OFFICIAL_LLMS_TXT);
    expect(CREATOR_GUIDANCE).toContain(OFFICIAL_REPOSITORY);
    expect(CREATOR_GUIDANCE).toContain("cordis_inspect_list");
    expect(CREATOR_GUIDANCE).toContain("cordis_inspect_query");
    expect(CREATOR_GUIDANCE).toContain("dsh_docs action search");
    expect(CREATOR_GUIDANCE).toContain("action fetch");
    expect(CREATOR_GUIDANCE).toContain("dsh_plugins action search");
    expect(CREATOR_GUIDANCE).toContain("action fetch_npm");
    expect(CREATOR_GUIDANCE).toContain("action fetch_github");
    expect(CREATOR_GUIDANCE).toContain("github:owner/repo#commit");
    expect(CREATOR_GUIDANCE).toContain("official plugin manager");
    expect(CREATOR_GUIDANCE).not.toContain("curl");
    expect(CREATOR_GUIDANCE).toContain("dsh-v*");
    expect(CREATOR_GUIDANCE.length).toBeLessThan(1200);
  });
});
