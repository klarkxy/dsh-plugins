export const OFFICIAL_LLMS_TXT = "https://deepseek-harness.github.io/deepseek-harness/llms.txt";
export const OFFICIAL_REPOSITORY = "https://github.com/deepseek-ai/deepseek-harness";

export const CREATOR_GUIDANCE = [
  "Before developing or debugging DSH plugins or agent presets:",
  `- Verify APIs in official docs: dsh_docs_search on ${OFFICIAL_LLMS_TXT} (titles, categories and paths, not full text), then dsh_docs_fetch by id. No shell or web_fetch. Report retrieval errors; never invent APIs.`,
  "- Verify runtime Service, Event, Slot and Tool contracts with cordis_inspect_list and focused cordis_inspect_query.",
  "- dsh_plugins_search finds candidates; dsh_plugins_fetch pins an exact version. Neither installs: installs and removals, including github:owner/repo#commit specs, go through the official plugin manager with its approval flow.",
  `- Match the running DSH version; when docs differ, use the matching dsh-v* tag at ${OFFICIAL_REPOSITORY}. Never mix versions.`,
  "- Report the official pages and runtime contracts used, and anything unverified.",
].join("\n");
