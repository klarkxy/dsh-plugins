import { describe, expect, it } from 'vitest';
import type { TeamDetails, TeamIdentity } from '../src/contracts.js';
import {
  createTeamMetadataLoader,
  currentRunningRefreshKey,
  lastUsedFingerprint,
  resolveModelProvenance,
  rosterRunningRefreshKey,
  shouldLoadTeamMetadata,
} from '../src/ui/team-metadata.js';

function identity(patch: Partial<TeamIdentity> = {}): TeamIdentity {
  return {
    memberId: 'child-1',
    memberName: 'alpha',
    configuredModel: { provider: 'mock', id: 'configured' },
    lastUsedModel: null,
    ...patch,
  };
}

function details(members: TeamIdentity[]): TeamDetails {
  return { leadId: 'lead-1', members };
}

describe('request projection fingerprints', () => {
  it('changes only with last-used identity, not pending next or token-like extras', () => {
    const first = lastUsedFingerprint({
      lastUsed: { provider: 'mock', model: 'specialist-a', reasoningEffort: 'high' },
      next: { provider: 'mock', model: 'other' },
    });
    const extra = lastUsedFingerprint({
      lastUsed: { provider: 'mock', model: 'specialist-a', reasoningEffort: 'high' },
      next: { provider: 'mock', model: 'stream-token' },
    });
    const later = lastUsedFingerprint({
      lastUsed: { provider: 'mock', model: 'specialist-b' },
      next: { provider: 'mock', model: 'other' },
    });
    expect(first).toBe(extra);
    expect(first).not.toBe(later);
    expect(lastUsedFingerprint({ lastUsed: null })).toBe('null');
    expect(lastUsedFingerprint(undefined)).toBe('');
  });
});

describe('model provenance', () => {
  it('does not let an official projection lastUsed override the backend own request', () => {
    const inheritedParent = { provider: 'mock', id: 'parent-header' };
    const ownRequest = resolveModelProvenance(identity({
      lastUsedModel: { provider: 'mock', id: 'child-own' },
    }));
    expect(ownRequest).toEqual({
      kind: 'lastUsed',
      binding: { provider: 'mock', id: 'child-own' },
    });
    expect(ownRequest).not.toEqual({ kind: 'lastUsed', binding: inheritedParent });

    const forkOnly = resolveModelProvenance(identity({
      lastUsedModel: null,
      configuredModel: { provider: 'mock', id: 'configured' },
    }));
    expect(forkOnly).toEqual({
      kind: 'configured',
      binding: { provider: 'mock', id: 'configured' },
    });
    expect(forkOnly).not.toEqual({ kind: 'lastUsed', binding: inheritedParent });
  });

  it('keeps configured distinct from an actual last request', () => {
    expect(resolveModelProvenance(identity())).toEqual({
      kind: 'configured',
      binding: { provider: 'mock', id: 'configured' },
    });
    expect(resolveModelProvenance(identity({
      lastUsedModel: { provider: 'mock', id: 'from-log' },
    }))).toEqual({
      kind: 'lastUsed',
      binding: { provider: 'mock', id: 'from-log' },
    });
    expect(resolveModelProvenance(identity({ configuredModel: null }))).toEqual({ kind: 'unknown' });
    expect(resolveModelProvenance(undefined)).toEqual({ kind: 'absent' });
  });
});

describe('running refresh signal', () => {
  it('retriggers when running ends even if lastUsed fingerprint stays inherited', () => {
    const inherited = lastUsedFingerprint({
      lastUsed: { provider: 'mock', model: 'parent-header' },
    });
    expect(inherited).toBe(lastUsedFingerprint({
      lastUsed: { provider: 'mock', model: 'parent-header' },
      next: { provider: 'mock', model: 'parent-header' },
    }));
    expect(currentRunningRefreshKey(true)).not.toBe(currentRunningRefreshKey(false));
    expect(currentRunningRefreshKey(undefined)).toBe(false);

    const ids = ['child-1', 'lead-1'];
    const running = new Map<string, boolean | undefined>([['child-1', true], ['lead-1', false]]);
    const during = rosterRunningRefreshKey(true, ids, id => running.get(id));
    running.set('child-1', false);
    const after = rosterRunningRefreshKey(true, ids, id => running.get(id));
    expect(during).not.toBe(after);
    expect(rosterRunningRefreshKey(false, ids, id => running.get(id))).toBe('');
    expect(rosterRunningRefreshKey(true, undefined, () => true)).toBe('');
  });
});

describe('metadata loader', () => {
  it('loads for header identity or an open panel, never as background polling', () => {
    expect(shouldLoadTeamMetadata(false, true)).toBe(true);
    expect(shouldLoadTeamMetadata(true, false)).toBe(true);
    expect(shouldLoadTeamMetadata(false, false)).toBe(false);
  });

  it('drops stale sessions, out-of-order replies, and applies after dispose', async () => {
    const applied: Array<{ failed: boolean; names?: string[] }> = [];
    const loader = createTeamMetadataLoader(result => {
      applied.push({
        failed: result.failed,
        names: result.details?.members.map(member => member.memberName),
      });
    });
    loader.resetSession('session-a');

    let finishSlow: (value: TeamDetails) => void = () => {};
    const slow = new Promise<TeamDetails>(resolve => {
      finishSlow = resolve;
    });
    loader.refresh('session-a', 'lead-1', () => slow);

    let finishFast: (value: TeamDetails) => void = () => {};
    const fast = new Promise<TeamDetails>(resolve => {
      finishFast = resolve;
    });
    loader.refresh('session-a', 'lead-1', () => fast);
    finishFast(details([identity({ memberName: 'fast' })]));
    await Promise.resolve();
    expect(applied).toEqual([{ failed: false, names: ['fast'] }]);

    finishSlow(details([identity({ memberName: 'slow' })]));
    await Promise.resolve();
    expect(applied).toEqual([{ failed: false, names: ['fast'] }]);

    loader.resetSession('session-b');
    let finishOld: (value: TeamDetails) => void = () => {};
    const oldSession = new Promise<TeamDetails>(resolve => {
      finishOld = resolve;
    });
    loader.resetSession('session-a');
    loader.refresh('session-a', 'lead-1', () => oldSession);
    loader.resetSession('session-b');
    finishOld(details([identity({ memberName: 'old-session' })]));
    await Promise.resolve();
    expect(applied).toHaveLength(1);

    loader.refresh('session-b', 'lead-1', async () => details([identity({ memberName: 'current' })]));
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([
      { failed: false, names: ['fast'] },
      { failed: false, names: ['current'] },
    ]);

    loader.dispose();
    loader.refresh('session-b', 'lead-1', async () => details([identity({ memberName: 'after-dispose' })]));
    await Promise.resolve();
    expect(applied).toHaveLength(2);
  });
});
