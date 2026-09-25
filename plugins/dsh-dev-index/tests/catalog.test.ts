import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadCatalog, parseCatalog } from "../src/catalog.js";
import { readArea } from "../src/index.js";

const catalog = loadCatalog();

describe("catalog", () => {
  it("pins the indexed DeepSeek Harness commit", () => {
    expect(catalog.indexed.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(catalog.indexed.tag).toBe("dsh-v0.1.7-rc.2");
    expect(catalog.indexed.repository).toBe("https://github.com/deepseek-ai/deepseek-harness");
    expect(catalog.pagesBaseUrl).toBe("https://klarkxy.github.io/dsh-plugins/");
    expect(catalog.skill.name).toBe("dsh-dev-index");
    expect(catalog.skill.description.length).toBeLessThanOrEqual(500);
  });

  it("keeps every area traceable to official paths named in that page", () => {
    expect(catalog.areas.length).toBeGreaterThan(0);
    for (const area of catalog.areas) {
      const markdown = readArea(catalog, area.id);
      expect(markdown.startsWith(`# ${area.title}\n`)).toBe(true);
      expect(markdown).toContain(catalog.indexed.commit);
      expect(area.sources.length).toBeGreaterThan(0);
      for (const source of area.sources) {
        expect(markdown).toContain(source);
        expect(markdown).toContain(
          `https://github.com/deepseek-ai/deepseek-harness/blob/${catalog.indexed.commit}/${source}`,
        );
      }
    }
  });

  it("rejects a catalog that drops its sources", () => {
    const broken = JSON.parse(JSON.stringify(catalog)) as { areas: Array<{ sources: string[] }> };
    broken.areas[0].sources = [];
    expect(() => parseCatalog(JSON.stringify(broken))).toThrow(/sources/);
  });

  it("checks cited paths when a local DeepSeek Harness checkout is present", () => {
    const checkout = process.env.DSH_CHECKOUT ?? "/tmp/deepseek-harness";
    if (!existsSync(resolve(checkout, "packages/README.md"))) return;
    const missing: string[] = [];
    for (const area of catalog.areas) {
      for (const source of area.sources) {
        if (!existsSync(resolve(checkout, source))) missing.push(`${area.id}: ${source}`);
      }
    }
    expect(missing).toEqual([]);
    const head = readFileSync(resolve(checkout, ".git/HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) expect(head).toBe(catalog.indexed.commit);
  });
});
