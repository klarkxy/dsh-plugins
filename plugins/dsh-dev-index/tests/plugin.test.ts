import { describe, expect, it } from "vitest";

import { contentDir, loadCatalog } from "../src/catalog.js";
import { apply, createSkill, resolveConfig, type IndexedSkill } from "../src/index.js";
import { renderSkillBody } from "../src/skill-body.js";

const catalog = loadCatalog();

describe("plugin", () => {
  it("normalizes the pages URL and rejects unknown keys", () => {
    expect(resolveConfig({ pagesBaseUrl: "https://klarkxy.github.io/dsh-plugins" }).pagesBaseUrl).toBe(
      "https://klarkxy.github.io/dsh-plugins/",
    );
    expect(() => resolveConfig({ pagesBaseUrl: "ftp://example.test/" })).toThrow(/http/);
    expect(() =>
      resolveConfig({ pagesBaseUrl: "https://klarkxy.github.io/dsh-plugins/", extra: true } as never),
    ).toThrow(/unknown config key/);
  });

  it("registers one runtime skill whose body names every area", () => {
    const registered: unknown[] = [];
    apply(
      {
        skills: {
          register(skill: IndexedSkill) {
            registered.push(skill);
            return () => undefined;
          },
        },
      } as never,
      { pagesBaseUrl: "https://klarkxy.github.io/dsh-plugins/" },
    );
    expect(registered).toHaveLength(1);
    const skill = createSkill(catalog, "https://klarkxy.github.io/dsh-plugins/");
    expect(skill.name).toBe("dsh-dev-index");
    expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true });
    expect(skill.resourceBase).toEqual({ kind: "directory", path: contentDir });
    expect(skill.content).toBe(renderSkillBody(catalog, "https://klarkxy.github.io/dsh-plugins/"));
    expect(skill.content.length).toBeLessThanOrEqual(7500);
    expect(skill.content).toContain(catalog.indexed.commit);
    for (const area of catalog.areas) {
      expect(skill.content).toContain(area.id);
      expect(skill.content).toContain(area.file);
    }
  });
});
