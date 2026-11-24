export const OFFICIAL_LLMS_TXT = "https://deepseek-harness.github.io/deepseek-harness/llms.txt";
export const OFFICIAL_REPOSITORY = "https://github.com/deepseek-ai/deepseek-harness";

export const CREATOR_GUIDANCE = [
  "When developing or debugging DSH plugins or agent presets:",
  `- Verify APIs in official docs via dsh_docs action search on ${OFFICIAL_LLMS_TXT} (indexes titles, categories, and paths), then action fetch by id. Use dsh_docs exclusively for official docs and report any retrieval errors rather than guessing APIs.`,
  "- Verify live Service, Event, Slot, and Tool contracts with cordis_inspect_list and targeted cordis_inspect_query.",
  "- Inspect candidate plugins (read-only) with dsh_plugins action search (catalog, npm, or GitHub via local gh CLI), action fetch_npm to pin an exact npm version, and action fetch_github to inspect a repo and pin a github:owner/repo#commit spec; perform all installs and removals through the official plugin manager and its approval flow.",
  `- Align all APIs with the running DSH version; when website docs differ, check the matching dsh-v* tag at ${OFFICIAL_REPOSITORY}.`,
  "- Cite the official doc URLs and runtime contracts consulted, and note any details that remain unverified.",
].join("\n");
