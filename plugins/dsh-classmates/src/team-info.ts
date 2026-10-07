import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent, SessionId as SessionIdType } from '@deepseek-ai/dsh-session';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionObservation } from '@deepseek-ai/dsh-session-query';
import { SessionQueryError } from '@deepseek-ai/dsh-session-query';
import type { BindingStore } from './bindings.js';
import { ClassmatesError, type RoleConfig } from './config.js';
import type { ModelBinding, ModelProfile, NormalizedRole, TeamDetails, TeamIdentity } from './contracts.js';
import { templateStatusOf } from './contracts.js';

// The roster row deliberately carries no model: the host roster reports
// `live?.options.model ?? root.options.model` for offline members (see
// dsh-experimental-agent-team/lib/types/roster.js:117 and :413), which would
// display the Lead's model as a member's. Member models come only from the
// frozen binding (configuredModel) and sessionQuery last-used evidence.
interface RosterRow {
  id: string;
  name: string;
  role: 'lead' | 'teammate';
}

interface RosterRead {
  rows: RosterRow[];
  issue?: string;
}

interface ObservedModel {
  provider?: string;
  model?: string;
  id?: string;
  reasoningEffort?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function disposeLease(observation: SessionObservation): void {
  observation[Symbol.dispose]();
}

function toBinding(value: ObservedModel | undefined): ModelBinding | null {
  if (!value) return null;
  const id = value.id ?? value.model;
  if (typeof value.provider !== 'string' || !value.provider || typeof id !== 'string' || !id) return null;
  return {
    provider: value.provider,
    id,
    ...typeof value.reasoningEffort === 'string' && value.reasoningEffort
      ? { reasoningEffort: value.reasoningEffort }
      : {},
  };
}

/** Events owned by this session: at/after the fork-inherited prefix. */
function ownEvents(observation: SessionObservation): readonly SessionEvent[] {
  const inherited = observation.inheritedEventCount;
  return observation.events.filter(event => event.seq >= inherited);
}

function lastUsedFromEvents(events: readonly SessionEvent[]): ModelBinding | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== 'request/header') continue;
    const header = isRecord(event.data) && isRecord(event.data.header) ? event.data.header : undefined;
    const config = header && isRecord(header.config) ? header.config : undefined;
    const binding = toBinding(config as ObservedModel | undefined);
    if (binding) return binding;
  }
  return null;
}

function lastUsedFromObservation(observation: SessionObservation): ModelBinding | null {
  const own = ownEvents(observation);
  if (!own.some(event => event.type === 'request/header')) return null;
  const recorded = lastUsedFromEvents(own);
  if (recorded) return recorded;
  const values = observation.projections?.values as Record<string, unknown> | undefined;
  const selection = values?.modelSelection;
  if (isRecord(selection) && 'lastUsed' in selection) {
    return toBinding((selection.lastUsed ?? undefined) as ObservedModel | undefined);
  }
  return null;
}

function rowFromProjected(row: unknown): RosterRow | undefined {
  if (!isRecord(row) || typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name) {
    return undefined;
  }
  return { id: row.id, name: row.name, role: row.role === 'lead' ? 'lead' : 'teammate' };
}

function withLead(leadId: string, rows: RosterRow[]): RosterRow[] {
  if (rows.some(row => row.role === 'lead' || row.id === leadId)) return rows;
  return [{ id: leadId, name: 'lead', role: 'lead' }, ...rows];
}

function rosterFromEvents(observation: SessionObservation, leadId: string): RosterRow[] {
  const teammates = new Map<string, RosterRow>();
  for (const event of ownEvents(observation)) {
    if (event.type !== 'team/member' || !isRecord(event.data) || !isRecord(event.data.member)) continue;
    if (event.data.teamId !== leadId) continue;
    const member = event.data.member;
    if (typeof member.id !== 'string' || !member.id || typeof member.name !== 'string' || !member.name) continue;
    teammates.set(member.id, { id: member.id, name: member.name, role: 'teammate' });
  }
  return [{ id: leadId, name: 'lead', role: 'lead' }, ...teammates.values()];
}

function rosterFromObservation(observation: SessionObservation, leadId: string): RosterRead {
  const values = observation.projections?.values as Record<string, unknown> | undefined;
  if (isRecord(values) && 'agentTeam' in values) {
    const projected = values.agentTeam;
    const issue = isRecord(projected) && typeof projected.failure === 'string' && projected.failure
      ? projected.failure
      : undefined;
    const members = isRecord(projected) && Array.isArray(projected.members) ? projected.members : [];
    return { rows: withLead(leadId, members.flatMap(row => rowFromProjected(row) ?? [])), ...issue ? { issue } : {} };
  }
  return { rows: rosterFromEvents(observation, leadId) };
}

async function observe(ctx: Context, sessionId: SessionIdType): Promise<SessionObservation> {
  const query = ctx.get('sessionQuery');
  if (!query) throw new ClassmatesError('TEAM_UNAVAILABLE', '会话查询不可用，无法读取 Team');
  try {
    return await query.observeSession(sessionId, { projectionMode: 'all' });
  } catch (error) {
    if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
      throw new ClassmatesError('TEAM_NOT_FOUND', '找不到该会话的 Team 信息');
    }
    throw error;
  }
}

interface RoleLibrary {
  roles: readonly NormalizedRole[];
  profiles: readonly ModelProfile[];
}

/** Live template/profile data for status enrichment; absent when settings are unreadable. */
function readLibrary(config: RoleConfig | undefined): RoleLibrary | undefined {
  if (!config) return undefined;
  try {
    const state = config.read();
    return { roles: state.roles, profiles: state.modelProfiles ?? [] };
  } catch {
    return undefined;
  }
}

async function identityFor(
  ctx: Context,
  leadId: string,
  row: RosterRow,
  store: BindingStore | undefined,
  library: RoleLibrary | undefined,
): Promise<TeamIdentity> {
  const identity: TeamIdentity = {
    memberId: row.id,
    memberName: row.name,
    configuredModel: null,
    lastUsedModel: null,
  };
  if (store && row.role !== 'lead' && row.name !== 'lead') {
    try {
      const binding = await store.read(leadId, row.name);
      if (binding?.childId === row.id) {
        identity.roleId = binding.role.id;
        identity.roleName = binding.role.name;
        identity.description = binding.role.description;
        identity.configuredModel = binding.role.model;
        if (binding.modelProfileId !== undefined) {
          identity.modelProfileId = binding.modelProfileId;
          const profileName = library?.profiles.find(profile => profile.id === binding.modelProfileId)?.name;
          if (profileName) identity.modelProfileName = profileName;
        }
        if (library) {
          const status = templateStatusOf({ id: binding.role.id, name: binding.role.name }, library.roles);
          identity.templateStatus = status.templateStatus;
          if (status.currentRoleName !== undefined) identity.currentRoleName = status.currentRoleName;
        }
      }
    } catch (error) {
      identity.issue = error instanceof Error ? error.message : String(error);
    }
  }
  let member: SessionObservation | undefined;
  try {
    member = await observe(ctx, SessionId(row.id));
    identity.lastUsedModel = lastUsedFromObservation(member);
  } catch (error) {
    if (!identity.issue) identity.issue = error instanceof Error ? error.message : String(error);
  } finally {
    if (member) disposeLease(member);
  }
  return identity;
}

/** Profile-local Team display metadata from official roster/projections and frozen bindings. */
export async function readTeamDetails(
  ctx: Context,
  leadId: string,
  store?: BindingStore,
  config?: RoleConfig,
): Promise<TeamDetails> {
  if (typeof leadId !== 'string' || !leadId.trim()) throw new ClassmatesError('INVALID_LEAD', 'Team 主控标识无效');
  const id = SessionId(leadId);
  const library = readLibrary(config);
  const lead = await observe(ctx, id);
  try {
    const roster = rosterFromObservation(lead, leadId);
    const members = await Promise.all(roster.rows.map(row => identityFor(ctx, leadId, row, store, library)));
    if (roster.issue) {
      const leadRow = members.find(member => member.memberId === leadId) ?? members[0];
      if (leadRow && !leadRow.issue) leadRow.issue = roster.issue;
    }
    return { leadId, members };
  } finally {
    disposeLease(lead);
  }
}
