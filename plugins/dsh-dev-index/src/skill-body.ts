const BODY_LIMIT = 7500;

export const RAW_DOCS_BASE = "https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/";

export const SKILL_NAME = "dsh-dev-index";

export const SKILL_DESCRIPTION =
  "Pick a DeepSeek Harness extension mechanism and deliver a verified plugin. Prefer the official plugin-development skill and runtime inspection inside DSH. Cite pinned docs. Do not invent APIs.";

export const SKILL_WHEN_TO_USE =
  "Use for DSH secondary development when choosing how to extend the harness: tools, execution policy, settings UI, panels, session-derived state, or providers.";

/** Area ids the skill names so an agent knows what to fetch. Docs stay authoritative. */
export const AREA_IDS = [
  "orientation",
  "plugin-module",
  "bundle-profile-patch",
  "cli",
  "tools",
  "skills",
  "presets-persona",
  "system-prompt",
  "sessions-titles",
  "llm-providers",
  "hooks",
  "mcp",
  "ui-slots",
  "settings-approval",
  "plugin-manager-inspect",
  "other-seams",
] as const;

/** Task ids. The architecture-rules guide is a page, not a task pack. */
export const TASK_IDS = [
  "add-a-tool",
  "add-a-tool-policy",
  "add-a-settings-ui",
  "add-a-ui-panel",
  "add-session-derived-state",
  "implement-or-replace-a-provider",
] as const;

export function renderSkillBody(pagesBaseUrl: string): string {
  const lines = [
    "Deliver a verified DeepSeek Harness plugin. Do not invent APIs. This skill does not bundle a copy of the docs.",
    "",
    "1. Confirm the development goal and the target DSH version: the tag or commit the process is actually running.",
    "2. Read meta.json. officialTag and officialCommit are the DSH revision these pages were written against. officialDocsSite is the human-readable official documentation. If the target version differs, treat every page as unverified for that version and check type declarations and source pinned to the target commit. Do not silently substitute this index for another version.",
    "3. Inside a running DSH, check whether the official cordis-plugin-development skill and the runtime tools cordis_inspect_list and cordis_inspect_query are available. Prefer that skill for install, configuration, and debugging, and prefer those tools for what is actually mounted. cordis_inspect_query does not itself request danger-full-access. Every plugin_manager action does. The environment's tool permission policy still applies to both.",
    "4. Outside DSH, do not assume those tools exist. Read the official documentation site for the narrative, then type declarations and source pinned to the target version. Mark every conclusion that could not be runtime-verified.",
    "5. Open the task index, pick one task, and load the linked area pages, official contracts, and constraints. Read tasks/architecture-rules.md before choosing a mechanism.",
    "6. Verify the exact APIs you will call. Use runtime inspection when it is available. Otherwise use the pinned types. Do not copy an API from memory.",
    "7. Implement, then run that task's verification checklist.",
    "8. Report which checklist items were verified and which remain unverified.",
    "",
    "Readable official documentation: https://deepseek-harness.github.io/deepseek-harness/ (Chinese at the site root, English under /en/). Its llms.txt is https://deepseek-harness.github.io/deepseek-harness/llms.txt. That site is the latest published release, so compare it with the target version. Pinned commit and path citations in this index are what you verify. The site link is for reading.",
    "",
    "Context7 (/deepseek-ai/deepseek-harness) tracks master. Use it only as a secondary source for scattered examples. It is not this index's pinned revision. If it disagrees with the target version, ignore it.",
    "",
    "Fetch the English index from GitHub Pages:",
    `- ${pagesBaseUrl}llms.txt`,
    `- ${pagesBaseUrl}index.json`,
    `- ${pagesBaseUrl}meta.json`,
    `- ${pagesBaseUrl}tasks/index.md`,
    `- ${pagesBaseUrl}tasks/<id>.md`,
    `- ${pagesBaseUrl}tasks/architecture-rules.md`,
    `- ${pagesBaseUrl}areas/<id>.md`,
    "",
    "index.json lists task ids, guide ids, and area ids. meta.json records officialTag, officialCommit, and officialDocsSite. English is the default. Simplified Chinese human-readable pages live under zh/ (zh/llms.txt, zh/tasks/<id>.md, zh/areas/<id>.md). index.json and meta.json stay in English.",
    "",
    "If the Pages site does not respond, fetch the same files from GitHub main:",
    `- ${RAW_DOCS_BASE}llms.txt`,
    `- ${RAW_DOCS_BASE}index.json`,
    `- ${RAW_DOCS_BASE}meta.json`,
    `- ${RAW_DOCS_BASE}tasks/index.md`,
    `- ${RAW_DOCS_BASE}tasks/<id>.md`,
    `- ${RAW_DOCS_BASE}tasks/architecture-rules.md`,
    `- ${RAW_DOCS_BASE}areas/<id>.md`,
    "",
    "Task ids:",
    ...TASK_IDS.map((id) => `- ${id}`),
    "",
    "Area ids:",
    ...AREA_IDS.map((id) => `- ${id}`),
  ];
  const body = lines.join("\n");
  if (body.length > BODY_LIMIT) {
    throw new Error(`dsh-dev-index: skill body is ${body.length} characters; limit is ${BODY_LIMIT}`);
  }
  return body;
}
