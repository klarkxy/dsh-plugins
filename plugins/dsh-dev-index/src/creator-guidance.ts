export const OFFICIAL_LLMS_TXT = "https://deepseek-harness.github.io/deepseek-harness/llms.txt";
export const OFFICIAL_REPOSITORY = "https://github.com/deepseek-ai/deepseek-harness";

export const CREATOR_GUIDANCE = [
  "Before developing or debugging DSH plugins or agent presets, consult official docs:",
  `- Use dsh_docs_search to search the current official directory (${OFFICIAL_LLMS_TXT}), then dsh_docs_fetch to read relevant Markdown. These tools need no shell or web_fetch.`,
  "- Search uses titles/categories/paths, not full text. Use short topic keywords. Follow nextOffset with the same revision to finish long pages. Report retrieval errors; do not invent APIs.",
  "- Use cordis_inspect_list and focused cordis_inspect_query calls to verify runtime Service, Event, Slot, and Tool contracts.",
  "- Use dsh_plugins_search to discover DSH plugins, then dsh_plugins_fetch to verify npm metadata and pin an exact version; they never install anything. Installs and removals, including github:owner/repo#commit specs, go through the official plugin manager with its approval flow.",
  `- Check the running DSH version; if docs differ, use its matching dsh-v* tag at ${OFFICIAL_REPOSITORY} for docs, types, and source. Do not mix versions.`,
  "- Report the official pages and runtime contracts used, and anything unverified.",
].join("\n");
