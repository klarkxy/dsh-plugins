import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { docsDir, loadCatalog, metaFromCatalog, parseCatalog } from "../site/catalog.js";
import { AREA_IDS, SKILL_DESCRIPTION, SKILL_WHEN_TO_USE, TASK_IDS } from "../src/skill-body.js";

const catalog = loadCatalog();

describe("catalog", () => {
  it("pins the indexed DeepSeek Harness commit in meta.json", () => {
    const meta = JSON.parse(readFileSync(resolve(docsDir, "meta.json"), "utf8")) as {
      officialRepository: string;
      officialTag: string;
      officialCommit: string;
    };
    expect(meta).toEqual(metaFromCatalog(catalog));
    expect(catalog.indexed.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(catalog.indexed.tag).toMatch(/^dsh-v/);
    expect(catalog.indexed.repository).toBe("https://github.com/deepseek-ai/deepseek-harness");
    expect(catalog.pagesBaseUrl).toBe("https://klarkxy.github.io/dsh-plugins/");
    expect(catalog.skill.name).toBe("dsh-dev-index");
    expect(catalog.skill.description).toBe(SKILL_DESCRIPTION);
    expect(catalog.skill.whenToUse).toBe(SKILL_WHEN_TO_USE);
    expect(catalog.skill.description.length).toBeLessThanOrEqual(500);
    expect(catalog.areas.map((area) => area.id)).toEqual([...AREA_IDS]);
    expect(catalog.tasks.map((task) => task.id)).toEqual([...TASK_IDS]);
    expect(catalog.guides.map((guide) => guide.id)).toEqual(["architecture-rules"]);
  });

  it("keeps every area traceable to official paths named in that page", () => {
    expect(catalog.areas.length).toBeGreaterThan(0);
    for (const area of catalog.areas) {
      const markdown = readFileSync(new URL(area.file, new URL("../../../docs/", import.meta.url)), "utf8");
      expect(markdown.split(/\r?\n/, 1)[0]).toBe(`# ${area.title}`);
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

  it("keeps every task and guide traceable, bilingual, and linked to real areas", () => {
    const entries = [...catalog.tasks, ...catalog.guides];
    expect(entries.length).toBeGreaterThan(0);
    const areaIds = new Set(catalog.areas.map((area) => area.id));
    for (const entry of entries) {
      expect(entry.runnableExample).toBe("not-yet");
      expect(entry.areas.length).toBeGreaterThan(0);
      const markdown = readFileSync(new URL(entry.file, new URL("../../../docs/", import.meta.url)), "utf8");
      const zh = readFileSync(new URL(entry.fileZh, new URL("../../../docs/", import.meta.url)), "utf8");
      expect(markdown.split(/\r?\n/, 1)[0]).toBe(`# ${entry.title}`);
      expect(markdown).toContain("Runnable example: not yet (planned)");
      expect(zh).toContain("Runnable example: not yet (planned)");
      expect(markdown).toContain(catalog.indexed.commit);
      expect(zh).toContain(catalog.indexed.commit);
      for (const areaId of entry.areas) {
        expect(areaIds.has(areaId)).toBe(true);
        expect(markdown).toContain(`areas/${areaId}.md`);
        expect(zh).toContain(`areas/${areaId}.md`);
      }
      for (const source of entry.sources) {
        const blob = `https://github.com/deepseek-ai/deepseek-harness/blob/${catalog.indexed.commit}/${source}`;
        expect(markdown).toContain(blob);
        expect(zh).toContain(blob);
      }
    }
    const index = readFileSync(new URL("tasks/index.md", new URL("../../../docs/", import.meta.url)), "utf8");
    const indexZh = readFileSync(new URL("zh/tasks/index.md", new URL("../../../docs/", import.meta.url)), "utf8");
    expect(index).toContain(catalog.indexed.commit);
    expect(indexZh).toContain(catalog.indexed.commit);
    for (const id of TASK_IDS) {
      expect(index).toContain(`${id}.md`);
      expect(indexZh).toContain(`${id}.md`);
    }
  });

  const checkout = process.env.DSH_CHECKOUT ?? "/tmp/deepseek-harness";
  const checkoutReady = existsSync(resolve(checkout, "packages/README.md"));
  const skipReason =
    `no DeepSeek Harness checkout at ${checkout} (set DSH_CHECKOUT, or run plugins/dsh-dev-index/scripts/fetch-pinned.mjs). ` +
    "Source-path checks were not executed.";
  if (!checkoutReady) {
    console.warn(`dsh-dev-index: SKIP source-path check: ${skipReason}`);
  }

  if (process.env.DSH_REQUIRE_CHECKOUT === "1" && !checkoutReady) {
    it("requires a DeepSeek Harness checkout for source-path checks", () => {
      throw new Error(`source-path check did not run: ${skipReason}`);
    });
  }

  const cite = checkoutReady ? it : it.skip;
  cite(
    checkoutReady
      ? "checks cited paths against the local DeepSeek Harness checkout"
      : `SKIP source-path check: ${skipReason}`,
    () => {
      const missing: string[] = [];
      for (const page of [...catalog.areas, ...catalog.tasks, ...catalog.guides]) {
        for (const source of page.sources) {
          if (!existsSync(resolve(checkout, source))) missing.push(`${page.id}: ${source}`);
        }
      }
      expect(missing).toEqual([]);
      const head = readFileSync(resolve(checkout, ".git/HEAD"), "utf8").trim();
      if (/^[0-9a-f]{40}$/.test(head)) expect(head).toBe(catalog.indexed.commit);
    },
  );
});
