import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { loadCatalog, metaFromCatalog } from "../site/catalog.js";

const catalog = loadCatalog();

describe("pages site", () => {
  it("emits html, raw markdown, index.json, meta.json, and llms.txt", () => {
    const out = mkdtempSync(join(tmpdir(), "dsh-dev-index-"));
    execFileSync(process.execPath, ["scripts/build-site.mjs", out], {
      cwd: new URL("..", import.meta.url),
    });
    const published = JSON.parse(readFileSync(join(out, "index.json"), "utf8")) as typeof catalog;
    expect(published).toEqual(catalog);
    const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8")) as ReturnType<typeof metaFromCatalog>;
    expect(meta).toEqual(metaFromCatalog(catalog));
    const llms = readFileSync(join(out, "llms.txt"), "utf8");
    const index = readFileSync(join(out, "index.html"), "utf8");
    expect(readFileSync(join(out, ".nojekyll"), "utf8")).toBe("");
    expect(llms).toContain(catalog.indexed.commit);
    expect(llms).toContain(`${catalog.pagesBaseUrl}zh/llms.txt`);
    expect(index).toContain('id="dsh-dev-index"');
    expect(index).toContain('<html lang="en">');
    expect(index).toContain('lang="zh-CN">中文</a>');
    const zhIndex = readFileSync(join(out, "zh", "index.html"), "utf8");
    const zhLlms = readFileSync(join(out, "zh", "llms.txt"), "utf8");
    expect(zhIndex).toContain('<html lang="zh-CN">');
    expect(zhIndex).toContain('lang="en">English</a>');
    expect(zhLlms).toContain("[English](");
    expect(llms).toContain("tasks/index.md");
    expect(index).toContain('href="tasks/index.html"');
    expect(zhLlms).toContain("zh/tasks/index.md");
    for (const task of [...catalog.tasks, ...catalog.guides]) {
      expect(index).toContain(`tasks/${task.id}.html`);
      expect(llms).toContain(task.file);
      expect(zhLlms).toContain(task.fileZh);
      const markdown = readFileSync(join(out, task.file), "utf8");
      expect(markdown.split(/\r?\n/, 1)[0]).toBe(`# ${task.title}`);
      const html = readFileSync(join(out, "tasks", `${task.id}.html`), "utf8");
      expect(html).toContain(`<h1 id="${slug(task.title)}">`);
      expect(html).toContain(catalog.indexed.commit);
      expect(html).toContain(`../zh/tasks/${task.id}.html`);
      const zhHtml = readFileSync(join(out, "zh", "tasks", `${task.id}.html`), "utf8");
      expect(zhHtml).toContain('<html lang="zh-CN">');
      expect(zhHtml).toContain(`../../tasks/${task.id}.html`);
    }
    for (const area of catalog.areas) {
      expect(index).toContain(`id="${area.id}"`);
      expect(llms).toContain(area.file);
      expect(zhLlms).toContain(area.fileZh);
      const markdown = readFileSync(join(out, area.file), "utf8");
      expect(markdown.split(/\r?\n/, 1)[0]).toBe(`# ${area.title}`);
      const html = readFileSync(join(out, "areas", `${area.id}.html`), "utf8");
      expect(html).toContain(`<h1 id="${slug(area.title)}">`);
      expect(html).toContain(catalog.indexed.commit);
      expect(html).toContain(`../zh/areas/${area.id}.html`);
      const zhHtml = readFileSync(join(out, "zh", "areas", `${area.id}.html`), "utf8");
      expect(zhHtml).toContain('<html lang="zh-CN">');
      expect(zhHtml).toContain(`../../areas/${area.id}.html`);
      expect(zhHtml).toContain(catalog.indexed.commit);
    }
  });
});

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
}
