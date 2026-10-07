import { describe, expect, it } from 'vitest';
import type { NormalizedRole } from '../src/contracts.js';
import {
  collectProfileReferences,
  formatRouteValue,
  modelSourceFromModel,
  parseRouteValue,
  profileReferenceStatus,
  selectionFromModelSource,
  toSavePayload,
} from '../src/ui/role-model.js';

function role(partial: Partial<NormalizedRole> & Pick<NormalizedRole, 'id'>): NormalizedRole {
  return {
    schemaVersion: 1,
    revision: 1,
    name: partial.id,
    description: 'duty',
    instructions: 'Do the work.',
    enabled: true,
    model: { kind: 'inherit' },
    ...partial,
  };
}

describe('model source control mapping', () => {
  it('serializes each kind into the save selection', () => {
    expect(selectionFromModelSource({ kind: 'inherit', profileId: 'p-1', route: formatRouteValue({ provider: 'mock', id: 'one' }), effort: 'low' }))
      .toEqual({ kind: 'inherit' });
    expect(selectionFromModelSource({ kind: 'profile', profileId: 'coding-high', route: formatRouteValue({ provider: 'mock', id: 'one' }), effort: 'low' }))
      .toEqual({ kind: 'profile', profileId: 'coding-high' });
    expect(selectionFromModelSource({ kind: 'fixed', profileId: 'p-1', route: formatRouteValue({ provider: 'mock', id: 'one' }), effort: '' }))
      .toEqual({ kind: 'fixed', provider: 'mock', id: 'one' });
    expect(selectionFromModelSource({ kind: 'fixed', profileId: '', route: formatRouteValue({ provider: 'mock', id: 'one' }), effort: 'low' }))
      .toEqual({ kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' });
  });

  it("drops the previous kind's subfields from the payload when switching kinds", () => {
    // Subfields of the inactive kinds stay in local memory…
    const memory = {
      profileId: 'coding-high',
      route: formatRouteValue({ provider: 'mock', id: 'one' }),
      effort: 'low',
    };
    // …but only the active kind's confirmed subfields serialize.
    expect(selectionFromModelSource({ ...memory, kind: 'profile' })).toEqual({ kind: 'profile', profileId: 'coding-high' });
    expect(selectionFromModelSource({ ...memory, kind: 'inherit' })).toEqual({ kind: 'inherit' });
    expect(selectionFromModelSource({ ...memory, kind: 'fixed' })).toEqual({
      kind: 'fixed', provider: 'mock', id: 'one', effort: 'low',
    });
  });

  it('submits nothing while the active kind is incomplete', () => {
    expect(selectionFromModelSource({ kind: 'profile', profileId: '', route: '', effort: '' })).toBeNull();
    expect(selectionFromModelSource({ kind: 'fixed', profileId: '', route: '', effort: '' })).toBeNull();
    expect(selectionFromModelSource({ kind: 'fixed', profileId: '', route: 'not-json', effort: '' })).toBeNull();
    expect(selectionFromModelSource({ kind: 'fixed', profileId: '', route: '{"provider":"","id":""}', effort: '' })).toBeNull();
  });

  it('round-trips between a saved selection and the control state', () => {
    expect(modelSourceFromModel({ kind: 'inherit' })).toEqual({ kind: 'inherit', profileId: '', route: '', effort: '' });
    expect(modelSourceFromModel({ kind: 'profile', profileId: 'p-1' }))
      .toEqual({ kind: 'profile', profileId: 'p-1', route: '', effort: '' });
    const fixed = modelSourceFromModel({ kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' });
    expect(fixed.kind).toBe('fixed');
    expect(parseRouteValue(fixed.route)).toEqual({ provider: 'mock', id: 'one' });
    expect(fixed.effort).toBe('low');
    expect(selectionFromModelSource(fixed)).toEqual({ kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' });
    const noEffort = modelSourceFromModel({ kind: 'fixed', provider: 'mock', id: 'one' });
    expect(noEffort.effort).toBe('');
    expect(selectionFromModelSource(noEffort)).toEqual({ kind: 'fixed', provider: 'mock', id: 'one' });
  });
});

describe('profile reference warnings', () => {
  const profiles = [
    { id: 'on', enabled: true },
    { id: 'off', enabled: false },
  ];
  it('classifies ok, disabled and missing strong references', () => {
    expect(profileReferenceStatus('on', profiles)).toBe('ok');
    expect(profileReferenceStatus('off', profiles)).toBe('disabled');
    expect(profileReferenceStatus('gone', profiles)).toBe('missing');
  });
});

describe('collectProfileReferences', () => {
  it('lists the roles holding a strong reference to each preset, in library order', () => {
    const roles = [
      role({ id: 'a', name: '角色 A', model: { kind: 'profile', profileId: 'p-1' } }),
      role({ id: 'b', name: '角色 B', model: { kind: 'fixed', provider: 'mock', id: 'one' } }),
      role({ id: 'c', name: ' ', model: { kind: 'profile', profileId: 'p-1' } }),
      role({ id: 'd', name: '角色 D', model: { kind: 'profile', profileId: 'p-2' } }),
      role({ id: 'e', name: '角色 E' }),
    ];
    const map = collectProfileReferences(roles);
    // A blank display name falls back to the role id.
    expect(map.get('p-1')).toEqual(['角色 A', 'c']);
    expect(map.get('p-2')).toEqual(['角色 D']);
    expect(map.has('p-3')).toBe(false);
    expect(collectProfileReferences([]).size).toBe(0);
  });
});

describe('toSavePayload', () => {
  it('keeps the normalized model union and strips the read-time migration note', () => {
    const fixed = toSavePayload(role({
      id: 'a',
      model: { kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' },
      migratedRecommendation: 'old-preset',
    }));
    expect(fixed.model).toEqual({ kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' });
    expect(fixed).not.toHaveProperty('migratedRecommendation');
    expect(toSavePayload(role({ id: 'b', model: { kind: 'profile', profileId: 'p-1' } })).model)
      .toEqual({ kind: 'profile', profileId: 'p-1' });
    expect(toSavePayload(role({ id: 'c', model: { kind: 'inherit' } })).model)
      .toEqual({ kind: 'inherit' });
  });
});
