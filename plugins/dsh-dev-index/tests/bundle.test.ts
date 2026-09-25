import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { files: string[] } & Record<string, unknown>;
const registryManifest = JSON.parse(
  readFileSync(new URL("../dsh.plugin.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const readmeZh = readFileSync(new URL("../README.zh-CN.md", import.meta.url), "utf8");

describe("bundle contract", () => {
  it("declares the DSH bundle patch and a prepare build", () => {
    expect(packageJson.name).toBe("dsh-dev-index");
    expect(packageJson.packageManager).toBe("pnpm@10.29.2");
    expect(packageJson.scripts).toMatchObject({ prepare: "pnpm build" });
    expect(packageJson.dsh).toEqual({ bundle: { patch: "./cordis.patch.yml" } });
    expect(packageJson.files).toEqual(expect.arrayContaining([
      "dsh.plugin.json",
      "locale/*.json",
    ]));
    expect(packageJson.files.join("\n")).not.toMatch(/content\/|REFRESH\.md/);
  });

  it("records the skill contribution for this monorepo", () => {
    expect(registryManifest).toMatchObject({
      id: packageJson.name,
      version: packageJson.version,
      main: packageJson.main,
      engines: { dsh: ">=0.1.7-rc.2 <0.2.0" },
      contributes: { tools: [], skills: ["dsh-dev-index"] },
    });
    expect(packageJson.peerDependencies).toMatchObject({
      "@deepseek-ai/dsh-skill": ">=0.1.7-rc.2 <0.2.0",
    });
  });

  it("inserts the index plugin with the pages URL", () => {
    expect(patch).toContain("- insert:");
    expect(patch).toContain("- id: dsh-dev-index");
    expect(patch).toContain("name: 'dsh-dev-index'");
    expect(patch).toContain("pagesBaseUrl: https://klarkxy.github.io/dsh-plugins/");
  });

  it("documents install, the skill, and the Pages site in both languages", () => {
    for (const document of [readme, readmeZh]) {
      expect(document).toContain("allowBuilds:");
      expect(document).toContain("dsh-dev-index: true");
      expect(document).toContain("https://klarkxy.github.io/dsh-plugins/");
      expect(document).toContain("https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/");
      expect(document).toContain("dsh-dev-index");
      expect(document).toContain("ctx.skills.register");
      expect(document).not.toContain("resourceBase");
      expect(document).not.toContain("content/");
    }
  });
});
