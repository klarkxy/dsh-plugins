import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { apply, createSkill, resolveConfig, type IndexedSkill } from "../src/index.js";
import {
  OFFICIAL_DOCS_SITE,
  OFFICIAL_LLMS_TXT,
  OFFICIAL_RAW_DOCS,
  OFFICIAL_REPOSITORY,
  renderSkillBody,
} from "../src/skill-body.js";

describe("plugin", () => {
  it("accepts an empty config and rejects leftover keys", () => {
    expect(resolveConfig(undefined)).toEqual({});
    expect(resolveConfig({})).toEqual({});
    expect(() => resolveConfig({ pagesBaseUrl: OFFICIAL_DOCS_SITE } as never)).toThrow(/unknown config key/);
  });

  it("registers a static pointer at official material", () => {
    const registered: IndexedSkill[] = [];
    apply(
      {
        skills: {
          register(skill: IndexedSkill) {
            registered.push(skill);
            return () => undefined;
          },
        },
      } as never,
      {},
    );
    expect(registered).toEqual([createSkill()]);
    const skill = registered[0];
    expect(skill.name).toBe("dsh-dev-index");
    expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true });
    expect(skill).not.toHaveProperty("resourceBase");
    expect(skill.content).toBe(renderSkillBody());
    expect(skill.content.length).toBeLessThanOrEqual(7500);
    expect(skill.content).toContain("cordis-plugin-development");
    expect(skill.content).toContain("cordis_inspect_list");
    expect(skill.content).toContain("cordis_inspect_query");
    expect(skill.content).toContain("danger-full-access");
    expect(skill.content).toContain("plugin_manager");
    expect(skill.content).toContain(OFFICIAL_DOCS_SITE);
    expect(skill.content).toContain("/en/");
    expect(skill.content).toContain(OFFICIAL_LLMS_TXT);
    expect(skill.content).toContain("latest published release");
    expect(skill.content).toContain(OFFICIAL_REPOSITORY);
    expect(skill.content).toContain(OFFICIAL_RAW_DOCS);
    expect(skill.content).toContain("dsh-v*");
    expect(skill.content).toContain("Never silently mix versions");
    expect(skill.content).toContain("docs/cookbook/extension-cookbook.md");
    expect(skill.content).toContain("docs/cookbook/");
    expect(skill.content).toContain("docs/subsystems/");
    expect(skill.content).toContain("docs/tool-catalog.md");
    expect(skill.content).toContain("docs/config-catalog.md");
    expect(skill.content).toContain("references/practices.md");
    expect(skill.content).toContain("remain unverified");
    expect(skill.content).not.toMatch(/[0-9a-f]{40}/);
    expect(skill.content).not.toMatch(/dsh-v\d/);
    expect(skill.content).not.toContain("klarkxy.github.io");
    expect(skill.content).not.toContain("pagesBaseUrl");
    const packed = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    expect(packed).not.toContain("content/");
  });
});
