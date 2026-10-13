import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { files: string[] } & Record<string, unknown>;
const registryManifest = JSON.parse(
  readFileSync(new URL("../dsh.plugin.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const readmeZh = readFileSync(new URL("../README.zh-CN.md", import.meta.url), "utf8");

describe("prepare lifecycle", () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture({ workspace = true, built = false, exitCode = 0 } = {}) {
    // Spaces exercise Node/package-manager argument handling on Windows too.
    const root = mkdtempSync(join(tmpdir(), "dev index prepare "));
    fixtures.push(root);
    const plugin = join(root, "plugins", "dsh-dev-index");
    const installedKit = join(plugin, "node_modules", "@klarkxy", "dsh-plugin-kit");
    const kit = workspace ? join(root, "plugins", "dsh-plugin-kit") : installedKit;
    mkdirSync(join(plugin, "scripts"), { recursive: true });
    mkdirSync(kit, { recursive: true });
    copyFileSync(new URL("../scripts/prepare.mjs", import.meta.url), join(plugin, "scripts", "prepare.mjs"));
    writeFileSync(join(kit, "package.json"), JSON.stringify({
      name: "@klarkxy/dsh-plugin-kit",
      exports: { "./contracts": "./lib/contracts.js", "./package.json": "./package.json" },
    }));
    if (workspace) {
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - plugins/*\n");
      mkdirSync(join(plugin, "node_modules", "@klarkxy"), { recursive: true });
      symlinkSync(kit, installedKit, process.platform === "win32" ? "junction" : "dir");
    }
    if (built) {
      mkdirSync(join(kit, "lib"));
      writeFileSync(join(kit, "lib", "contracts.js"), "export {};\n");
    }
    const manager = join(root, "package manager.cjs");
    writeFileSync(manager, `require('node:fs').writeFileSync('build-called.json', JSON.stringify(process.argv.slice(2))); process.exit(${exitCode});`);
    // Windows environment keys are case-insensitive; avoid passing both the
    // inherited NPM_EXECPATH and our fixture's npm_execpath to spawnSync.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_execpath"));
    return {
      plugin, kit, root,
      run: () => spawnSync(process.execPath, [join(plugin, "scripts", "prepare.mjs")], {
        cwd: plugin,
        env: { ...env, npm_execpath: manager },
        encoding: "utf8",
      }),
    };
  }

  it("defers a clean workspace install without invoking build", () => {
    const { run, plugin } = fixture();
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("deferred until workspace plugin-kit is built");
    expect(existsSync(join(plugin, "build-called.json"))).toBe(false);
  });

  it.each([true, false])("builds when contracts resolve (workspace=%s)", (workspace) => {
    const { run, plugin } = fixture({ workspace, built: true });
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(plugin, "build-called.json"), "utf8"))).toEqual(["run", "build"]);
  });

  it("propagates a real build failure", () => {
    const { run } = fixture({ built: true, exitCode: 23 });
    expect(run().status).toBe(23);
  });

  it("does not hide missing published dependency output", () => {
    const { run, plugin } = fixture({ workspace: false });
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("MODULE_NOT_FOUND");
    expect(existsSync(join(plugin, "build-called.json"))).toBe(false);
  });

  it("does not hide an invalid contracts export in the workspace", () => {
    const { run, kit } = fixture();
    writeFileSync(join(kit, "package.json"), JSON.stringify({ exports: { "./package.json": "./package.json" } }));
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
  });
});

describe("bundle contract", () => {
  it("declares the DSH bundle patch and a prepare build", () => {
    expect(packageJson.name).toBe("@klarkxy/dsh-dev-index");
    expect(packageJson.packageManager).toBe("pnpm@10.29.2");
    // prepare builds for GitHub-spec installs, but skips cleanly when the
    // workspace-linked plugin-kit has no built lib yet (monorepo install).
    expect(packageJson.scripts).toMatchObject({
      prepare: "node scripts/prepare.mjs",
      prepack: "pnpm build",
    });
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
      "scripts/prepare.mjs",
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
      engines: { dsh: ">=0.2.0-rc.2" },
      contributes: { tools: ["dsh_docs_search", "dsh_docs_fetch"], skills: [] },
    });
    expect(packageJson.peerDependencies).toMatchObject({
      "@deepseek-ai/dsh-agent-preset-registry": ">=0.2.0-rc.2",
      "@deepseek-ai/dsh-system-prompt": ">=0.2.0-rc.2",
      "@deepseek-ai/dsh-tools": ">=0.2.0-rc.2",
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
