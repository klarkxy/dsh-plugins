/**
 * Preset child plugin: dot's model tools. It loads as one row of the dot
 * preset, so only dot's agent sees these tools; ordinary sessions never get
 * them. The orchestration lives in the root `dot` service.
 *
 * All tool parameter schemas are intentionally flat (plain object + scalar /
 * enum fields only). No oneOf / anyOf / allOf / const / union types are used
 * because bridge channels (e.g. Gemini function calling) silently drop tools
 * that contain non-compliant schemas.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SERVICE_NAME, TOOL } from './contracts.ts'
import { personaSection } from './persona.ts'
import { DotError, messageOf, type DotService } from './service.ts'

export const name = 'dsh-dot-tools'
export const inject = ['tools', 'systemPrompt', SERVICE_NAME] as const

/** Right after the fixed instructions in the persona prefix (order 0). */
const PERSONA_ORDER = 1
/** What dot knows in every conversation, between who it is and what this conversation was. */
const MEMORY_ORDER = 2
/** What the segment was handed from the conversation before it. */
const HANDOFF_ORDER = 3

/** The part of an assembly context these sections read: the agent the prompt is built for. */
interface AssemblyContext { readonly agent?: { readonly session?: { readonly id?: string } } }

/** defineTool's input, kept opaque: its generic inference is too deep for these JSON schemas. */
type ToolInput = Record<string, unknown>

type ToolHost = Context
  & { tools: { register(definition: unknown): () => void } }
  & { systemPrompt: { section(section: { name: string; order: number; text: (context?: AssemblyContext) => string; interpolate?: boolean }): () => void } }
  & Record<typeof SERVICE_NAME, DotService>

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const str = (args: unknown, key: string): string | undefined => {
  const value = (args as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' ? value : undefined
}

const num = (args: unknown, key: string): number | undefined => {
  const value = (args as Record<string, unknown> | null)?.[key]
  return typeof value === 'number' ? value : undefined
}

const bool = (args: unknown, key: string): boolean =>
  (args as Record<string, unknown> | null)?.[key] === true

async function run(work: () => Promise<string> | string): Promise<string> {
  try {
    return await work()
  } catch (error) {
    const code = error instanceof DotError ? error.code : 'dot/failed'
    return `Error [${code}]: ${messageOf(error)}`
  }
}

export function apply(ctx: Context): void {
  const host = ctx as ToolHost
  const dot = () => host[SERVICE_NAME]
  // Both sections read what the segment froze when it started, so every request of a segment
  // shares one prompt prefix; a settings edit reaches dot with her next segment. A session
  // that is not the recorded segment (one being set up) reads the live settings.
  const segmentOf = (context?: AssemblyContext) => {
    const segment = dot().store.segment
    const id = context?.agent?.session?.id
    return segment && (id === undefined || id === segment.sessionId) ? segment : undefined
  }
  ctx.effect(() => host.systemPrompt.section({ name: 'dsh-dot:persona', order: PERSONA_ORDER, interpolate: false, text: context => segmentOf(context)?.persona ?? personaSection(dot().store.settings) }))
  // dot's notes, as they read when the segment started; empty while there are none.
  ctx.effect(() => host.systemPrompt.section({ name: 'dsh-dot:memory', order: MEMORY_ORDER, interpolate: false, text: context => { const segment = segmentOf(context); return segment ? segment.memory ?? '' : dot().currentNotesBlock() } }))
  // Empty in dot's very first segment; the host drops empty sections.
  ctx.effect(() => host.systemPrompt.section({ name: 'dsh-dot:handoff', order: HANDOFF_ORDER, interpolate: false, text: context => segmentOf(context)?.opening ?? '' }))

  // Attach hostEffect after defineTool: the standard host drops unknown options.
  const tool = (definition: ToolInput, readOnly = false) => {
    const made = (defineTool as unknown as (input: ToolInput) => Record<string, unknown>)(definition)
    ctx.effect(() => host.tools.register(readOnly ? { ...made, hostEffect: 'read-only' as const } : made))
  }

  // ── dot_overview ──────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.overview,
    description: 'Ledger of the tasks you track (status, unread turns, waiting requests) plus every top-level session on this host, newest first. Clears the unread counters.',
    parameters: {
      limit: { type: 'integer', description: 'Sessions to list, default 30.' },
    },
    execute: (args, exec) => run(() => dot().overview(exec.signal ?? new AbortController().signal, typeof (args as { limit?: unknown }).limit === 'number' ? (args as { limit: number }).limit : 30)),
    title: 'Overview',
  }), true)

  // ── dot_read ──────────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.read,
    description: 'Read the latest assistant reply of one session, with its tracked goal and status. Use it to check results against the goal.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session to read.' },
      max_chars: { type: 'integer', description: 'Tail characters of the reply, default 4000.' },
    },
    execute: args => run(() => dot().read(str(args, 'session_id') ?? '', typeof (args as { max_chars?: unknown }).max_chars === 'number' ? (args as { max_chars: number }).max_chars : 4000)),
    title: 'Read session',
  }), true)

  // ── dot_workspace (merged from dot_list_workspaces + dot_create_workspace) ─
  tool(defineToolInput({
    name: TOOL.workspace,
    description: 'Manage workspaces. action=list: list workspaces (id, title, directory, session count), your own workspace is marked. action=create: create or reuse a workspace for an absolute directory; the directory is created when missing.',
    parameters: {
      action: { type: 'string', enum: ['list', 'create'], required: true, description: 'list or create.' },
      path: { type: 'string', description: 'create only: absolute directory.' },
      title: { type: 'string', description: 'create only: display title for a new workspace.' },
    },
    execute: args => run(() => {
      const action = str(args, 'action')
      if (action === 'create') return dot().createWorkspace(str(args, 'path') ?? '', str(args, 'title'))
      return dot().listWorkspaces()
    }),
    title: 'Workspace',
  }))

  // ── dot_start_task ────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.startTask,
    description: `Open a new top-level session in a workspace (or directory), send it the first instruction as the human's request, and track it. Without workspace_id and cwd it runs in your own workspace. Write a self-contained instruction: goal, context, constraints, definition of done, what to report.`,
    parameters: {
      title: { type: 'string', required: true, description: 'Short task name for the board.' },
      instruction: { type: 'string', required: true, description: 'First message the session receives.' },
      workspace_id: { type: 'string', description: 'Workspace to run in (preferred when the task belongs to a project).' },
      cwd: { type: 'string', description: 'Absolute directory when no workspace fits.' },
      goal: { type: 'string', description: 'What done means, kept in the ledger; defaults to the instruction.' },
      model: { type: 'string', description: `Model to run on, as provider/model from ${TOOL.listModels}. Leave it out for the default.` },
      preset: { type: 'string', description: 'Agent preset: the tools and instructions the session works with. Leave it out for the default, which fits most work. "ptc" for mechanical work that is mostly running steps by script: bulk edits, batch processing, repetitive checks. "cordis" for work on DSH itself: writing or changing DSH plugins, presets and settings.' },
    },
    execute: (args, exec) => run(() => dot().startTask({
      title: str(args, 'title') ?? 'task',
      instruction: str(args, 'instruction') ?? '',
      ...str(args, 'workspace_id') ? { workspaceId: str(args, 'workspace_id')! } : {},
      ...str(args, 'cwd') ? { cwd: str(args, 'cwd')! } : {},
      ...str(args, 'goal') ? { goal: str(args, 'goal')! } : {},
      ...str(args, 'model') ? { model: str(args, 'model')! } : {},
      ...str(args, 'preset') ? { preset: str(args, 'preset')! } : {},
    }, exec.signal ?? new AbortController().signal)),
    title: 'Start task',
  }))

  // ── dot_list_models ───────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.listModels,
    description: `The models a task may run on, as provider/model keys, and the default a task gets without one. The human decides in your settings which models are allowed; ${TOOL.startTask} refuses the others.`,
    parameters: {},
    execute: () => run(() => dot().listModels()),
    title: 'List models',
  }), true)

  // ── dot_send ──────────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.sendToSession,
    description: 'Send a message to any session as yourself (agent-attributed). Wakes an idle session; a running one gets it at its next turn.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Target session.' },
      message: { type: 'string', required: true, description: 'Text to deliver.' },
    },
    execute: args => run(() => dot().send(str(args, 'session_id') ?? '', str(args, 'message') ?? '')),
    title: 'Message session',
  }))

  // ── dot_interrupt ─────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.interruptSession,
    description: 'Stop the current turn of a session. Its queued messages stay.',
    parameters: { session_id: { type: 'string', required: true, description: 'Session to stop.' } },
    execute: args => run(() => dot().interrupt(str(args, 'session_id') ?? '')),
    title: 'Stop session',
  }))

  // ── dot_archive ───────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.archiveSession,
    description: 'Archive a session you started yourself (marked "started" in the ledger), stopping its running work. Waiting requests from it are declined. Sessions you did not start are refused.',
    parameters: { session_id: { type: 'string', required: true, description: 'A session you started.' } },
    execute: args => run(() => dot().archive(str(args, 'session_id') ?? '')),
    title: 'Archive session',
  }))

  // ── dot_watch ─────────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.watchSession,
    description: 'Track a session you did not start: it joins the ledger and board, and its finished turns, errors and requests reach you.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session to watch.' },
      goal: { type: 'string', required: true, description: 'What the human expects from it.' },
      title: { type: 'string', description: 'Board name.' },
    },
    execute: args => run(() => dot().watch(str(args, 'session_id') ?? '', str(args, 'goal') ?? '', str(args, 'title'))),
    title: 'Watch session',
  }))

  // ── dot_answer ────────────────────────────────────────────────────────────
  // answers.items is kept as array-of-object; the outer container is now a
  // plain optional field (no oneOf), and the allow field is a plain optional
  // boolean (no oneOf). Callers pass either allow or answers, never both.
  tool(defineToolInput({
    name: TOOL.answerPending,
    description: 'Settle a waiting approval or question from another session by its id (ap-N / q-N). Approval: set allow to true or false. Question: give answers as an array, one item per question id, with selected option labels and/or custom text. Follow the instruction attached to the request; stay silent after settling routine requests or ones already answered in their own session.',
    parameters: {
      id: { type: 'string', required: true, description: 'Request id from the notice.' },
      allow: { type: 'boolean', description: 'Approval decision (omit for a question).' },
      answers: {
        type: 'array',
        description: 'Question answers (omit for an approval). One item per question id.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', required: true },
            selected: { type: 'array', items: { type: 'string' } },
            custom: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    execute: args => run(() => {
      const id = str(args, 'id') ?? ''
      const allow = (args as { allow?: unknown }).allow
      const answers = (args as { answers?: unknown }).answers
      if (typeof allow === 'boolean') return dot().answer(id, { kind: 'approval', allow })
      if (Array.isArray(answers)) {
        return dot().answer(id, { kind: 'question', answers: answers.map(item => {
          const row = item as { id?: unknown; selected?: unknown; custom?: unknown }
          return {
            id: String(row.id ?? ''),
            selected: Array.isArray(row.selected) ? row.selected.map(String) : [],
            ...typeof row.custom === 'string' && row.custom ? { custom: row.custom } : {},
          }
        }) })
      }
      throw new DotError('dot/invalid', 'give allow for an approval or answers for a question')
    }),
    title: 'Answer request',
  }))

  // ── dot_schedule (merged from dot_schedule_add + dot_schedule_list + dot_schedule_remove) ──
  tool(defineToolInput({
    name: TOOL.schedule,
    description: `Manage your reminders. action=add: set a reminder — when it is due you are woken by a [dot reminder] message carrying its prompt, in whatever session your conversation has moved to by then. Give exactly one timing: after_minutes, at, every_minutes, or daily_time (optionally with weekdays). Times are the host's local time. Every firing costs you a turn, so repeat no more often than the work needs. action=list: list all your reminders (id, title, timing, next due, prompt). action=remove: remove one reminder by its id (sch-...); remove a repeating reminder once its purpose is served.`,
    parameters: {
      action: { type: 'string', enum: ['add', 'list', 'remove'], required: true, description: 'add, list, or remove.' },
      title: { type: 'string', description: 'add: short name shown in the board.' },
      prompt: { type: 'string', description: 'add: what to do when the reminder fires. Write it for a later you who no longer has this conversation in view: what to check, where, and what to tell the human.' },
      after_minutes: { type: 'integer', description: 'add: once, this many minutes from now.' },
      at: { type: 'string', description: 'add: once, at this local date and time: YYYY-MM-DD HH:mm.' },
      every_minutes: { type: 'integer', description: 'add: repeating, this many minutes apart; the first time is one interval from now.' },
      daily_time: { type: 'string', description: 'add: repeating, every day at this local time: HH:mm.' },
      weekdays: { type: 'string', description: 'add: with daily_time only — comma-separated weekday numbers 1 (Monday) to 7 (Sunday), e.g. "1,2,3,4,5".' },
      id: { type: 'string', description: 'remove: reminder id (sch-...).' },
    },
    execute: args => run(() => {
      const action = str(args, 'action')
      if (action === 'list') return dot().scheduleList()
      if (action === 'remove') return dot().scheduleRemove(str(args, 'id') ?? '')
      // add
      const afterMinutes = num(args, 'after_minutes')
      const everyMinutes = num(args, 'every_minutes')
      const weekdaysRaw = str(args, 'weekdays')
      const weekdays = weekdaysRaw
        ? weekdaysRaw.split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n))
        : undefined
      return dot().scheduleAdd({
        title: str(args, 'title') ?? '',
        prompt: str(args, 'prompt') ?? '',
        ...afterMinutes === undefined ? {} : { afterMinutes },
        ...str(args, 'at') ? { at: str(args, 'at')! } : {},
        ...everyMinutes === undefined ? {} : { everyMinutes },
        ...str(args, 'daily_time') ? { dailyTime: str(args, 'daily_time')! } : {},
        ...weekdays ? { weekdays } : {},
      })
    }),
    title: 'Manage reminders',
  }))

  // ── dot_search_history ────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.searchHistory,
    description: `Find what was said earlier: in your own conversation with the human, including the sessions before a handoff, and in the sessions of the tasks on your ledger. Every word of the query has to occur in one message (any order, any letter case); it is a literal search, so use words that were actually said. Hits come with session_id and seq for ${TOOL.readHistory}.`,
    parameters: {
      query: { type: 'string', required: true, description: 'Words to find; fewer words find more.' },
      scope: { type: 'string', enum: ['all', 'own', 'tasks'], description: 'own: your conversation with the human; tasks: the task sessions; all (default): both.' },
      session_id: { type: 'string', description: 'Search this one session only.' },
      tools: { type: 'boolean', description: 'Also search tool calls and their results; default false, the conversation only.' },
      limit: { type: 'integer', description: 'Matches to list, default 12, at most 40.' },
    },
    execute: args => run(() => {
      const limit = num(args, 'limit')
      return dot().searchHistory({
        query: str(args, 'query') ?? '',
        ...str(args, 'scope') ? { scope: str(args, 'scope')! } : {},
        ...str(args, 'session_id') ? { sessionId: str(args, 'session_id')! } : {},
        tools: bool(args, 'tools'),
        ...limit === undefined ? {} : { limit },
      })
    }),
    title: 'Search history',
  }), true)

  // ── dot_read_history ──────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.readHistory,
    description: `Read a stretch of one session word for word: the messages around seq, or its last messages when seq is left out. Use it after ${TOOL.searchHistory}, or to read back the session before a handoff.`,
    parameters: {
      session_id: { type: 'string', required: true, description: 'Session to read.' },
      seq: { type: 'integer', description: 'Position to read around, from a search hit or an earlier read.' },
      before: { type: 'integer', description: 'Messages before it, default 4, at most 30.' },
      after: { type: 'integer', description: 'Messages after it, default 4, at most 30.' },
      tools: { type: 'boolean', description: 'Include tool calls and their results; default false.' },
    },
    execute: args => run(() => {
      const seq = num(args, 'seq')
      const before = num(args, 'before')
      const after = num(args, 'after')
      return dot().readHistory({
        sessionId: str(args, 'session_id') ?? '',
        ...seq === undefined ? {} : { seq },
        ...before === undefined ? {} : { before },
        ...after === undefined ? {} : { after },
        tools: bool(args, 'tools'),
      })
    }),
    title: 'Read history',
  }), true)

  // ── dot_remember ──────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.remember,
    description: 'Add one line to your notes: something you should know in every future conversation, such as who the human is, how they want you to work or speak, or a standing preference or correction. Write it so it makes sense on its own. Not for what merely happened or for task details; those stay findable in the history.',
    parameters: { text: { type: 'string', required: true, description: 'The note, one short line (at most 400 characters).' } },
    execute: args => run(() => dot().remember(str(args, 'text') ?? '')),
    title: 'Remember',
  }))

  // ── dot_forget ────────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.forget,
    description: `Remove one line from your notes, when it is outdated or wrong. To change a note, remove it and add the new wording with ${TOOL.remember}.`,
    parameters: { text: { type: 'string', required: true, description: 'The note, or enough of its words to single it out.' } },
    execute: args => run(() => dot().forget(str(args, 'text') ?? '')),
    title: 'Forget',
  }))

  // ── dot_new_segment ───────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.newSegment,
    description: 'Start a fresh context segment after this turn ends, carrying the ordinary handoff, task ledger, reminders and searchable history. Use it when a change of topic or accumulated context would help. Do not use it to avoid unfinished work. Optional focus tells your next segment what to concentrate on.',
    parameters: {
      focus: { type: 'string', description: 'What to focus on after the segment change.' },
    },
    execute: args => run(() => dot().requestSegment(str(args, 'focus'))),
    title: 'New segment',
  }))

  // ── dot_read_settings ─────────────────────────────────────────────────────
  const self = () => dot().selfSettings
  tool(defineToolInput({
    name: TOOL.readSettings,
    description: 'Read your own current settings, notes, which fields the human has locked, and changes waiting for approval. Everything is unlocked by default.',
    parameters: {},
    execute: () => run(() => self().read()),
    title: 'Read own settings',
  }), true)

  // ── dot_propose_settings ──────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.proposeSettings,
    description: 'Propose changing one unlocked setting or replacing your notes. Nothing changes until the human approves it in Settings. Fields: model, approvals, questions, scope, taskModels, policy, persona, address, memory. value uses the same shape as dot_read_settings, with null restoring a default or clearing notes. Locks and homeDir cannot be changed.',
    parameters: {
      field: { type: 'string', required: true, description: 'One setting field.' },
      value: { type: 'json', description: 'New value, in the shape shown by dot_read_settings.' },
      reason: { type: 'string', required: true, description: 'Why this change helps; shown to the human.' },
    },
    execute: args => run(() => self().propose({ field: str(args, 'field') ?? '', value: (args as Record<string, unknown> | null)?.value, reason: str(args, 'reason') ?? '' })),
    title: 'Propose settings change',
  }))
}

/** Shared defaults: text output, serial execution, a generic call card. */
function defineToolInput(input: {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<string>
  title: string
}): ToolInput {
  return {
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => false,
    execute: input.execute,
    presentCall: () => ({ card: 'generic', title: input.title, kind: 'other' }),
  }
}
