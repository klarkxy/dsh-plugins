import { describe, expect, it } from "vitest";

import { CREATOR_GUIDANCE, OFFICIAL_LLMS_TXT, OFFICIAL_REPOSITORY } from "../src/creator-guidance.js";
import { apply, resolveConfig, type CreatorPromptHost } from "../src/index.js";

describe("creator documentation guidance", () => {
  it("accepts an empty config and rejects leftover keys", () => {
    expect(resolveConfig(undefined)).toEqual({});
    expect(resolveConfig({})).toEqual({});
    expect(() => resolveConfig({ pagesBaseUrl: "https://example.com" } as never)).toThrow(/unknown config key/);
  });

  it("contributes official docs only to the Creator preset", () => {
    let section: Parameters<CreatorPromptHost["systemPrompt"]["section"]>[0] | undefined;
    let preset = "cordis";
    const toolNames: string[] = [];
    apply({
      tools: { register(tool: { name: string }) { toolNames.push(tool.name); return () => undefined; } },
      systemPrompt: {
        section(value: Parameters<CreatorPromptHost["systemPrompt"]["section"]>[0]) {
          section = value;
          return () => undefined;
        },
      },
      agentPresets: { composedPreset: () => preset },
      effect(callback: () => () => void) {
        callback();
        return () => undefined;
      },
    } as never, {});

    expect(section?.name).toBe("dsh-dev-index.creator-docs");
    expect(toolNames).toEqual(["dsh_docs_search", "dsh_docs_fetch", "dsh_plugins_search", "dsh_plugins_fetch"]);
    expect(section?.text({ agent: { ctx: {} as never } })).toBe(CREATOR_GUIDANCE);
    preset = "standard";
    expect(section?.text({ agent: { ctx: {} as never } })).toBe("");
    expect(section?.text({})).toBe("");
    expect(CREATOR_GUIDANCE).toContain(OFFICIAL_LLMS_TXT);
    expect(CREATOR_GUIDANCE).toContain(OFFICIAL_REPOSITORY);
    expect(CREATOR_GUIDANCE).toContain("cordis_inspect_list");
    expect(CREATOR_GUIDANCE).toContain("cordis_inspect_query");
    expect(CREATOR_GUIDANCE).toContain("dsh_docs_search");
    expect(CREATOR_GUIDANCE).toContain("dsh_docs_fetch");
    expect(CREATOR_GUIDANCE).toContain("dsh_plugins_search");
    expect(CREATOR_GUIDANCE).toContain("dsh_plugins_fetch");
    expect(CREATOR_GUIDANCE).toContain("github:owner/repo#commit");
    expect(CREATOR_GUIDANCE).toContain("official plugin manager");
    expect(CREATOR_GUIDANCE).not.toContain("curl");
    expect(CREATOR_GUIDANCE).toContain("dsh-v*");
    expect(CREATOR_GUIDANCE.length).toBeLessThan(1200);
  });
});
