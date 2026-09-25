import type { Catalog } from "./catalog.js";

const BODY_LIMIT = 7500;

export function renderSkillBody(catalog: Catalog, pagesBaseUrl: string): string {
  const lines = [
    "Look up DeepSeek Harness before writing a plugin, preset, patch, profile, provider, tool, skill, hook, MCP server, or UI slot.",
    "做 DSH 二次开发时先读本索引，再改代码。不要发明 API。官方仓库与本页冲突时，以本页记录的 commit 为准；你正在运行的宿主与本页冲突时，以宿主为准并刷新索引。",
    "",
    `Indexed repository: ${catalog.indexed.repository}`,
    `Tag: ${catalog.indexed.tag}`,
    `Commit: ${catalog.indexed.commit}`,
    `Committed at: ${catalog.indexed.committedAt}`,
    `Subject: ${catalog.indexed.subject}`,
    "",
    "Offline files resolve against this skill's base directory:",
    "- index.json",
    "- areas/<id>.md",
    "",
    "Online copies, when the base directory is not on disk:",
    `- ${pagesBaseUrl}index.json`,
    `- ${pagesBaseUrl}llms.txt`,
    `- ${pagesBaseUrl}index.html`,
    `- ${pagesBaseUrl}areas/<id>.md`,
    `- ${pagesBaseUrl}areas/<id>.html`,
    "",
    "Read index.json, then open the one area file for the task. Each area states what the feature is, the official file path, the contract, and how a plugin author extends it. GitHub links are pinned to the commit above.",
    "",
    "Areas:",
  ];
  for (const area of catalog.areas) {
    lines.push(`- ${area.id}: ${area.summary} File: ${area.file}. ${area.summaryZh}`);
  }
  lines.push(
    "",
    "Rules that are easy to get wrong:",
    "- A bundle declares package.json dsh.bundle.patch. A profile declares dsh.profile.bundles. The repository root of a plugin monorepo is not a bundle.",
    "- Later patch layers win per row. config replacement is the whole object, not a deep merge.",
    "- engines.dsh is not enforced. peerDependencies on @deepseek-ai/dsh and @deepseek-ai/dsh-* are checked against the running DSH version.",
    "- Git installs run prepare only after the profile allowBuilds entry names the package.",
    "- ctx.sessionTitle.register accepts one provider. A second registration throws.",
    "- As of this commit, nothing reads $DSH_HOME/.agent-presets. Presets are @deepseek-ai/dsh-agent-preset rows in a bundle patch.",
    "- Exhaustive config keys live in docs/config-catalog.md at the pinned commit, not in this routing page.",
  );
  const body = lines.join("\n");
  if (body.length > BODY_LIMIT) {
    throw new Error(`dsh-dev-index: skill body is ${body.length} characters; limit is ${BODY_LIMIT}`);
  }
  return body;
}
