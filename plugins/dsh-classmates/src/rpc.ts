import type { TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { validateRole, validateRoleChanges, validateRoles } from './config.js';
import { validateModelProfile, validateModelProfileChanges, validateModelProfiles } from './model-profiles.js';
import { validateModelRoute, validateProtectedModels } from './model-protection.js';
import type { ClassmatesState, ModelBinding, RoleModelSource, SubagentBindings, SubagentIdentity, TeamDetails, TeamIdentity, TemplateStatus } from './contracts.js';

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid revision');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid identifier');
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function modelBinding(value: unknown): ModelBinding | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Invalid model binding');
  const provider = text(value.provider);
  const id = text(value.id);
  if (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || !value.reasoningEffort)) {
    throw new Error('Invalid model binding');
  }
  if (Object.keys(value).some(key => key !== 'provider' && key !== 'id' && key !== 'reasoningEffort')) {
    throw new Error('Invalid model binding');
  }
  return {
    provider,
    id,
    ...value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort },
  };
}
function state(value: unknown): ClassmatesState {
  if (!value || typeof value !== 'object') throw new Error('Invalid Classmates response');
  const input = value as ClassmatesState;
  const roles = validateRoles(input.roles);
  integer(input.settingsRevision);
  if (typeof input.writable !== 'boolean' || !Array.isArray(input.models)) throw new Error('Invalid Classmates response');
  for (const model of input.models) {
    text(model.provider); text(model.id); text(model.name);
    if (model.description !== undefined && typeof model.description !== 'string') throw new Error('Invalid model capabilities');
    if (!Array.isArray(model.efforts)) throw new Error('Invalid model capabilities');
    for (const effort of model.efforts) {
      text(effort.id); text(effort.name);
      if (effort.description !== undefined && typeof effort.description !== 'string') throw new Error('Invalid model capabilities');
    }
  }
  if (input.catalogErrors !== undefined && (!Array.isArray(input.catalogErrors) || input.catalogErrors.some(item => typeof item !== 'string'))) throw new Error('Invalid catalog diagnostics');
  const modelProfiles = input.modelProfiles === undefined ? undefined : validateModelProfiles(input.modelProfiles);
  const protectedModels = input.protectedModels === undefined ? undefined : validateProtectedModels(input.protectedModels);
  return { ...input, roles, ...modelProfiles === undefined ? {} : { modelProfiles }, ...protectedModels === undefined ? {} : { protectedModels } };
}
function templateStatus(value: unknown): TemplateStatus {
  if (value !== 'ok' && value !== 'renamed' && value !== 'disabled' && value !== 'deleted') throw new Error('Invalid template status');
  return value;
}
function identity(value: unknown): TeamIdentity {
  if (!isRecord(value)) throw new Error('Invalid Team member');
  const allowed = new Set(['memberId', 'memberName', 'roleId', 'roleName', 'description', 'configuredModel', 'lastUsedModel', 'modelProfileId', 'modelProfileName', 'templateStatus', 'currentRoleName', 'issue']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Invalid Team member');
  const member: TeamIdentity = {
    memberId: text(value.memberId),
    memberName: text(value.memberName),
    configuredModel: modelBinding(value.configuredModel ?? null),
    lastUsedModel: modelBinding(value.lastUsedModel ?? null),
  };
  if (value.roleId !== undefined) member.roleId = text(value.roleId);
  if (value.roleName !== undefined) member.roleName = text(value.roleName);
  if (value.description !== undefined) {
    if (typeof value.description !== 'string' || !value.description) throw new Error('Invalid Team member');
    member.description = value.description;
  }
  if (value.modelProfileId !== undefined) member.modelProfileId = text(value.modelProfileId);
  if (value.modelProfileName !== undefined) member.modelProfileName = text(value.modelProfileName);
  if (value.templateStatus !== undefined) member.templateStatus = templateStatus(value.templateStatus);
  if (value.currentRoleName !== undefined) member.currentRoleName = text(value.currentRoleName);
  if (value.issue !== undefined) {
    if (typeof value.issue !== 'string' || !value.issue) throw new Error('Invalid Team member');
    member.issue = value.issue;
  }
  return member;
}
function frozenRoute(value: unknown): SubagentIdentity['configuredModel'] {
  if (!isRecord(value)) throw new Error('Invalid subagent model');
  const route = {
    provider: text(value.provider),
    id: text(value.id),
    ...value.effort === undefined ? {} : { effort: text(value.effort) },
  };
  if (Object.keys(value).some(key => key !== 'provider' && key !== 'id' && key !== 'effort')) throw new Error('Invalid subagent model');
  return route;
}
function subagentIdentity(value: unknown): SubagentIdentity {
  if (!isRecord(value)) throw new Error('Invalid subagent binding');
  const allowed = new Set(['childId', 'roleId', 'roleName', 'roleRevision', 'roleDescription', 'modelSource', 'modelProfileId', 'modelProfileName', 'configuredModel', 'templateStatus', 'currentRoleName', 'createdAt']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Invalid subagent binding');
  const source = value.modelSource;
  if (source !== 'inherit' && source !== 'profile' && source !== 'fixed' && source !== 'override') throw new Error('Invalid subagent model source');
  const row: SubagentIdentity = {
    childId: text(value.childId),
    roleId: text(value.roleId),
    roleName: text(value.roleName),
    roleRevision: integer(value.roleRevision),
    roleDescription: text(value.roleDescription),
    modelSource: source as RoleModelSource,
    createdAt: text(value.createdAt),
  };
  if (value.modelProfileId !== undefined) row.modelProfileId = text(value.modelProfileId);
  if (value.modelProfileName !== undefined) row.modelProfileName = text(value.modelProfileName);
  if (value.configuredModel !== undefined) row.configuredModel = frozenRoute(value.configuredModel);
  if (value.templateStatus !== undefined) row.templateStatus = templateStatus(value.templateStatus);
  if (value.currentRoleName !== undefined) row.currentRoleName = text(value.currentRoleName);
  return row;
}
function subagents(value: unknown): SubagentBindings {
  if (!isRecord(value) || !Array.isArray(value.subagents)) throw new Error('Invalid subagent bindings');
  if (Object.keys(value).some(key => key !== 'subagents' && key !== 'warnings')) throw new Error('Invalid subagent bindings');
  return {
    subagents: value.subagents.map(subagentIdentity),
    ...value.warnings === undefined ? {} : { warnings: integer(value.warnings) },
  };
}
function team(value: unknown): TeamDetails {
  if (!isRecord(value) || !Array.isArray(value.members)) throw new Error('Invalid Team details');
  if (Object.keys(value).some(key => key !== 'leadId' && key !== 'members')) throw new Error('Invalid Team details');
  return { leadId: text(value.leadId), members: value.members.map(identity) };
}
function codec(typeSymbol: string, parse: (value: unknown) => unknown): TypertCodec {
  return { mode: 'strict', typeSymbol: `Classmates.${typeSymbol}`, create: () => ({ parse }) };
}
const inputs: Record<string, TypertCodec> = {
  role: codec('Role', validateRole), profile: codec('Profile', validateModelProfile),
  id: codec('Id', text), revision: codec('Revision', integer), expected: codec('Revision', integer),
  changes: codec('Changes', validateRoleChanges),
  profileChanges: codec('ProfileChanges', validateModelProfileChanges),
  model: codec('ModelRoute', validateModelRoute),
  required: codec('Required', value => { if (typeof value !== 'boolean') throw new Error('Invalid protection switch'); return value; }),
  leadId: codec('Id', text),
  parentSessionId: codec('ParentSession', value => {
    if (value === undefined || value === null) return undefined;
    return text(value);
  }),
};

const methods: Record<string, string[]> = {
  load: [],
  save: ['role', 'expected'],
  deleteRole: ['id', 'revision', 'expected'],
  batch: ['changes', 'expected'],
  saveModelProfile: ['profile', 'expected'],
  deleteModelProfile: ['id', 'revision', 'expected'],
  batchModelProfiles: ['profileChanges', 'expected'],
  setModelProtection: ['model', 'required', 'expected'],
  team: ['leadId'],
  subagents: ['parentSessionId'],
};

/** Explicit JSON wire contract. Host methods validate every mutation. */
export const classmatesRemote: TypertRemoteContribution = {
  package: '@klarkxy/dsh-classmates',
  descriptors: Object.entries(methods).map(([method, names]) => ({
    id: `classmates/${method}`, service: 'classmatesController', namespace: 'classmates', method,
    invocation: { kind: 'direct' as const },
    parameters: names.map(name => ({
      name: name === 'profileChanges' ? 'changes' : name,
      wire: name === 'profileChanges' ? 'changes' : name,
      source: 'json' as const,
      codec: inputs[name],
    })),
    result: method === 'team' ? codec('Team', team) : method === 'subagents' ? codec('Subagents', subagents) : codec('State', state),
  })),
};
