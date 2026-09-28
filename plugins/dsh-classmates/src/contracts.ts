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
  model: ModelBinding | null;
  /** Independent override. Omit to inherit the spawning chat's effort. */
  reasoningEffort?: string;
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
  efforts: { id: string; name: string; description?: string }[];
}

export interface ClassmatesState {
  roles: ClassmateDefinition[];
  /** Absent only in older host responses; current hosts return an array. */
  modelProfiles?: ModelProfile[];
  /** Routes requiring native approval before Classmates creates a child. */
  protectedModels?: ModelRoute[];
  settingsRevision: number;
  models: ModelChoice[];
  writable: boolean;
  catalogErrors?: string[];
}

/** One atomic edit to the reusable role library. */
export type RoleChange =
  | { op: 'upsert'; role: ClassmateDefinition }
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
  issue?: string;
}

export interface TeamDetails {
  leadId: string;
  members: TeamIdentity[];
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
}

export const SETTINGS_NS = 'classmates';
export const PROVIDER = 'classmates-spawn';
export const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
