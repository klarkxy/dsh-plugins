const BODY_LIMIT = 7500;

export const RAW_DOCS_BASE = "https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/";

export const SKILL_NAME = "dsh-dev-index";

export const SKILL_DESCRIPTION =
  "Look up DeepSeek Harness features and extension points before writing plugins, bundles, presets, patches, profiles, providers, tools, skills, hooks, or UI. Cites the official repository. Do not invent DSH APIs.";

export const SKILL_WHEN_TO_USE =
  "Use when the task is DSH secondary development: plugins, presets, patches, profiles, providers, tools, skills, hooks, MCP servers, UI slots, or config keys.";

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

export function renderSkillBody(pagesBaseUrl: string): string {
  const lines = [
    "Look up DeepSeek Harness before writing a plugin, preset, patch, profile, provider, tool, skill, hook, MCP server, or UI slot.",
    "做 DSH 二次开发时先读索引，再改代码。不要发明 API。本 skill 不内置文档副本。",
    "",
    "Fetch the always-current index from GitHub Pages:",
    `- ${pagesBaseUrl}llms.txt`,
    `- ${pagesBaseUrl}index.json`,
    `- ${pagesBaseUrl}meta.json`,
    `- ${pagesBaseUrl}areas/<id>.md`,
    "",
    "index.json is the catalog: area id, summary, and official source paths. meta.json records officialTag and officialCommit for the DeepSeek Harness revision those pages describe. Read index.json, then open the one area file the task needs.",
    "",
    "If the Pages site does not respond, fetch the same files from GitHub main:",
    `- ${RAW_DOCS_BASE}llms.txt`,
    `- ${RAW_DOCS_BASE}index.json`,
    `- ${RAW_DOCS_BASE}meta.json`,
    `- ${RAW_DOCS_BASE}areas/<id>.md`,
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
