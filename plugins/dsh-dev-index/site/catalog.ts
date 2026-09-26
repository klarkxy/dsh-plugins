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

/** A task page or the architecture-rules guide. `runnableExample` is `not-yet` until a later round ships a pack. */
export interface DocEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly file: string;
  readonly fileZh: string;
  readonly areas: readonly string[];
  readonly sources: readonly string[];
  readonly runnableExample: "not-yet";
}

export interface Catalog {
  readonly indexed: IndexedCommit;
  readonly pagesBaseUrl: string;
  /** Human-readable official docs. Not one of the three revision fields a daily job compares. */
  readonly officialDocsSite: string;
  readonly skill: SkillCopy;
  readonly areas: readonly Area[];
  readonly tasks: readonly DocEntry[];
  readonly guides: readonly DocEntry[];
}

export interface IndexMeta {
  readonly officialRepository: string;
  readonly officialTag: string;
  readonly officialCommit: string;
  readonly officialDocsSite: string;
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
    officialDocsSite: catalog.officialDocsSite,
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
  const tasks = value.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("dsh-dev-index: catalog.tasks must be a non-empty array");
  }
  const guides = value.guides;
  if (!Array.isArray(guides) || guides.length === 0) {
    throw new Error("dsh-dev-index: catalog.guides must be a non-empty array");
  }
  const commit = requiredString(indexed, "indexed.commit");
  if (!COMMIT.test(commit)) throw new Error("dsh-dev-index: indexed.commit must be a 40-character hex sha");
  const parsedAreas = areas.map((area, index) => parseArea(area, index));
  const areaIds = new Set(parsedAreas.map((area) => area.id));
  const catalog: Catalog = {
    indexed: {
      repository: requiredString(indexed, "indexed.repository"),
      commit,
      tag: requiredString(indexed, "indexed.tag"),
      committedAt: requiredString(indexed, "indexed.committedAt"),
      subject: requiredString(indexed, "indexed.subject"),
    },
    pagesBaseUrl: normalizePagesBaseUrl(requiredString(value, "pagesBaseUrl")),
    officialDocsSite: normalizePagesBaseUrl(requiredString(value, "officialDocsSite")),
    skill: {
      name: requiredString(skill, "skill.name"),
      description: requiredString(skill, "skill.description"),
      whenToUse: requiredString(skill, "skill.whenToUse"),
    },
    areas: parsedAreas,
    tasks: tasks.map((task, index) => parseDocEntry(task, index, "tasks", areaIds)),
    guides: guides.map((guide, index) => parseDocEntry(guide, index, "guides", areaIds)),
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
  const entryIds = new Set<string>();
  for (const entry of [...catalog.tasks, ...catalog.guides]) {
    if (entryIds.has(entry.id)) throw new Error(`dsh-dev-index: duplicate task or guide id "${entry.id}"`);
    entryIds.add(entry.id);
  }
  return catalog;
}

function parseDocEntry(value: unknown, index: number, bucket: "tasks" | "guides", areaIds: ReadonlySet<string>): DocEntry {
  if (!isRecord(value)) throw new Error(`dsh-dev-index: ${bucket}[${index}] must be an object`);
  const id = requiredString(value, `${bucket}[${index}].id`);
  if (!AREA_ID.test(id)) throw new Error(`dsh-dev-index: ${bucket} id "${id}" must be kebab-case`);
  const file = requiredString(value, `${bucket}[${index}].file`);
  if (file !== `tasks/${id}.md`) throw new Error(`dsh-dev-index: ${bucket} "${id}" file must be tasks/${id}.md`);
  const fileZh = requiredString(value, `${bucket}[${index}].fileZh`);
  if (fileZh !== `zh/tasks/${id}.md`) throw new Error(`dsh-dev-index: ${bucket} "${id}" fileZh must be zh/tasks/${id}.md`);
  const sources = stringList(value.sources, `${bucket} "${id}" sources`);
  const areas = stringList(value.areas, `${bucket} "${id}" areas`);
  for (const areaId of areas) {
    if (!areaIds.has(areaId)) throw new Error(`dsh-dev-index: ${bucket} "${id}" links unknown area "${areaId}"`);
  }
  const runnableExample = requiredString(value, `${bucket}[${index}].runnableExample`);
  if (runnableExample !== "not-yet") {
    throw new Error(`dsh-dev-index: ${bucket} "${id}" runnableExample must be "not-yet" until a pack ships`);
  }
  return {
    id,
    title: requiredString(value, `${bucket}[${index}].title`),
    summary: requiredString(value, `${bucket}[${index}].summary`),
    file,
    fileZh,
    areas,
    sources,
    runnableExample,
  };
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`dsh-dev-index: ${label} must be a non-empty string list`);
  }
  return value;
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
