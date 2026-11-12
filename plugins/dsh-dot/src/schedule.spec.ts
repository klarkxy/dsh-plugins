import { describe, expect, it } from 'vitest'
import { REMINDER_HEAD, TOOL, type ScheduleRecord } from './contracts.ts'
import { SCHEDULE_PROMPT_MAX, ScheduleInputError, describeTiming, formatReminders, nextOccurrence, parseSchedule, scheduleLines } from './schedule.ts'
import { stamp } from './transcript.ts'

const MINUTE = 60_000
/** Host-local wall clock, like the reminders themselves. */
const local = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime()
const NOW = local(2031, 3, 5, 10, 0)
const base = { title: 'Check the build', prompt: 'Read the release task and report.' }

describe('parseSchedule', () => {
  it('turns after_minutes and at into a single firing', () => {
    expect(parseSchedule({ ...base, afterMinutes: 30 }, NOW)).toEqual({ ...base, timing: { kind: 'once', at: NOW + 30 * MINUTE }, nextAt: NOW + 30 * MINUTE })
    expect(parseSchedule({ ...base, at: '2031-03-06 09:30' }, NOW).nextAt).toBe(local(2031, 3, 6, 9, 30))
    expect(parseSchedule({ ...base, at: '2031-03-06T09:30' }, NOW).nextAt).toBe(local(2031, 3, 6, 9, 30))
    expect(parseSchedule({ ...base, at: '2031-03-06T09:30:00Z' }, NOW).nextAt).toBe(Date.UTC(2031, 2, 6, 9, 30))
  })

  it('refuses a moment that has passed or does not exist', () => {
    expect(() => parseSchedule({ ...base, at: '2031-03-05 09:00' }, NOW)).toThrow(/in the future/)
    expect(() => parseSchedule({ ...base, at: '2031-02-30 09:00' }, NOW)).toThrow(/does not exist/)
    expect(() => parseSchedule({ ...base, at: 'tomorrow morning' }, NOW)).toThrow(/YYYY-MM-DD HH:mm/)
  })

  it('repeats every N minutes from the moment it was set', () => {
    const parsed = parseSchedule({ ...base, everyMinutes: 45 }, NOW)
    expect(parsed.timing).toEqual({ kind: 'every', minutes: 45, anchor: NOW })
    expect(parsed.nextAt).toBe(NOW + 45 * MINUTE)
  })

  it('repeats daily, on chosen weekdays when given', () => {
    expect(parseSchedule({ ...base, dailyTime: '9:05' }, NOW)).toMatchObject({ timing: { kind: 'daily', time: '09:05' }, nextAt: local(2031, 3, 6, 9, 5) })
    expect(parseSchedule({ ...base, dailyTime: '18:00' }, NOW).nextAt).toBe(local(2031, 3, 5, 18, 0))
    const today = new Date(NOW).getDay() === 0 ? 7 : new Date(NOW).getDay()
    // Today's time has passed: the same weekday comes round a week later.
    expect(parseSchedule({ ...base, dailyTime: '09:00', weekdays: [today, today] }, NOW)).toMatchObject({ timing: { weekdays: [today] }, nextAt: local(2031, 3, 12, 9, 0) })
    // Every day of the week is the same as no weekday filter.
    expect(parseSchedule({ ...base, dailyTime: '09:00', weekdays: [7, 6, 5, 4, 3, 2, 1] }, NOW).timing).toEqual({ kind: 'daily', time: '09:00' })
  })

  it('says what to change when the request is not a reminder', () => {
    const bad = (input: Parameters<typeof parseSchedule>[0], message: RegExp) => {
      expect(() => parseSchedule(input, NOW)).toThrow(ScheduleInputError)
      expect(() => parseSchedule(input, NOW)).toThrow(message)
    }
    bad({ ...base }, /exactly one/)
    bad({ ...base, afterMinutes: 5, everyMinutes: 5 }, /exactly one/)
    bad({ ...base, afterMinutes: 5, weekdays: [1] }, /weekdays only goes with daily_time/)
    bad({ ...base, dailyTime: '25:00' }, /HH:mm/)
    bad({ ...base, dailyTime: '09:00', weekdays: [0] }, /1 \(Monday\) to 7 \(Sunday\)/)
    bad({ ...base, everyMinutes: 0 }, /every_minutes must be a whole number/)
    bad({ ...base, afterMinutes: 1.5 }, /after_minutes must be a whole number/)
    bad({ ...base, title: '   ', afterMinutes: 5 }, /title must be non-empty/)
    bad({ ...base, prompt: 'x'.repeat(SCHEDULE_PROMPT_MAX + 1), afterMinutes: 5 }, /prompt must be at most/)
  })
})

describe('nextOccurrence', () => {
  it('ends a single firing and keeps a repeat on its grid after a long gap', () => {
    expect(nextOccurrence({ kind: 'once', at: NOW }, NOW)).toBeUndefined()
    expect(nextOccurrence({ kind: 'once', at: NOW + 1 }, NOW)).toBe(NOW + 1)
    const every = { kind: 'every' as const, minutes: 30, anchor: NOW }
    expect(nextOccurrence(every, NOW)).toBe(NOW + 30 * MINUTE)
    expect(nextOccurrence(every, NOW + 30 * MINUTE)).toBe(NOW + 60 * MINUTE)
    // Four and a half intervals were missed: the next one is the fifth, not a burst of five.
    expect(nextOccurrence(every, NOW + 135 * MINUTE)).toBe(NOW + 150 * MINUTE)
  })
})

describe('reminder text', () => {
  const once: ScheduleRecord = { id: 'sch-1', title: 'Check the build', prompt: 'Read the release task.\nTell the human if it failed.', timing: { kind: 'once', at: NOW }, createdAt: NOW - MINUTE, nextAt: NOW }
  const every: ScheduleRecord = { id: 'sch-2', title: 'Pulse', prompt: 'Look at the board.', timing: { kind: 'every', minutes: 60, anchor: NOW - 180 * MINUTE }, createdAt: NOW - 180 * MINUTE, nextAt: NOW - 120 * MINUTE }

  it('hands dot every due reminder in one message', () => {
    const text = formatReminders([once, every], NOW)
    const lines = text.split('\n')
    expect(lines[0]!.startsWith(REMINDER_HEAD)).toBe(true)
    expect(lines[1]).toBe(`- sch-1 "Check the build" (once; due ${stamp(NOW)}; now removed): Read the release task.`)
    // Later lines of a prompt stay inside its entry.
    expect(lines[2]).toBe('  Tell the human if it failed.')
    expect(lines[3]).toBe(`- sch-2 "Pulse" (every 60 min; due ${stamp(NOW - 120 * MINUTE)}, delivered late; next ${stamp(NOW + 60 * MINUTE)}): Look at the board.`)
    expect(lines).toHaveLength(5)
  })

  it('lists what is set and names the tool when nothing is', () => {
    expect(scheduleLines([])).toContain(TOOL.scheduleAdd)
    expect(scheduleLines([every])).toBe(`- sch-2 "Pulse" (every 60 min; next ${stamp(NOW - 120 * MINUTE)}): Look at the board.`)
    expect(describeTiming({ kind: 'daily', time: '09:00', weekdays: [1, 5] })).toBe('Mon, Fri at 09:00')
    expect(describeTiming({ kind: 'daily', time: '09:00' })).toBe('daily at 09:00')
  })
})
