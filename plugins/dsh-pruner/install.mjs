#!/usr/bin/env node
import { cp, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit native-preset installation. No lifecycle hooks or host config edits.
const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: dsh-pruner-install [--home <DSH_HOME>]\nCopies Pruner without replacing an existing preset.");
} else {
  let target;
  let created = false;
  try {
    if (args.length !== 0 && !(args.length === 2 && args[0] === "--home" && args[1].trim())) {
      throw new Error("Usage: dsh-pruner-install [--home <DSH_HOME>]");
    }
    const fromEnv = process.env.DSH_HOME;
    const configured = args[1] ?? (fromEnv?.trim() ? fromEnv : join(homedir(), ".dsh"));
    const expanded = configured === "~" ? homedir()
      : configured.startsWith("~/") || configured.startsWith("~\\")
        ? join(homedir(), configured.slice(2)) : configured;
    const home = resolve(expanded);
    const root = join(home, ".agent-presets");
    target = join(root, "pruner");
    await mkdir(root, { recursive: true });
    // Exclusive reservation rejects existing directories, files, and symlinks.
    await mkdir(target);
    created = true;
    const source = fileURLToPath(new URL("./presets/pruner", import.meta.url));
    for (const entry of await readdir(source)) {
      await cp(join(source, entry), join(target, entry), {
        recursive: true, force: false, errorOnExist: true,
      });
    }
    console.log(`Installed: ${target}\nStart a new DSH session and select 删繁 / Pruner. Choose a strong reasoning model in the model picker.`);
  } catch (error) {
    const detail = error.code === "EEXIST" && !created
      ? `Preset already exists: ${target}. Back it up and move it aside before installing an update.`
      : `${error.message}${created ? `\nInstallation is incomplete at ${target}; inspect and move it aside before retrying.` : ""}`;
    console.error(`Pruner: ${detail}`);
    process.exitCode = 1;
  }
}
