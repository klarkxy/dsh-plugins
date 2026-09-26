const BODY_LIMIT = 7500;

export const SKILL_NAME = "dsh-dev-index";

export const SKILL_DESCRIPTION =
  "Point at official DeepSeek Harness docs, the plugin-development skill, and runtime inspection. Do not invent APIs.";

export const SKILL_WHEN_TO_USE =
  "Use for DSH secondary development: tools, execution policy, settings UI, panels, session-derived state, or providers.";

export const OFFICIAL_DOCS_SITE = "https://deepseek-harness.github.io/deepseek-harness/";

export const OFFICIAL_LLMS_TXT = "https://deepseek-harness.github.io/deepseek-harness/llms.txt";

export const OFFICIAL_REPOSITORY = "https://github.com/deepseek-ai/deepseek-harness";

export const OFFICIAL_RAW_DOCS = "https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/";

export function renderSkillBody(): string {
  const lines = [
    "Deliver a verified DeepSeek Harness plugin. Do not invent APIs. This skill does not copy official material.",
    "",
    "1. Confirm the development goal and the target DSH version: the tag or commit the process is actually running.",
    "2. Inside a running DSH, prefer the official cordis-plugin-development skill when it is installed. Prefer cordis_inspect_list and cordis_inspect_query for what is actually mounted. Both are read-only and do not request danger-full-access. Every plugin_manager action needs danger-full-access or a one-off approval. The environment's own tool policy still applies. Outside DSH, do not assume that skill or those tools exist.",
    `3. For the latest published documentation, fetch ${OFFICIAL_LLMS_TXT} first. Use its links to read only the relevant raw .md pages; ${OFFICIAL_DOCS_SITE} is the human-facing site (Chinese at the root, English under /en/). Compare the published docs with the target version before relying on them.`,
    `4. For version-specific docs, type declarations, and source, use ${OFFICIAL_REPOSITORY}. Raw docs on master begin at ${OFFICIAL_RAW_DOCS}. If the running version differs from master, list tags on that repository, choose the matching dsh-v* tag, and read docs, type declarations, and source from that one tag. Never silently mix versions.`,
    "5. Official entry points on that same ref:",
    "- docs/cookbook/extension-cookbook.md",
    "- docs/subsystems/skills.md",
    "- docs/tool-catalog.md",
    "- docs/config-catalog.md",
    "- packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md",
    "- packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md",
    "6. Verify the exact APIs you will call against runtime inspection when it is available, otherwise against the chosen ref.",
    "7. Report which items were verified and which remain unverified.",
  ];
  const body = lines.join("\n");
  if (body.length > BODY_LIMIT) {
    throw new Error(`dsh-dev-index: skill body is ${body.length} characters; limit is ${BODY_LIMIT}`);
  }
  return body;
}
