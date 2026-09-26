import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs");
const meta = JSON.parse(readFileSync(resolve(docsDir, "meta.json"), "utf8"));
const commit = meta.officialCommit;
const repo = meta.officialRepository;
if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
  process.stderr.write("docs/meta.json officialCommit is not a 40-character sha\n");
  process.exit(1);
}

const dest = resolve(process.argv[2] ?? process.env.DSH_CHECKOUT ?? "/tmp/deepseek-harness");

function head() {
  try {
    return execFileSync("git", ["-C", dest, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

if (existsSync(resolve(dest, "packages/README.md")) && head() === commit) {
  process.stdout.write(`pinned checkout already at ${commit} (${dest})\n`);
  process.exit(0);
}

if (existsSync(dest)) {
  process.stderr.write(
    `refusing to reuse ${dest}: HEAD is ${head() || "missing"}, want ${commit}. ` +
    "Remove it or pass a different destination.\n",
  );
  process.exit(1);
}

execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", `${repo}.git`, dest], { stdio: "inherit" });
execFileSync("git", ["-C", dest, "fetch", "--depth", "1", "origin", commit], { stdio: "inherit" });
execFileSync("git", ["-C", dest, "checkout", "--detach", "FETCH_HEAD"], { stdio: "inherit" });

const actual = head();
if (actual !== commit) {
  process.stderr.write(`checkout HEAD ${actual} does not match ${commit}\n`);
  process.exit(1);
}
process.stdout.write(`fetched ${commit} into ${dest}\n`);
