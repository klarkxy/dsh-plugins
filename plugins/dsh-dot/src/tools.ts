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
import { checkShownView } from '../../dsh-deep-view/src/core/index.js'
import type { ShownView } from '../../dsh-deep-view/src/contracts.ts'
import { cardPresentation, type DotCardMeta } from './cards.ts'
import { SERVICE_NAME, TOOL } from './contracts.ts'
import { personaSection } from './persona.ts'
import { settingsSnapshotBlock, type SelfSettings } from './self-settings.ts'
import { DotError, messageOf, type DotService } from './service.ts'
import { restrictInheritedTools } from './tool-scope.ts'

export const name = 'dsh-dot-tools'
export const inject = ['tools', 'systemPrompt', SERVICE_NAME] as const

/** Right after the fixed instructions in the persona prefix (order 0). */
const PERSONA_ORDER = 1
/** The human's own standing requirements, between who dot is and what it has come to understand. */
const AGREEMENTS_ORDER = 2
/** dot's own understanding of the human and of working with them. */
const COGNITION_ORDER = 3
/** What the segment was handed from the conversation before it. */
const HANDOFF_ORDER = 4
/** Last of the frozen blocks: the settings snapshot reads live so a change takes effect at once. */
const SETTINGS_SNAPSHOT_ORDER = 5

/** The part of an assembly context these sections read: the agent the prompt is built for. */
interface AssemblyContext { readonly agent?: { readonly session?: { readonly id?: string } } }

/** defineTool's input, kept opaque: its generic inference is too deep for these JSON schemas. */
type ToolInput = Record<string, unknown>

/**
 * The card-writing part of the root dot service (implemented in service.ts).
 * It registers a valid card and returns the presentation meta to persist.
 */
interface CardService {
  presentCard(shown: ShownView, callId: string): Promise<DotCardMeta>
}

type ToolHost = Context
  & { tools: { register(definition: unknown): () => void } }
  & { systemPrompt: { section(section: { name: string; order: number; text: (context?: AssemblyContext) => string; interpolate?: boolean }): () => void } }
  & Record<typeof SERVICE_NAME, DotService>
  & { _selfSettings?: SelfSettings }

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
  restrictInheritedTools(ctx, [...Object.values(TOOL), 'show_view'])
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
  // The human's own requirements, as they read when the segment started; empty while there are none.
  ctx.effect(() => host.systemPrompt.section({ name: 'dsh-dot:agreements', order: AGREEMENTS_ORDER, interpolate: false, text: context => { const segment = segmentOf(context); return segment ? segment.agreements ?? '' : dot().currentAgreementsBlock() } }))
  // dot's own understanding, as it read when the segment started; empty while dot has written none.
  ctx.effect(() => host.systemPrompt.section({ name: 'dsh-dot:cognition', order: COGNITION_ORDER, interpolate: false, text: context => { const segment = segmentOf(context); return segment ? segment.cognition ?? '' : dot().currentCognitionBlock() } }))
  // Empty in dot's very first segment; the host drops empty sections.
  ctx.effect(() => host.systemPrompt.section({ name: 'dsh-dot:handoff', order: HANDOFF_ORDER, interpolate: false, text: context => segmentOf(context)?.opening ?? '' }))
  // Core hard-switch state: always reads live settings so a change takes effect immediately.
  ctx.effect(() => host.systemPrompt.section({ name: 'dsh-dot:settings-snapshot', order: SETTINGS_SNAPSHOT_ORDER, interpolate: false, text: () => settingsSnapshotBlock(dot().store.settings) }))

  // Attach hostEffect after defineTool: the standard host drops unknown options.
  const tool = (definition: ToolInput, readOnly = false) => {
    const made = (defineTool as unknown as (input: ToolInput) => Record<string, unknown>)(definition)
    ctx.effect(() => host.tools.register(readOnly ? { ...made, hostEffect: 'read-only' as const } : made))
  }

  // ── show_view (dot scope, single-step) ────────────────────────────────────
  // Same name as dsh-deep-view's global tool. A preset row registers into the
  // agent scope, and a scoped registration shadows the global one, so only dot
  // gets this variant: a valid card concludes the turn in the same request.
  // Ordinary sessions keep deep-view's two-step show_view untouched.
  tool({
    name: 'show_view',
    description: [
      'Show the human one card and end this turn. This is how every reply to the human goes out: put your reply text inside the card (a text node is enough), then call show_view once as the very last step.',
      'Calling it ends the turn at once — finish every other tool call first and have its result in hand. If it reports an invalid view, fix the view and call show_view again in the same turn.',
      'Write the view as JSON text in view. Every ViewNode must carry a "type" field; nodes nest under stack|row (children, optional let).',
      'Display nodes: text, metric{label,value}, table{columns,rows}, chart{kind,categories,series}, progress{percent|value+max}, callout{text}, sources{items}. Inputs: slider, number, choice, toggle.',
      'To ask the human to choose, confirm or fill something in, use an options, confirm or form node and set await_reply true; a display-only card must not set it. A background wake-up with nothing for the human must not call this tool: end silently with no message.',
    ].join(' '),
    parameters: {
      title: { type: 'string', description: 'Short heading above the card.' },
      view: { type: 'string', required: true, description: 'One ViewNode as JSON text. Every node needs a "type"; nodes nest under stack|row children.' },
      await_reply: { type: 'boolean', description: 'true only for a card with answer controls (options/confirm/form); omit or false for a display card.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          summary: { type: 'string' },
          presentation: { type: 'object', additionalProperties: true },
        },
        additionalProperties: true,
      },
      // The model sees only "shown" for a card; an invalid view returns its error
      // so the model can correct it in the same turn (the turn is not concluded).
      render: (_args: unknown, value: unknown) => {
        const status = (value as { status?: unknown } | null)?.status
        return [{ type: 'text' as const, text: status === 'shown' || status === 'pending' ? 'shown' : String((value as { summary?: unknown } | null)?.summary ?? 'invalid view') }]
      },
      presentationMeta: (_args: unknown, value: unknown) => cardPresentation(value) ?? null,
    },
    isConcurrencySafe: () => false,
    execute: async (args: unknown, exec: { callId?: string; concludeTurn(): void }) => {
      const input = (args !== null && typeof args === 'object' ? args : {}) as Record<string, unknown>
      const invalid = (summary: string) => ({ status: 'invalid' as const, summary })
      let view = input.view
      if (typeof view === 'string') {
        try { view = JSON.parse(view) } catch { return invalid('view: expected JSON text describing one ViewNode') }
      }
      if (view === undefined || view === null) return invalid('view: expected one ViewNode')
      const checked = checkShownView(input.title, view)
      if ('error' in checked) return invalid(checked.error)
      if (input.await_reply !== undefined && typeof input.await_reply !== 'boolean') return invalid('await_reply: expected true or false')
      const awaitReply = input.await_reply ?? checked.interactive
      if (awaitReply !== checked.interactive) {
        return invalid(checked.interactive
          ? 'This card has answer controls; set await_reply true or omit it.'
          : 'A display-only card cannot wait for an answer; omit await_reply or set it false.')
      }
      try {
        const presentation = await (dot() as unknown as CardService).presentCard(checked, exec.callId ?? '')
        exec.concludeTurn()
        return { status: 'shown' as const, summary: 'shown', presentation }
      } catch (error) {
        return invalid(`the card could not be shown: ${messageOf(error)}`)
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Show view', kind: 'other' }),
  }, true)

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
  // Structured question answers are JSON text, keeping the model-facing schema scalar.
  // Callers pass either allow or answers, never both.
  tool(defineToolInput({
    name: TOOL.answerPending,
    description: 'Settle a waiting approval or question from another session by its id (ap-N / q-N). Approval: set allow to true or false. Question: give answers as a string containing a JSON array, one item per question id, with selected option labels and/or custom text. Follow the settings snapshot, agreements and approval principles in your system prompt. Already settled means no answer was applied: do not retry it, and stay silent unless another update needs the human.',
    parameters: {
      id: { type: 'string', required: true, description: 'Request id from the notice.' },
      allow: { type: 'boolean', description: 'Approval decision (omit for a question).' },
      answers: { type: 'string', description: 'Question answers as JSON text (omit for an approval), e.g. [{"id":"q1","selected":["Option"],"custom":"details"}]. Include every question id exactly once; selected may be empty.' },
    },
    execute: args => run(() => {
      const id = str(args, 'id') ?? ''
      const allow = (args as { allow?: unknown }).allow
      let answers = (args as { answers?: unknown }).answers
      if (typeof allow === 'boolean' && answers !== undefined) throw new DotError('dot/invalid', 'give allow or answers, not both')
      if (typeof allow === 'boolean') return dot().answer(id, { kind: 'approval', allow })
      if (typeof answers === 'string') {
        try { answers = JSON.parse(answers) } catch { throw new DotError('dot/invalid', 'answers must contain a JSON array') }
      }
      if (Array.isArray(answers)) {
        return dot().answer(id, { kind: 'question', answers: answers.map(item => {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new DotError('dot/invalid', 'each answer must be an object with a question id')
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

  // ── dot_agreement ─────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.agreement,
    description: `The human's own standing requirements, kept in their words. action=add: call only when the human explicitly asks you to remember something or states a rule; write one short line verbatim, do not reword it. action=remove: drop the one requirement the human says to drop, giving enough of its words to single it out. The [agreements] block of the running session keeps its old text until your next session.`,
    parameters: {
      action: { type: 'string', enum: ['add', 'remove'], required: true, description: 'add or remove.' },
      text: { type: 'string', required: true, description: 'add: the requirement, in the human\'s own words (one short line, at most 400 characters). remove: the requirement, or enough of its words to single it out.' },
    },
    execute: args => run(() => str(args, 'action') === 'remove' ? dot().agreementRemove(str(args, 'text') ?? '') : dot().agreementAdd(str(args, 'text') ?? '')),
    title: 'Agreement',
  }))

  // ── dot_cognition ─────────────────────────────────────────────────────────
  tool(defineToolInput({
    name: TOOL.cognition,
    description: 'Rewrite your own cognition: your understanding of the human and of how best to work with them — what you have noticed, felt and come to expect. Pass the complete new text every time (this replaces the whole block, it does not append); pass an empty string to clear it. Keep it short. It never overrides the [agreements]. The running session keeps its old text until your next session.',
    parameters: {
      text: { type: 'string', required: true, description: 'The complete new cognition text (at most 4000 characters); empty clears it.' },
    },
    execute: args => run(() => dot().cognitionRewrite(str(args, 'text') ?? '')),
    title: 'Cognition',
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

  // ── dot_settings (merged from dot_read_settings + dot_propose_settings) ──
  // Core hard-switch state is always visible in the [settings snapshot] system-prompt
  // block; call dot_settings only to read full detail or propose a change.
  const self = () => dot().selfSettings
  tool(defineToolInput({
    name: TOOL.settings,
    description: `Manage your own settings. action=read: read the full current settings, which fields the human has locked, and any change proposals waiting for approval. The core switches (scope, approvals, questions, taskPermission, reflection) are always visible in your [settings snapshot] block, so call read only when you need detail beyond those. action=propose: propose changing one unlocked setting — nothing changes until the human approves it in Settings. Fields: model, approvals, questions, scope, taskModels, taskPermission, reflection, persona, address, memory (the agreements text). value is a string containing JSON in the same shape as read: encode text as a JSON string, booleans as true/false, objects as JSON, and null to restore a clearable default. For example value=\"\\\"human\\\"\" proposes approvals=human. Locks and homeDir cannot be changed. Routine agreements use ${TOOL.agreement} and cognition uses ${TOOL.cognition}; do not propose these for an ordinary edit.`,
    parameters: {
      action: { type: 'string', enum: ['read', 'propose'], required: true, description: 'read or propose.' },
      field: { type: 'string', description: 'propose: one setting field.' },
      value: { type: 'string', description: 'propose: JSON-encoded value, e.g. "human", true, {"provider":"p","model":"m"}, or null. The outer tool argument is always a string.' },
      reason: { type: 'string', description: 'propose: why this change helps; shown to the human.' },
    },
    execute: args => run(() => {
      const action = str(args, 'action')
      if (action === 'propose') {
        let value = (args as Record<string, unknown> | null)?.value
        if (typeof value === 'string') {
          try { value = JSON.parse(value) } catch { throw new DotError('dot/invalid', 'value must be a string containing valid JSON; encode text as a JSON string') }
        }
        return self().propose({ field: str(args, 'field') ?? '', value, reason: str(args, 'reason') ?? '' })
      }
      return self().read()
    }),
    title: 'Settings',
  }), /* read is not exclusively read-only since propose mutates */ false)
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
