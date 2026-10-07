import { describe, expect, it } from 'vitest';
import {
  fixedModelBinding,
  normalizeRole,
  normalizeRoleModel,
  templateStatusOf,
  type ClassmateDefinition,
} from '../src/contracts.js';
import { role } from './helpers/harness.js';

function base(partial: Partial<ClassmateDefinition> & Pick<ClassmateDefinition, 'id'>): ClassmateDefinition {
  return role({
    revision: 2,
    name: partial.id,
    description: 'duty',
    instructions: 'Do the work.',
    model: null,
    ...partial,
  });
}

describe('normalizeRoleModel', () => {
  it('returns a new-shape model unchanged', () => {
    expect(normalizeRoleModel(base({ id: 'a', model: { kind: 'inherit' } as never }))).toEqual({ kind: 'inherit' });
    expect(normalizeRoleModel(base({ id: 'b', model: { kind: 'profile', profileId: 'coding-high' } as never }))).toEqual({
      kind: 'profile', profileId: 'coding-high',
    });
    expect(normalizeRoleModel(base({ id: 'c', model: { kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' } as never }))).toEqual({
      kind: 'fixed', provider: 'mock', id: 'one', effort: 'low',
    });
  });

  it('converts a legacy model to fixed, folding the top-level effort override', () => {
    expect(normalizeRoleModel(base({ id: 'a', model: { provider: 'mock', id: 'one' } }))).toEqual({
      kind: 'fixed', provider: 'mock', id: 'one',
    });
    expect(normalizeRoleModel(base({ id: 'b', model: { provider: 'mock', id: 'one', reasoningEffort: 'low' } }))).toEqual({
      kind: 'fixed', provider: 'mock', id: 'one', effort: 'low',
    });
    expect(normalizeRoleModel(base({
      id: 'c',
      model: { provider: 'mock', id: 'one', reasoningEffort: 'low' },
      reasoningEffort: 'low',
    }))).toEqual({ kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' });
  });

  it('migrates a recommendation-only role into a strong profile reference', () => {
    expect(normalizeRoleModel(base({ id: 'a', recommendedModelProfileId: 'coding-high' }))).toEqual({
      kind: 'profile', profileId: 'coding-high',
    });
  });

  it('prefers a legacy fixed model over a recommendation and notes the migration on the role', () => {
    const normalized = normalizeRole(base({
      id: 'a',
      model: { provider: 'mock', id: 'one', reasoningEffort: 'low' },
      recommendedModelProfileId: 'coding-high',
    }));
    expect(normalized.model).toEqual({ kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' });
    expect(normalized.migratedRecommendation).toBe('coding-high');
    expect(normalized).not.toHaveProperty('recommendedModelProfileId');
    expect(normalized).not.toHaveProperty('reasoningEffort');
  });

  it('falls back to inherit when nothing is configured', () => {
    expect(normalizeRoleModel(base({ id: 'a' }))).toEqual({ kind: 'inherit' });
  });

  it('keeps the effort override only on inherit and never invents a migration note', () => {
    const inherited = normalizeRole(base({ id: 'a', reasoningEffort: 'low' }));
    expect(inherited.model).toEqual({ kind: 'inherit' });
    expect(inherited.reasoningEffort).toBe('low');
    expect(inherited).not.toHaveProperty('migratedRecommendation');
    const strong = normalizeRole(base({ id: 'b', recommendedModelProfileId: 'coding-high' }));
    expect(strong).not.toHaveProperty('migratedRecommendation');
    expect(strong).not.toHaveProperty('recommendedModelProfileId');
  });
});

describe('fixedModelBinding', () => {
  it('extracts the concrete route from fixed and legacy shapes only', () => {
    expect(fixedModelBinding(base({ id: 'a', model: { kind: 'fixed', provider: 'mock', id: 'one', effort: 'low' } as never }))).toEqual({
      provider: 'mock', id: 'one', reasoningEffort: 'low',
    });
    expect(fixedModelBinding(base({ id: 'b', model: { provider: 'mock', id: 'one' } }))).toEqual({ provider: 'mock', id: 'one' });
    expect(fixedModelBinding(base({ id: 'c', model: { kind: 'profile', profileId: 'x' } as never }))).toBeNull();
    expect(fixedModelBinding(base({ id: 'd' }))).toBeNull();
  });
});

describe('templateStatusOf', () => {
  const roles = [
    { id: 'same', name: 'Same', enabled: true },
    { id: 'renamed', name: 'New Name', enabled: true },
    { id: 'parked', name: 'Parked', enabled: false },
  ];
  it('classifies ok, renamed, disabled, and deleted without reading revisions', () => {
    expect(templateStatusOf({ id: 'same', name: 'Same' }, roles)).toEqual({ templateStatus: 'ok' });
    expect(templateStatusOf({ id: 'renamed', name: 'Old Name' }, roles)).toEqual({
      templateStatus: 'renamed', currentRoleName: 'New Name',
    });
    expect(templateStatusOf({ id: 'parked', name: 'Parked' }, roles)).toEqual({ templateStatus: 'disabled' });
    expect(templateStatusOf({ id: 'gone', name: 'Gone' }, roles)).toEqual({ templateStatus: 'deleted' });
    // Disabled wins over a rename; a deleted id reports no current name.
    expect(templateStatusOf({ id: 'parked', name: 'Other' }, roles)).toEqual({ templateStatus: 'disabled' });
  });
});
