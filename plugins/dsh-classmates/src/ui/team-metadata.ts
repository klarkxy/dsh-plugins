import type { ModelBinding, TeamDetails, TeamIdentity } from '../contracts.js';

export interface ProjectedSelection {
  lastUsed?: { provider?: string; model?: string; id?: string; reasoningEffort?: string } | null;
  next?: { provider?: string; model?: string; id?: string; reasoningEffort?: string } | null;
}

/** Refresh trigger only — never a display value. Official lastUsed can inherit a fork header. */
export function lastUsedFingerprint(selection: ProjectedSelection | null | undefined): string {
  if (!selection) return '';
  const lastUsed = selection.lastUsed;
  if (!lastUsed) return lastUsed === null ? 'null' : '';
  const id = lastUsed.model ?? lastUsed.id ?? '';
  if (!lastUsed.provider || !id) return 'null';
  return `${lastUsed.provider}\0${id}\0${lastUsed.reasoningEffort ?? ''}`;
}

export type ModelProvenance =
  | { kind: 'lastUsed'; binding: ModelBinding }
  | { kind: 'configured'; binding: ModelBinding }
  | { kind: 'unknown' }
  | { kind: 'absent' };

/**
 * Display uses the backend identity only. Official projection lastUsed is not
 * a display source: it can still carry a fork-inherited parent request.
 */
export function resolveModelProvenance(identity: TeamIdentity | undefined): ModelProvenance {
  if (identity?.lastUsedModel) return { kind: 'lastUsed', binding: identity.lastUsedModel };
  if (identity?.configuredModel) return { kind: 'configured', binding: identity.configuredModel };
  if (identity !== undefined) return { kind: 'unknown' };
  return { kind: 'absent' };
}

/** Current session running flag as a refresh dependency. */
export function currentRunningRefreshKey(running: boolean | undefined): boolean {
  return running === true;
}

/**
 * Roster running snapshot while the panel is open. Closed panels stay empty so
 * other members do not refresh in the background. A true→false flip retriggers
 * fetch when the official lastUsed fingerprint is unchanged (same inherited route).
 */
export function rosterRunningRefreshKey(
  open: boolean,
  memberIds: readonly string[] | undefined,
  runningOf: (id: string) => boolean | undefined,
): string {
  if (!open || memberIds === undefined) return '';
  return memberIds.map(id => `${id}:${runningOf(id) === true ? '1' : '0'}`).join('\n');
}

export function shouldLoadTeamMetadata(open: boolean, isMember: boolean): boolean {
  return open || isMember;
}

export function createTeamMetadataLoader(apply: (result: {
  details: TeamDetails | null;
  failed: boolean;
}) => void) {
  let generation = 0;
  let sequence = 0;
  let disposed = false;
  let sessionId = '';

  return {
    resetSession(nextSessionId: string) {
      generation += 1;
      sequence = 0;
      sessionId = nextSessionId;
    },
    refresh(
      currentSessionId: string,
      leadId: string,
      fetchTeam: (leadId: string) => Promise<TeamDetails>,
    ) {
      if (disposed || sessionId !== currentSessionId) return;
      const gen = generation;
      const seq = ++sequence;
      fetchTeam(leadId).then(
        value => {
          if (disposed || generation !== gen || sequence !== seq || sessionId !== currentSessionId) return;
          apply({ details: value, failed: false });
        },
        () => {
          if (disposed || generation !== gen || sequence !== seq || sessionId !== currentSessionId) return;
          apply({ details: null, failed: true });
        },
      );
    },
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}

export type TeamMetadataLoader = ReturnType<typeof createTeamMetadataLoader>;
