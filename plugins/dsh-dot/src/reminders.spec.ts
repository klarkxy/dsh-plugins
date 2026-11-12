import { describe, expect, it } from 'vitest'
import type { Timer } from './batcher.ts'
import { REMINDER_HEAD } from './contracts.ts'
import { ReminderClock } from './reminders.ts'
import { MAX_SCHEDULES, ScheduleInputError } from './schedule.ts'
import { DotStore } from './store.ts'

const MINUTE = 60_000
const START = new Date(2031, 2, 5, 10, 0).getTime()

function setup() {
  let at = START
  let handle = 0
  const armed = new Map<number, number>()
  const timer: Timer = {
    set: (_callback, ms) => { armed.set(++handle, ms); return handle },
    clear: id => { armed.delete(id as number) },
    now: () => at,
  }
  const store = new DotStore(undefined)
  const delivered: string[] = []
  const logs: string[] = []
  let failing = false
  let during: (() => Promise<unknown>) | undefined
  const clock = new ReminderClock({
    store,
    timer,
    now: () => at,
    log: message => logs.push(message),
    deliver: async text => {
      if (failing) throw new Error('dot is unreachable')
      await during?.()
      delivered.push(text)
    },
  })
  return {
    clock, store, delivered, logs,
    /** The one wait the timer is set to, if any. */
    wait: () => { expect(armed.size).toBeLessThanOrEqual(1); return [...armed.values()][0] },
    advance: (ms: number) => { at += ms },
    fail: (value: boolean) => { failing = value },
    whileDelivering: (work: () => Promise<unknown>) => { during = work },
  }
}

describe('ReminderClock', () => {
  it('stores reminders before it starts and sets one timer to the earliest once it runs', async () => {
    const h = setup()
    const later = await h.clock.add({ title: 'later', prompt: 'p', afterMinutes: 20 })
    expect(later.id).toMatch(/^sch-[0-9a-f]{6}$/)
    expect(h.wait()).toBeUndefined()
    h.clock.start()
    expect(h.wait()).toBe(20 * MINUTE)
    await h.clock.add({ title: 'sooner', prompt: 'p', afterMinutes: 5 })
    expect(h.wait()).toBe(5 * MINUTE)
    // A far reminder is still checked every half hour, so a slept host is noticed.
    expect(await h.clock.remove(later.id)).toBe(true)
    await h.clock.add({ title: 'far', prompt: 'p', dailyTime: '09:00' })
    expect(await h.clock.remove(h.store.schedules[0]!.id)).toBe(true)
    expect(h.wait()).toBe(30 * MINUTE)
    expect(await h.clock.remove('sch-nope')).toBe(false)
  })

  it('delivers what is due in one message, drops single firings and moves repeats on', async () => {
    const h = setup()
    h.clock.start()
    const once = await h.clock.add({ title: 'once', prompt: 'check the build', afterMinutes: 10 })
    const every = await h.clock.add({ title: 'pulse', prompt: 'look at the board', everyMinutes: 10 })
    await h.clock.add({ title: 'not yet', prompt: 'p', afterMinutes: 60 })
    h.advance(10 * MINUTE)
    await h.clock.tick()
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0]!.startsWith(REMINDER_HEAD)).toBe(true)
    expect(h.delivered[0]).toContain('check the build')
    expect(h.delivered[0]).toContain('look at the board')
    expect(h.delivered[0]).not.toContain('not yet')
    expect(h.store.schedule(once.id)).toBeUndefined()
    expect(h.store.schedule(every.id)).toMatchObject({ nextAt: START + 20 * MINUTE, lastFiredAt: START + 10 * MINUTE })
    expect(h.wait()).toBe(10 * MINUTE)
    // Nothing is due: a tick only sets the timer again.
    await h.clock.tick()
    expect(h.delivered).toHaveLength(1)
  })

  it('delivers a reminder missed during downtime once and continues from now', async () => {
    const h = setup()
    const every = await h.clock.add({ title: 'pulse', prompt: 'look at the board', everyMinutes: 30 })
    const once = await h.clock.add({ title: 'once', prompt: 'call back', afterMinutes: 45 })
    // The host was off for five hours and comes back.
    h.advance(5 * 60 * MINUTE)
    h.clock.start()
    expect(h.wait()).toBe(0)
    await h.clock.tick()
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0]).toContain('delivered late')
    expect(h.store.schedule(once.id)).toBeUndefined()
    expect(h.store.schedule(every.id)!.nextAt).toBe(START + 330 * MINUTE)
    await h.clock.tick()
    expect(h.delivered).toHaveLength(1)
  })

  it('keeps reminders due when the delivery fails and tries again a minute later', async () => {
    const h = setup()
    h.clock.start()
    const once = await h.clock.add({ title: 'once', prompt: 'call back', afterMinutes: 1 })
    h.advance(MINUTE)
    h.fail(true)
    await h.clock.tick()
    expect(h.delivered).toEqual([])
    expect(h.store.schedule(once.id)).toBeDefined()
    expect(h.wait()).toBe(MINUTE)
    expect(h.logs.join('\n')).toContain('dot is unreachable')
    h.fail(false)
    h.advance(MINUTE)
    await h.clock.tick()
    expect(h.delivered).toHaveLength(1)
    expect(h.store.schedules).toEqual([])
    expect(h.wait()).toBeUndefined()
  })

  it('leaves a reminder removed while it was being delivered', async () => {
    const h = setup()
    h.clock.start()
    const every = await h.clock.add({ title: 'pulse', prompt: 'p', everyMinutes: 5 })
    h.advance(5 * MINUTE)
    h.whileDelivering(() => h.clock.remove(every.id))
    await h.clock.tick()
    expect(h.delivered).toHaveLength(1)
    expect(h.store.schedules).toEqual([])
  })

  it('refuses a reminder past the cap and stops for good when disposed', async () => {
    const h = setup()
    h.clock.start()
    for (let index = 0; index < MAX_SCHEDULES; index++) await h.clock.add({ title: `r${index}`, prompt: 'p', afterMinutes: 10 + index })
    await expect(h.clock.add({ title: 'one more', prompt: 'p', afterMinutes: 5 })).rejects.toThrow(ScheduleInputError)
    h.clock.dispose()
    expect(h.wait()).toBeUndefined()
    h.advance(60 * MINUTE)
    await h.clock.tick()
    expect(h.delivered).toEqual([])
  })
})
