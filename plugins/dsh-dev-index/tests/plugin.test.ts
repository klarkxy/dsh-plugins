import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { metaFromCatalog, loadCatalog } from "../site/catalog.js";
import { apply, createSkill, resolveConfig, type IndexedSkill } from "../src/index.js";
import { AREA_IDS, RAW_DOCS_BASE, renderSkillBody } from "../src/skill-body.js";

const catalog = loadCatalog();
const meta = metaFromCatalog(catalog);

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

  it("registers a pointer skill and does not embed the indexed revision", () => {
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
      { pagesBaseUrl: "https://klarkxy.github.io/dsh-plugins/" },
    );
    expect(registered).toHaveLength(1);
    const skill = registered[0];
    expect(skill).toEqual(createSkill("https://klarkxy.github.io/dsh-plugins/"));
    expect(skill.name).toBe("dsh-dev-index");
    expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true });
    expect(skill).not.toHaveProperty("resourceBase");
    expect(skill.content).toBe(renderSkillBody("https://klarkxy.github.io/dsh-plugins/"));
    expect(skill.content.length).toBeLessThanOrEqual(7500);
    expect(skill.content).toContain("https://klarkxy.github.io/dsh-plugins/llms.txt");
    expect(skill.content).toContain("https://klarkxy.github.io/dsh-plugins/index.json");
    expect(skill.content).toContain("https://klarkxy.github.io/dsh-plugins/areas/<id>.md");
    expect(skill.content).toContain(`${RAW_DOCS_BASE}llms.txt`);
    expect(skill.content).toContain(`${RAW_DOCS_BASE}index.json`);
    expect(skill.content).toContain(`${RAW_DOCS_BASE}areas/<id>.md`);
    expect(skill.content).not.toContain(meta.officialCommit);
    expect(skill.content).not.toContain(meta.officialTag);
    expect(AREA_IDS).toEqual(catalog.areas.map((area) => area.id));
    for (const id of AREA_IDS) expect(skill.content).toContain(`- ${id}`);
    const packed = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    expect(packed).not.toContain("content/");
  });
});
