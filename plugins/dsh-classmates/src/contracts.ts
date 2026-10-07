export interface ModelBinding {
  provider: string;
  id: string;
  reasoningEffort?: string;
}

/** Approval applies to the route across all profiles and reasoning efforts. */
export type ModelRoute = Pick<ModelBinding, 'provider' | 'id'>;

/** User-authored guidance for selecting a child model, independent of templates. */
export interface ModelProfile {
  id: string;
  revision: number;
  name: string;
  description: string;
  enabled: boolean;
  /** Missing effort means the selected model's default, never the parent's effort. */
  model: ModelBinding;
}

export type ModelProfileChange =
  | { op: 'upsert'; profile: ModelProfile }
  | { op: 'remove'; id: string; revision: number };

export interface ClassmateDefinition {
  schemaVersion: 1;
  id: string;
  revision: number;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  /**
   * Legacy write/read-tolerant shape. Storage and every read path carry the
   * normalized `RoleModelSelection` union; this legacy declaration remains
   * until the UI phase switches over (see NormalizedRole).
   */
  model: ModelBinding | null;
  /** Independent override. Omit to inherit the spawning chat's effort. */
  reasoningEffort?: string;
  /**
   * Legacy field, accepted on input and in old data only. On validation it
   * migrates into a strong `profile` model reference (or records
   * `migratedRecommendation` when a legacy fixed model wins) and is never
   * written back.
   */
  recommendedModelProfileId?: string;
}

/**
 * First-class three-state model setting stored on the role's `model` field.
 * `inherit` follows the dispatching chat (default), `profile` is a strong
 * reference to a model-use preset (dispatch fails when it is missing or
 * disabled; never a silent fallback), and `fixed` binds an exact route.
 */
export type RoleModelSelection =
  | { kind: 'inherit' }
  | { kind: 'profile'; profileId: string }
  | { kind: 'fixed'; provider: string; id: string; effort?: string };

/**
 * Role shape returned by every read path (RPC, Creator tools, dispatch):
 * `model` is always the normalized union and `recommendedModelProfileId` is
 * stripped. `migratedRecommendation` is derived at read time when legacy data
 * held both a fixed model and a recommendation; it is never persisted.
 */
export interface NormalizedRole extends Omit<ClassmateDefinition, 'model' | 'recommendedModelProfileId'> {
  model: RoleModelSelection;
  /** Original recommendedModelProfileId that a legacy fixed model won over. */
  migratedRecommendation?: string;
}

function legacyModelOf(model: ClassmateDefinition['model'] | RoleModelSelection): ModelBinding | undefined {
  if (model === null || typeof model !== 'object' || 'kind' in model) return undefined;
  return model;
}

/** Normalize any stored/legacy role model into the three-state union. */
export function normalizeRoleModel(role: ClassmateDefinition | NormalizedRole): RoleModelSelection {
  const model = role.model as ClassmateDefinition['model'] | RoleModelSelection;
  if (model !== null && typeof model === 'object' && 'kind' in model) return model;
  const legacy = legacyModelOf(model);
  if (legacy) {
    const effort = role.reasoningEffort ?? legacy.reasoningEffort;
    return {
      kind: 'fixed',
      provider: legacy.provider,
      id: legacy.id,
      ...effort === undefined ? {} : { effort },
    };
  }
  const recommended = (role as ClassmateDefinition).recommendedModelProfileId;
  if (typeof recommended === 'string' && recommended) return { kind: 'profile', profileId: recommended };
  return { kind: 'inherit' };
}

/** Normalize a whole role: new model shape, no recommended field, migration note attached. */
export function normalizeRole(role: ClassmateDefinition | NormalizedRole): NormalizedRole {
  const model = normalizeRoleModel(role);
  const legacy = legacyModelOf(role.model as ClassmateDefinition['model'] | RoleModelSelection);
  const recommended = (role as ClassmateDefinition).recommendedModelProfileId;
  const { recommendedModelProfileId: _recommended, ...rest } = role as ClassmateDefinition;
  const normalized: NormalizedRole = { ...rest, model };
  if (model.kind === 'fixed') delete normalized.reasoningEffort;
  if (legacy && typeof recommended === 'string' && recommended) normalized.migratedRecommendation = recommended;
  return normalized;
}

/** Concrete route of a `fixed` selection (or a legacy model); null for inherit/profile. */
export function fixedModelBinding(role: ClassmateDefinition | NormalizedRole): ModelBinding | null {
  const model = role.model as ClassmateDefinition['model'] | RoleModelSelection;
  if (model === null || typeof model !== 'object') return null;
  if ('kind' in model) {
    if (model.kind !== 'fixed') return null;
    return {
      provider: model.provider,
      id: model.id,
      ...model.effort === undefined ? {} : { reasoningEffort: model.effort },
    };
  }
  return {
    provider: model.provider,
    id: model.id,
    ...model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort },
  };
}

/** Where a created child's model came from. `override` is the model_profile dispatch argument. */
export type RoleModelSource = 'inherit' | 'profile' | 'fixed' | 'override';

/** Binding snapshot vs current template; revision drift alone never changes status. */
export type TemplateStatus = 'ok' | 'renamed' | 'disabled' | 'deleted';

export function templateStatusOf(
  snapshot: { id: string; name: string },
  roles: readonly { id: string; name: string; enabled: boolean }[],
): { templateStatus: TemplateStatus; currentRoleName?: string } {
  const current = roles.find(role => role.id === snapshot.id);
  if (!current) return { templateStatus: 'deleted' };
  if (!current.enabled) return { templateStatus: 'disabled' };
  if (current.name !== snapshot.name) return { templateStatus: 'renamed', currentRoleName: current.name };
  return { templateStatus: 'ok' };
}

export interface ModelChoice {
  provider: string;
  /** Public adapter label, not an endpoint or credential. */
  providerName?: string;
  /** Catalog discovery alone never proves that a model can accept requests. */
  availability?: 'unverified';
  id: string;
  name: string;
  description?: string;
  /** Adapter-disclosed combined context capacity; absent means unknown. */
  contextWindow?: number;
  efforts: { id: string; name: string; description?: string }[];
}

export interface ClassmatesState {
  /** UI phase: read paths always carry normalized roles. */
  roles: NormalizedRole[];
  /** Absent only in older host responses; current hosts return an array. */
  modelProfiles?: ModelProfile[];
  /** Routes requiring native approval before Classmates creates a child. */
  protectedModels?: ModelRoute[];
  settingsRevision: number;
  models: ModelChoice[];
  writable: boolean;
  catalogErrors?: string[];
}

/** One atomic edit to the reusable role library. Upserts carry the normalized role. */
export type RoleChange =
  | { op: 'upsert'; role: NormalizedRole }
  | { op: 'remove'; id: string; revision: number };

/** Read-only enrichment of official Team members; never a second roster. */
export interface TeamIdentity {
  memberId: string;
  memberName: string;
  roleId?: string;
  roleName?: string;
  description?: string;
  configuredModel: ModelBinding | null;
  lastUsedModel: ModelBinding | null;
  /** Original model_profile choice recorded in the binding, when any. */
  modelProfileId?: string;
  /** Current preset name; omitted when the preset no longer resolves. */
  modelProfileName?: string;
  templateStatus?: TemplateStatus;
  /** Present only when templateStatus is 'renamed'. */
  currentRoleName?: string;
  issue?: string;
}

export interface TeamDetails {
  leadId: string;
  members: TeamIdentity[];
}

/** Concrete route frozen at child creation; `effort` follows the new field name. */
export interface FrozenModelRoute {
  provider: string;
  id: string;
  effort?: string;
}

/** Role fields snapshotted into a subagent binding at creation time. */
export interface SubagentRoleSnapshot {
  id: string;
  revision: number;
  name: string;
  description: string;
}

/** Read-only view of one background role-dispatched subagent binding. */
export interface SubagentIdentity {
  childId: string;
  roleId: string;
  roleName: string;
  roleRevision: number;
  roleDescription: string;
  modelSource: RoleModelSource;
  modelProfileId?: string;
  /** Current preset name; omitted when the preset no longer resolves. */
  modelProfileName?: string;
  configuredModel?: FrozenModelRoute;
  templateStatus?: TemplateStatus;
  /** Present only when templateStatus is 'renamed'. */
  currentRoleName?: string;
  createdAt: string;
}

export interface SubagentBindings {
  subagents: SubagentIdentity[];
  /** Corrupt binding files skipped during enumeration. */
  warnings?: number;
}

export const CREATOR_PRESET_ID = 'cordis';

/** UI transport; host persistence remains native profile configuration. */
export interface ClassmatesClient {
  load(): Promise<ClassmatesState>;
  save(role: ClassmateDefinition, expectedSettingsRevision: number): Promise<ClassmatesState>;
  remove(id: string, expectedRoleRevision: number, expectedSettingsRevision: number): Promise<ClassmatesState>;
  saveModelProfile?(profile: ModelProfile, expectedSettingsRevision: number): Promise<ClassmatesState>;
  removeModelProfile?(id: string, revision: number, expectedSettingsRevision: number): Promise<ClassmatesState>;
  setModelProtection?(model: ModelRoute, required: boolean, expectedSettingsRevision: number): Promise<ClassmatesState>;
  team?(leadId: string): Promise<TeamDetails>;
  /** Open a fresh ordinary session with an editable team handoff draft. */
  startTask?(): void | Promise<void>;
  /**
   * Live availability of `startTask`'s implementation. When present, the UI
   * offers the action only while this reports true.
   */
  startTaskAvailability?: {
    getSnapshot(): boolean;
    subscribe(listener: () => void): () => void;
  };
}

export const SETTINGS_NS = 'classmates';
export const PROVIDER = 'classmates-spawn';
export const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
