/**
 * Reminders dot sets for itself. A reminder belongs to dot and not to a
 * session, so it reaches whatever segment the conversation is in when it is
 * due. This file holds the timing rules and the model-facing text; the clock
 * in reminders.ts owns the timer and the delivery.
 */
import { REMINDER_HEAD, TOOL, type ScheduleRecord, type ScheduleTiming } from './contracts.ts'
import { stamp } from './transcript.ts'

export const MAX_SCHEDULES = 50
export const SCHEDULE_TITLE_MAX = 120
export const SCHEDULE_PROMPT_MAX = 2000
/** Every firing costs dot a model turn, so repeats stay at a minute or more. */
export const MIN_EVERY_MINUTES = 1
export const MAX_EVERY_MINUTES = 7 * 24 * 60
export const MAX_AFTER_MINUTES = 366 * 24 * 60
/** A reminder delivered this long after it was due is marked late. */
const LATE_MS = 5 * 60_000
const MINUTE_MS = 60_000

/** What the model passed to the tool; exactly one timing field is expected. */
export interface ScheduleInput {
  readonly title: string
  readonly prompt: string
  readonly afterMinutes?: number
  readonly at?: string
  readonly everyMinutes?: number
  readonly dailyTime?: string
  readonly weekdays?: readonly number[]
}

/** The input cannot become a reminder; the message tells the model what to change. */
export class ScheduleInputError extends Error {
  constructor(message: string) { super(message); this.name = 'ScheduleInputError' }
}

const LOCAL_AT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
const ZONED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/
const TIME_OF_DAY = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** A date and time in the host's local zone, or one that names its own offset. */
function parseAt(text: string): number {
  const value = text.trim()
  const local = LOCAL_AT.exec(value)
  if (local) {
    const part = local.slice(1).map(group => Number(group ?? 0))
    const date = new Date(part[0]!, part[1]! - 1, part[2]!, part[3]!, part[4]!, part[5]!)
    const same = date.getFullYear() === part[0] && date.getMonth() === part[1]! - 1 && date.getDate() === part[2] && date.getHours() === part[3] && date.getMinutes() === part[4]
    if (!same) throw new ScheduleInputError(`at names a date or time that does not exist: ${value}`)
    return date.getTime()
  }
  const zoned = ZONED_AT.test(value) ? Date.parse(value) : Number.NaN
  if (Number.isNaN(zoned)) throw new ScheduleInputError('at must read YYYY-MM-DD HH:mm in the host\'s local time')
  return zoned
}

function wholeMinutes(value: number, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new ScheduleInputError(`${name} must be a whole number from ${min} to ${max}`)
  return value
}

/** Validate a tool request into the stored parts of a reminder. */
export function parseSchedule(input: ScheduleInput, now: number): Pick<ScheduleRecord, 'title' | 'prompt' | 'timing' | 'nextAt'> {
  const title = input.title.replace(/\s+/g, ' ').trim()
  const prompt = input.prompt.trim()
  if (!title) throw new ScheduleInputError('title must be non-empty')
  if (title.length > SCHEDULE_TITLE_MAX) throw new ScheduleInputError(`title must be at most ${SCHEDULE_TITLE_MAX} characters`)
  if (!prompt) throw new ScheduleInputError('prompt must be non-empty')
  if (prompt.length > SCHEDULE_PROMPT_MAX) throw new ScheduleInputError(`prompt must be at most ${SCHEDULE_PROMPT_MAX} characters`)
  const given = [input.afterMinutes, input.at, input.everyMinutes, input.dailyTime].filter(value => value !== undefined).length
  if (given !== 1) throw new ScheduleInputError('give exactly one of after_minutes, at, every_minutes or daily_time')
  if (input.weekdays !== undefined && input.dailyTime === undefined) throw new ScheduleInputError('weekdays only goes with daily_time')

  let timing: ScheduleTiming
  if (input.afterMinutes !== undefined) {
    timing = { kind: 'once', at: now + wholeMinutes(input.afterMinutes, 'after_minutes', 1, MAX_AFTER_MINUTES) * MINUTE_MS }
  } else if (input.at !== undefined) {
    const at = parseAt(input.at)
    if (at <= now) throw new ScheduleInputError(`at must be in the future; it is ${stamp(now)} now`)
    timing = { kind: 'once', at }
  } else if (input.everyMinutes !== undefined) {
    timing = { kind: 'every', minutes: wholeMinutes(input.everyMinutes, 'every_minutes', MIN_EVERY_MINUTES, MAX_EVERY_MINUTES), anchor: now }
  } else {
    const time = TIME_OF_DAY.exec(input.dailyTime!.trim())
    if (!time) throw new ScheduleInputError('daily_time must read HH:mm')
    const weekdays = input.weekdays === undefined ? undefined : [...new Set(input.weekdays)].sort((a, b) => a - b)
    if (weekdays && (weekdays.length === 0 || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7))) throw new ScheduleInputError('weekdays must list days from 1 (Monday) to 7 (Sunday)')
    timing = { kind: 'daily', time: `${time[1]!.padStart(2, '0')}:${time[2]}`, ...weekdays && weekdays.length < 7 ? { weekdays } : {} }
  }
  const nextAt = nextOccurrence(timing, now)
  if (nextAt === undefined) throw new ScheduleInputError('that timing never comes due')
  return { title, prompt, timing, nextAt }
}

/** The first time a timing is due after `after`; undefined once it never is again. */
export function nextOccurrence(timing: ScheduleTiming, after: number): number | undefined {
  switch (timing.kind) {
    case 'once':
      return timing.at > after ? timing.at : undefined
    case 'every': {
      const step = timing.minutes * MINUTE_MS
      return timing.anchor + Math.max(1, Math.floor((after - timing.anchor) / step) + 1) * step
    }
    case 'daily': {
      const [hour = 0, minute = 0] = timing.time.split(':').map(Number)
      const from = new Date(after)
      // Eight days cover a single weekday whose time has already passed today.
      for (let offset = 0; offset <= 8; offset++) {
        const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, hour, minute)
        const weekday = candidate.getDay() === 0 ? 7 : candidate.getDay()
        if (candidate.getTime() > after && (!timing.weekdays || timing.weekdays.includes(weekday))) return candidate.getTime()
      }
      return undefined
    }
  }
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Model-facing wording of a timing. */
export function describeTiming(timing: ScheduleTiming): string {
  switch (timing.kind) {
    case 'once': return 'once'
    case 'every': return `every ${timing.minutes} min`
    case 'daily': return timing.weekdays ? `${timing.weekdays.map(day => DAY[day - 1]).join(', ')} at ${timing.time}` : `daily at ${timing.time}`
  }
}

/** Later lines of a prompt are indented so each reminder stays one list entry. */
const entryText = (prompt: string) => prompt.split('\n').map((line, index) => index === 0 ? line : `  ${line}`).join('\n')

/** The message dot receives when reminders come due. */
export function formatReminders(due: readonly ScheduleRecord[], now: number): string {
  const lines = [`${REMINDER_HEAD} Reminders you set for yourself are due:`]
  for (const record of due) {
    const next = nextOccurrence(record.timing, now)
    const facts = [
      describeTiming(record.timing),
      `due ${stamp(record.nextAt)}${now - record.nextAt > LATE_MS ? ', delivered late' : ''}`,
      next === undefined ? 'now removed' : `next ${stamp(next)}`,
    ]
    lines.push(`- ${record.id} "${record.title}" (${facts.join('; ')}): ${entryText(record.prompt)}`)
  }
  lines.push('Do what each one asks now. The human reads your reply in the chat, so tell them what is worth their attention and nothing about the reminder itself.')
  return lines.join('\n')
}

/** The reminders as dot reads them in the list tool. */
export function scheduleLines(records: readonly ScheduleRecord[]): string {
  if (records.length === 0) return `No reminders set. ${TOOL.schedule} (action=add) sets one.`
  return records.map(record => `- ${record.id} "${record.title}" (${describeTiming(record.timing)}; next ${stamp(record.nextAt)}): ${entryText(record.prompt)}`).join('\n')
}
