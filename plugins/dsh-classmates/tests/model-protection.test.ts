import { expect, it } from 'vitest';
import { isModelProtected, validateModelRoute, validateProtectedModels } from '../src/model-protection.js';

it('defaults only absent protection to empty and rejects malformed present data', () => {
  expect(validateProtectedModels(undefined)).toEqual([]);
  for (const value of [null, {}, 'off', [null], [{ provider: 'p', id: 'm', reasoningEffort: 'low' }]]) {
    expect(() => validateProtectedModels(value)).toThrow();
  }
  expect(() => validateModelRoute({ provider: '', id: 'm' })).toThrow();
});

it('keys locks by the exact route pair and ignores profile or reasoning choice', () => {
  const first = { provider: 'p/a', id: 'b' };
  const second = { provider: 'p', id: 'a/b' };
  const routes = validateProtectedModels([first, first, second]);
  expect(routes).toEqual([first, second]);
  expect(isModelProtected([first], second)).toBe(false);
  expect(isModelProtected(routes, { ...first, reasoningEffort: 'high' } as typeof first)).toBe(true);
});
