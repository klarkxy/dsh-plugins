import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it, vi } from 'vitest'
import { installTemporaryWorkspacePicker } from './temporary-picker.tsx'
import { TEMP_WORKSPACE_FLOW_SLOT } from './contracts.ts'

const HERO = 'conversation.hero.workspace', FLOW = 'conversation.hero.workspace.directoryFlow'
const NativePicker = () => null, NativeFlow = () => null, BrowseFlow = () => null

function fixture() {
  const core = new SlotCore() as any
  core.register({ name: 'root', children: { [HERO]: { kind: 'single', scope: 'root' } } }, () => null)
  core.register({ name: HERO, children: { [FLOW]: { kind: 'single', scope: 'root' } } }, NativePicker)
  const slots = { inject(_key: string, fn: () => () => void) { return fn() },
    register: core.register.bind(core), subscribe: core.subscribe.bind(core),
    entriesOfSlot: core.entriesOfSlot.bind(core), spec: core.spec.bind(core),
    onEntryError: core.onEntryError.bind(core),
  }
  const model = { reportFailure: vi.fn() } as any
  return { core, slots, model }
}

it('mirrors native and browse capabilities, follows source replacement/removal, and restores the original on unload', async () => {
  const { core, slots, model } = fixture()
  const pick = vi.fn(), injected = () => ({ pick })
  const removeNative = core.register({ name: FLOW, inject: injected }, NativeFlow)
  const unload = installTemporaryWorkspacePicker(slots, model, vi.fn())
  expect(core.entriesOfSlot(HERO)[0].options.priority).toBe(-10)
  expect(core.entriesOfSlot(TEMP_WORKSPACE_FLOW_SLOT)[0].component).toBe(NativeFlow)
  expect(core.entriesOfSlot(TEMP_WORKSPACE_FLOW_SLOT)[0].inject()).toEqual({ pick })
  removeNative(); await Promise.resolve()
  expect(core.entriesOfSlot(TEMP_WORKSPACE_FLOW_SLOT)).toEqual([])
  const browse = () => ({ listDirectory: vi.fn(), createDirectory: vi.fn(), t: vi.fn() })
  core.register({ name: FLOW, inject: browse }, BrowseFlow); await Promise.resolve()
  expect(core.entriesOfSlot(TEMP_WORKSPACE_FLOW_SLOT)[0].component).toBe(BrowseFlow)
  unload(); await Promise.resolve()
  expect(core.entriesOfSlot(HERO)[0].component).toBe(NativePicker)
  expect(core.entriesOfSlot(FLOW)[0].component).toBe(BrowseFlow)
  expect(core.specDynamic(TEMP_WORKSPACE_FLOW_SLOT)).toBeUndefined()
  expect(model.reportFailure).not.toHaveBeenCalled()
  const reinstall = installTemporaryWorkspacePicker(slots, model, vi.fn()); reinstall()
  expect(core.entriesOfSlot(HERO)[0].component).toBe(NativePicker)
})

it('preserves the original menu and shows a failure when a future flow requires children or a store', async () => {
  const { core, slots, model } = fixture()
  core.register({ name: FLOW, children: { 'future.flow': { kind: 'single', scope: 'root' } } }, NativeFlow)
  const unload = installTemporaryWorkspacePicker(slots, model, vi.fn())
  expect(core.entriesOfSlot(HERO)[0].component).toBe(NativePicker)
  expect(core.entriesOfSlot(FLOW)[0].component).toBe(NativeFlow)
  expect(core.specDynamic(TEMP_WORKSPACE_FLOW_SLOT)).toBeUndefined()
  expect(model.reportFailure).toHaveBeenCalledWith(expect.stringContaining('preserved'))
  unload()
})

it('restores the original on a mirrored component crash instead of leaving a dead Add Workspace action', () => {
  const { core, slots, model } = fixture()
  core.register({ name: FLOW }, NativeFlow)
  const unload = installTemporaryWorkspacePicker(slots, model, vi.fn())
  const mirror = core.entriesOfSlot(TEMP_WORKSPACE_FLOW_SLOT)[0]
  core.reportEntryError(TEMP_WORKSPACE_FLOW_SLOT, mirror, new Error('new required hook'), { abdicate: true })
  expect(core.entriesOfSlot(HERO)[0].component).toBe(NativePicker)
  expect(model.reportFailure).toHaveBeenCalledOnce()
  unload()
})
