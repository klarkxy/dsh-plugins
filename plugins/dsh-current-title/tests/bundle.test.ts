import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const registryManifest = JSON.parse(
  readFileSync(new URL("../dsh.plugin.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const readmeZh = readFileSync(new URL("../README.zh-CN.md", import.meta.url), "utf8");

describe("bundle contract", () => {
  it("declares the DSH bundle patch", () => {
    expect(packageJson.name).toBe("dsh-current-title");
    expect(packageJson.packageManager).toBe("pnpm@10.29.2");
    expect(packageJson.scripts).toMatchObject({ prepare: "pnpm build" });
    expect(packageJson.dsh).toEqual({ bundle: { patch: "./cordis.patch.yml" } });
  });

  it("declares ecosystem discovery and monorepo metadata", () => {
    expect(packageJson.keywords).toEqual(
      expect.arrayContaining(["dsh-plugin", "deepseek-harness", "session-title"]),
    );
    expect(packageJson.repository).toMatchObject({
      url: "git+https://github.com/klarkxy/dsh-plugins.git",
      directory: "plugins/dsh-current-title",
    });
    expect(packageJson.files).toContain("dsh.plugin.json");
    expect(packageJson.dependencies ?? {}).toEqual({});
    expect(packageJson.peerDependencies).toHaveProperty(
      "@deepseek-ai/schemastery",
      "^3.18.2",
    );
    expect(registryManifest).toMatchObject({
      id: packageJson.name,
      version: packageJson.version,
      main: packageJson.main,
      engines: { dsh: ">=0.1.2-rc.1" },
      contributes: { tools: [], skills: [] },
    });
  });

  it("disables the built-in provider and inserts the current-task provider", () => {
    expect(patch).toContain("- id: session-title-llm");
    expect(patch).toContain("name: '@deepseek-ai/dsh-session-title-first-prompt-llm'");
    expect(patch).toContain("disabled: true");
    expect(patch).toContain("- insert:");
    expect(patch).toContain("- id: current-session-title-llm");
    expect(patch).toContain("name: 'dsh-current-title'");
    for (const entry of [
      "maxRecentMessages: 8",
      "locale: auto",
      "targetWords: 5",
      "targetCjkCharacters: 10",
      "maxInputBytes: 4096",
      "maxOutputTokens: 64",
      "timeoutMs: 60000",
    ]) {
      expect(patch).toContain(entry);
    }
  });

  it("documents the pnpm 10 git-build allowlist used by the tested install", () => {
    for (const document of [readme, readmeZh]) {
      expect(document).toContain("onlyBuiltDependencies:");
      expect(document).toContain("- dsh-current-title");
      expect(document).not.toContain("allowBuilds:");
    }
  });
});
