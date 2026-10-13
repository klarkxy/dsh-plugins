import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { projectConversation, type ConversationView, type ModelSurfaceRow, type ConversationItem } from './conversation.ts'
import { projectTurns } from './turns.ts'

export function projectDetails(events: readonly SessionEvent[], sessionId: string, inherited: number,
  includeTools: boolean, includeReasoning: boolean, view: ConversationView,
  modelRows?: readonly ModelSurfaceRow[], modelKnown = true,
) {
  const projection = projectConversation(events, inherited, includeTools, includeReasoning, view, modelRows, modelKnown)
  const owners = new Map(projectTurns(events, sessionId, inherited).flatMap(turn => turn.eventSeqs.map(seq => [seq, turn.turnId] as const)))
  const eventTypes = new Map<number, string>(events.map(event => [event.seq, event.type]))
  const items: ConversationItem[] = [...projection.items]
  if (view === 'transcript' && includeTools) for (const event of events) {
    if (event.type !== 'tool/call') continue
    items.push({ seq: event.seq, role: 'tool', text: event.data.arguments, toolName: event.data.name,
      toolCalls: [{ name: event.data.name, callId: event.data.callId }],
      truncated: false, inherited: event.seq < inherited, eventType: event.type })
  }
  return { ...projection, items: items.sort((a, b) => a.seq - b.seq).map(item => ({ ...item,
    eventType: item.eventType ?? eventTypes.get(item.seq),
    reference: { sessionId, seq: item.seq, turnId: owners.get(item.seq) ?? `legacy:${item.seq}` },
  })) }
}
