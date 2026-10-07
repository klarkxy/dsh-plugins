import type { ClassmateDefinition, ModelProfile, NormalizedRole, RoleModelSelection } from '../contracts.js';

/**
 * Local state of the role editor's three-state model-source control. Subfields
 * of the inactive kinds stay in memory while the user switches kinds, but only
 * the active kind's confirmed subfields ever enter a save payload.
 */
export interface ModelSourceState {
  kind: 'inherit' | 'profile' | 'fixed';
  /** Chosen preset id ('' = none chosen yet). */
  profileId: string;
  /** `formatRouteValue` of the chosen fixed route ('' = none chosen yet). */
  route: string;
  /** Fixed reasoning effort ('' = the model's own default). */
  effort: string;
}

/** Select value of one catalog route, mirroring the ModelsPage protection select. */
export function formatRouteValue(route: { provider: string; id: string }): string {
  return JSON.stringify({ provider: route.provider, id: route.id });
}

export function parseRouteValue(value: string): { provider: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { provider, id } = parsed as Record<string, unknown>;
    if (typeof provider !== 'string' || !provider || typeof id !== 'string' || !id) return null;
    return { provider, id };
  } catch {
    return null;
  }
}

/** Control state for a saved selection; the other kinds' subfields start empty. */
export function modelSourceFromModel(model: RoleModelSelection): ModelSourceState {
  if (model.kind === 'profile') return { kind: 'profile', profileId: model.profileId, route: '', effort: '' };
  if (model.kind === 'fixed') {
    return {
      kind: 'fixed',
      profileId: '',
      route: formatRouteValue(model),
      effort: model.effort ?? '',
    };
  }
  return { kind: 'inherit', profileId: '', route: '', effort: '' };
}

/**
 * Save payload of the control: the active kind serializes with only its own
 * confirmed subfields — switching kinds never leaks the previous kind's
 * fields. Null while the active kind is incomplete (no preset or no route
 * chosen), in which case the control submits nothing yet.
 */
export function selectionFromModelSource(state: ModelSourceState): RoleModelSelection | null {
  if (state.kind === 'inherit') return { kind: 'inherit' };
  if (state.kind === 'profile') {
    return state.profileId ? { kind: 'profile', profileId: state.profileId } : null;
  }
  const route = parseRouteValue(state.route);
  if (!route) return null;
  return {
    kind: 'fixed',
    provider: route.provider,
    id: route.id,
    ...state.effort === '' ? {} : { effort: state.effort },
  };
}

/** Whether a role's strong preset reference currently resolves for dispatch. */
export type ProfileReferenceStatus = 'ok' | 'disabled' | 'missing';

export function profileReferenceStatus(
  profileId: string,
  profiles: readonly Pick<ModelProfile, 'id' | 'enabled'>[],
): ProfileReferenceStatus {
  const profile = profiles.find(item => item.id === profileId);
  if (!profile) return 'missing';
  return profile.enabled ? 'ok' : 'disabled';
}

/**
 * Preset id → display names of the roles whose model is a strong reference to
 * it, in role-library order. Roles on inherit/fixed never appear, and a preset
 * no role references is simply absent from the map.
 */
export function collectProfileReferences(
  roles: readonly Pick<NormalizedRole, 'id' | 'name' | 'model'>[],
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const role of roles) {
    if (role.model.kind !== 'profile') continue;
    const name = role.name.trim() || role.id;
    const list = map.get(role.model.profileId);
    if (list) list.push(name);
    else map.set(role.model.profileId, [name]);
  }
  return map;
}

/**
 * Wire payload for `ClassmatesClient.save`. The RPC validator accepts the
 * normalized model union (see validateRoleModel in config.ts) and the host
 * persists it; the client signature keeps the legacy `ClassmateDefinition`
 * name until the client entry is allowed to follow, so this is the single
 * documented conversion point. `migratedRecommendation` is read-time only and
 * never goes back on the wire.
 */
export function toSavePayload(role: NormalizedRole): ClassmateDefinition {
  const { migratedRecommendation: _notice, ...payload } = role;
  return payload as unknown as ClassmateDefinition;
}
