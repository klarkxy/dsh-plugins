import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { cliEnvironment, runCli, type CliExecutable } from "@klarkxy/dsh-plugin-kit/cli-process";

export interface GhProbe {
  executable: CliExecutable;
  version: string;
}

export interface GhDeps {
  run?: typeof runCli;
  pathDirs?: string[];
  platform?: NodeJS.Platform;
}

// gh api and gh auth status are long-stable subcommands; the floor only rejects
// truly ancient binaries.
export const MIN_GH_VERSION: readonly [number, number, number] = [2, 0, 0];

export function parseGhVersion(stdout: string): [number, number, number] | null {
  const match = /^gh version (\d+)\.(\d+)\.(\d+)/.exec(stdout.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function belowFloor(version: [number, number, number]): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] !== MIN_GH_VERSION[index]) return version[index] < MIN_GH_VERSION[index];
  }
  return false;
}

export async function findGh(deps: GhDeps = {}): Promise<CliExecutable | null> {
  const platform = deps.platform ?? process.platform;
  const dirs = deps.pathDirs ?? (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  // shell:false cannot execute .cmd/.bat shims, so only real executables count.
  const files = platform === "win32" ? ["gh.exe"] : ["gh"];
  for (const dir of dirs) {
    for (const file of files) {
      const candidate = join(dir, file);
      try {
        await access(candidate);
        return { command: candidate, displayPath: candidate, env: cliEnvironment(process.env,
          ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_HOST", "GH_CONFIG_DIR"]) };
      } catch { /* keep looking */ }
    }
  }
  return null;
}

export async function probeGh(deps: GhDeps, signal: AbortSignal): Promise<GhProbe | null> {
  const run = deps.run ?? runCli;
  const executable = await findGh(deps);
  if (!executable) return null;
  try {
    const version = await run(executable, ["--version"], { cwd: tmpdir(), signal, timeoutMs: 10_000, maxOutputBytes: 4_096 });
    const parsed = version.exitCode === 0 ? parseGhVersion(version.stdout) : null;
    if (!parsed || belowFloor(parsed)) return null;
    // auth status is checked by exit code only; its (masked) output is discarded unread.
    const auth = await run(executable, ["auth", "status", "--hostname", "github.com"], {
      cwd: tmpdir(), signal, timeoutMs: 10_000, maxOutputBytes: 16_384,
    });
    if (auth.exitCode !== 0) return null;
    return { executable, version: parsed.join(".") };
  } catch {
    return null;
  }
}
