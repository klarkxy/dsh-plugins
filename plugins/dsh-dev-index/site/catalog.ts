import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COMMIT = /^[0-9a-f]{40}$/;
const AREA_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface IndexedCommit {
  readonly repository: string;
  readonly commit: string;
  readonly tag: string;
  readonly committedAt: string;
  readonly subject: string;
}

export interface SkillCopy {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
}

export interface Area {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly file: string;
  readonly fileZh: string;
  readonly sources: readonly string[];
}

export interface Catalog {
  readonly indexed: IndexedCommit;
  readonly pagesBaseUrl: string;
  readonly skill: SkillCopy;
  readonly areas: readonly Area[];
}

export interface IndexMeta {
  readonly officialRepository: string;
  readonly officialTag: string;
  readonly officialCommit: string;
}

export const docsDirUrl = new URL("../../../docs/", import.meta.url);
export const docsDir = fileURLToPath(docsDirUrl);

export function loadCatalog(dir: URL = docsDirUrl): Catalog {
  const raw = readFileSync(new URL("index.json", dir), "utf8");
  return parseCatalog(raw);
}

export function metaFromCatalog(catalog: Catalog): IndexMeta {
  return {
    officialRepository: catalog.indexed.repository,
    officialTag: catalog.indexed.tag,
    officialCommit: catalog.indexed.commit,
  };
}

export function parseCatalog(raw: string): Catalog {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error("dsh-dev-index: catalog must be an object");
  const indexed = record(value, "indexed");
  const skill = record(value, "skill");
  const areas = value.areas;
  if (!Array.isArray(areas) || areas.length === 0) {
    throw new Error("dsh-dev-index: catalog.areas must be a non-empty array");
  }
  const commit = requiredString(indexed, "indexed.commit");
  if (!COMMIT.test(commit)) throw new Error("dsh-dev-index: indexed.commit must be a 40-character hex sha");
  const catalog: Catalog = {
    indexed: {
      repository: requiredString(indexed, "indexed.repository"),
      commit,
      tag: requiredString(indexed, "indexed.tag"),
      committedAt: requiredString(indexed, "indexed.committedAt"),
      subject: requiredString(indexed, "indexed.subject"),
    },
    pagesBaseUrl: normalizePagesBaseUrl(requiredString(value, "pagesBaseUrl")),
    skill: {
      name: requiredString(skill, "skill.name"),
      description: requiredString(skill, "skill.description"),
      whenToUse: requiredString(skill, "skill.whenToUse"),
    },
    areas: areas.map((area, index) => parseArea(area, index)),
  };
  if (!AREA_ID.test(catalog.skill.name)) {
    throw new Error("dsh-dev-index: skill.name must be kebab-case");
  }
  if (catalog.skill.description.length === 0 || catalog.skill.description.length > 500) {
    throw new Error("dsh-dev-index: skill.description must be 1 to 500 characters");
  }
  const ids = new Set<string>();
  for (const area of catalog.areas) {
    if (ids.has(area.id)) throw new Error(`dsh-dev-index: duplicate area id "${area.id}"`);
    ids.add(area.id);
  }
  return catalog;
}

function parseArea(value: unknown, index: number): Area {
  if (!isRecord(value)) throw new Error(`dsh-dev-index: areas[${index}] must be an object`);
  const id = requiredString(value, `areas[${index}].id`);
  if (!AREA_ID.test(id)) throw new Error(`dsh-dev-index: area id "${id}" must be kebab-case`);
  const sources = value.sources;
  if (!Array.isArray(sources) || sources.length === 0 || sources.some((source) => typeof source !== "string" || source.length === 0)) {
    throw new Error(`dsh-dev-index: area "${id}" needs a non-empty sources list`);
  }
  const file = requiredString(value, `areas[${index}].file`);
  if (file !== `areas/${id}.md`) throw new Error(`dsh-dev-index: area "${id}" file must be areas/${id}.md`);
  const fileZh = requiredString(value, `areas[${index}].fileZh`);
  if (fileZh !== `zh/areas/${id}.md`) throw new Error(`dsh-dev-index: area "${id}" fileZh must be zh/areas/${id}.md`);
  return {
    id,
    title: requiredString(value, `areas[${index}].title`),
    summary: requiredString(value, `areas[${index}].summary`),
    file,
    fileZh,
    sources,
  };
}

export function normalizePagesBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("dsh-dev-index: pagesBaseUrl must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("dsh-dev-index: pagesBaseUrl must be an absolute http(s) URL");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function record(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key];
  if (!isRecord(child)) throw new Error(`dsh-dev-index: catalog.${key} must be an object`);
  return child;
}

function requiredString(value: Record<string, unknown>, label: string): string {
  const key = label.slice(label.lastIndexOf(".") + 1);
  const child = value[key];
  if (typeof child !== "string" || child.length === 0) {
    throw new Error(`dsh-dev-index: ${label} must be a non-empty string`);
  }
  return child;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
