import { expect, it } from 'vitest';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';

it('uses the official shadow lifecycle to show one Team action and restore native on uninstall', () => {
  const slots = new SlotCore();
  // A synthetic host declaration exercises the installed official runtime;
  // the production host owns the actual conversation header slot.
  const register = slots.register.bind(slots) as (options: object, component: () => null) => () => void;
  const host = register({ name: 'root', children: { 'audit.header': { kind: 'list', scope: 'root' } } }, () => null);
  const native = register({ name: 'audit.header', id: 'agent-team', order: -20 }, () => null);
  const original = slots.entriesOfSlot('audit.header')[0];
  const enhanced = register({ name: 'audit.header', id: 'agent-team', order: -20, priority: -10 }, () => null);
  expect(slots.entries('audit.header')).toHaveLength(2);
  expect(slots.entriesOfSlot('audit.header')).toHaveLength(1);
  expect(slots.entriesOfSlot('audit.header')[0]).not.toBe(original);
  enhanced();
  expect(slots.entriesOfSlot('audit.header')).toEqual([original]);
  native();
  host();
  expect(slots.entriesOfSlot('audit.header')).toEqual([]);
});
