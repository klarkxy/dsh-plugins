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
    expect(index).toContain('id="dsh-dev-index"');
    for (const area of catalog.areas) {
      expect(index).toContain(`id="${area.id}"`);
      expect(llms).toContain(area.file);
      const markdown = readFileSync(join(out, area.file), "utf8");
      expect(markdown.startsWith(`# ${area.title}\n`)).toBe(true);
      const html = readFileSync(join(out, "areas", `${area.id}.html`), "utf8");
      expect(html).toContain(`<h1 id="${slug(area.title)}">`);
      expect(html).toContain(catalog.indexed.commit);
    }
  });
});

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
}
