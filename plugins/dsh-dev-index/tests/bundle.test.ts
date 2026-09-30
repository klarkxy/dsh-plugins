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
    expect(packageJson.name).toBe("@klarkxy/dsh-dev-index");
    expect(packageJson.packageManager).toBe("pnpm@10.29.2");
    expect(packageJson.scripts).toMatchObject({ prepare: "pnpm build" });
    expect(packageJson.dsh).toEqual({
      bundle: { patch: "./cordis.patch.yml" },
      client: {
        platform: "web",
        // The client half composes its controls from the host primitives, so
        // that module has to be in the host's table for `require` to resolve.
        // `slots.inject` already waits for the Plugins page seat, so neither a
        // stage-one prefetch nor a plugin-manager edge is needed.
        inject: [
          "@deepseek-ai/dsh-client-ui-primitives",
          "@deepseek-ai/dsh-client-locale",
        ],
      },
    });
    expect(packageJson.exports).toMatchObject({ "./client": "./client.js" });
    expect(packageJson.files).toEqual(expect.arrayContaining([
      "dsh.plugin.json",
      "client.js",
      "locale/*.json",
    ]));
    expect(packageJson.files.join("\n")).not.toMatch(/content\/|REFRESH\.md/);
  });

  it("records the Creator prompt dependencies without a skill contribution", () => {
    expect(registryManifest).toMatchObject({
      id: packageJson.name,
      version: packageJson.version,
      main: packageJson.main,
      engines: { dsh: ">=0.1.7-rc.2" },
      contributes: { tools: ["dsh_docs_search", "dsh_docs_fetch"], skills: [] },
    });
    expect(packageJson.peerDependencies).toMatchObject({
      "@deepseek-ai/dsh-agent-preset-registry": ">=0.1.7-rc.2",
      "@deepseek-ai/dsh-system-prompt": ">=0.1.7-rc.2",
      "@deepseek-ai/dsh-tools": ">=0.1.7-rc.2",
    });
    expect(packageJson.peerDependencies).not.toHaveProperty("@deepseek-ai/dsh-skill");
  });

  it("inserts the plugin with no config", () => {
    expect(patch).toContain("- insert:");
    expect(patch).toContain("- id: dsh-dev-index");
    expect(patch).toContain("name: '@klarkxy/dsh-dev-index'");
    expect(patch).not.toContain("pagesBaseUrl");
  });

  it("documents the official docs pointer in both languages", () => {
    for (const document of [readme, readmeZh]) {
      expect(document).toContain("allowBuilds:");
      expect(document).toContain("'@klarkxy/dsh-dev-index': true");
      expect(document).toContain("https://deepseek-harness.github.io/deepseek-harness/");
      expect(document).toContain("cordis_inspect_list");
      expect(document).toContain("dsh-dev-index");
      expect(document).not.toContain("ctx.skills.register");
      expect(document).not.toContain("pagesBaseUrl");
      expect(document).not.toContain("resourceBase");
      expect(document).not.toContain("content/");
      expect(document).not.toContain("REFRESH.md");
    }
  });
});
