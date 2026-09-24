import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const installer = fileURLToPath(new URL("../install.mjs", import.meta.url));
const source = new URL("../presets/pruner/", import.meta.url);
const homes: string[] = [];
function home() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-pruner-test-"));
  homes.push(dir);
  return dir;
}
afterEach(() => homes.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe("native preset installation", () => {
  it("copies all preset assets into a home with spaces without touching other presets or settings", () => {
    const dir = join(home(), "DSH home");
    const other = join(dir, ".agent-presets", "personal");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "preset.yml"), "name: Personal\n");
    writeFileSync(join(dir, "settings.yaml"), "agent-presets:\n  default: personal\n");
    const before = readFileSync(join(dir, "settings.yaml"), "utf8");
    execFileSync(process.execPath, [installer, "--home", dir]);
    for (const name of readdirSync(source)) {
      expect(readFileSync(join(dir, ".agent-presets", "pruner", name), "utf8"))
        .toBe(readFileSync(new URL(name, source), "utf8"));
    }
    expect(readFileSync(join(dir, "settings.yaml"), "utf8")).toBe(before);
    expect(readFileSync(join(other, "preset.yml"), "utf8")).toBe("name: Personal\n");
  });

  it.each(["directory", "file"])("refuses an existing %s without overwriting it", kind => {
    const dir = home();
    const root = join(dir, ".agent-presets");
    const target = join(root, "pruner");
    mkdirSync(root);
    if (kind === "directory") mkdirSync(target);
    const file = kind === "directory" ? join(target, "agent.cordis.yml") : target;
    writeFileSync(file, "user authored");
    const result = spawnSync(process.execPath, [installer, "--home", dir], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
    expect(readFileSync(file, "utf8")).toBe("user authored");
  });

  it("honors DSH_HOME and lets the explicit home override it", () => {
    const envHome = home();
    const explicitHome = home();
    execFileSync(process.execPath, [installer], { env: { ...process.env, DSH_HOME: envHome } });
    expect(readdirSync(join(envHome, ".agent-presets", "pruner"))).toContain("agent.cordis.yml");
    execFileSync(process.execPath, [installer, "--home", explicitHome], {
      env: { ...process.env, DSH_HOME: envHome },
    });
    expect(readdirSync(join(explicitHome, ".agent-presets", "pruner"))).toContain("preset.yml");
  });

  it("shows help and rejects malformed options without installing", () => {
    const dir = home();
    const options = { env: { ...process.env, DSH_HOME: dir }, encoding: "utf8" as const };
    expect(spawnSync(process.execPath, [installer, "--help"], options).status).toBe(0);
    for (const args of [["--home"], ["--force"], ["--home", ""]]) {
      expect(spawnSync(process.execPath, [installer, ...args], options).status).toBe(1);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("matches the host for blank environment values and tilde paths", () => {
    const userHome = home();
    const env = { ...process.env, HOME: userHome, USERPROFILE: userHome, DSH_HOME: "   " };
    execFileSync(process.execPath, [installer], { env });
    expect(readdirSync(join(userHome, ".dsh", ".agent-presets", "pruner"))).toContain("preset.yml");
    for (const configured of ["~/custom", "~\\second", "~"]) {
      execFileSync(process.execPath, [installer, "--home", configured], { env });
    }
    for (const suffix of ["custom", "second", ""]) {
      expect(readdirSync(join(userHome, suffix, ".agent-presets", "pruner"))).toContain("preset.yml");
    }
  });

  it("refuses a second install and preserves local edits", () => {
    const dir = home();
    execFileSync(process.execPath, [installer, "--home", dir]);
    const file = join(dir, ".agent-presets", "pruner", "agent.cordis.yml");
    writeFileSync(file, "customized prompt");
    expect(spawnSync(process.execPath, [installer, "--home", dir]).status).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("customized prompt");
  });
});
