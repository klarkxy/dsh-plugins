import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { toolRequestSchema } from './schema.ts'
import { coded, type MoodService } from './service.ts'

export function createRequirementsTool(service: MoodService): ToolDefinition {
  const lists = Object.fromEntries(['deliverables', 'inScope', 'outOfScope', 'constraints', 'acceptance', 'assumptions', 'questions']
    .map(key => [key, { type: 'array' as const, items: { type: 'string' as const } }]))
  return {
    name: 'mood_requirements',
    description: 'Read or record the current session request. For a new substantive task, read first, then record one concise summary of your current instructions, conversation and latest user request before working. Reuse it across tool continuations; update it when the user corrects or changes requirements. read returns revision and sourceVersion; record echoes both as expectedRevision and sourceVersion. requirements holds goal, deliverables, inScope, outOfScope, constraints, acceptance, assumptions and questions; omit empty lists and keep assumptions apart from explicit requirements. This is your interpretation, not human confirmation or permission. No model is called or selected. Store no private reasoning, invented requirements or credentials. Necessary clarification stays with the main Agent.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: {
        action: { type: 'string', enum: ['read', 'record'] },
        expectedRevision: { type: 'integer' }, sourceVersion: { type: 'string' },
        requirements: { type: 'object', additionalProperties: false, required: ['goal'], properties: { goal: { type: 'string' }, ...lists } },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const sessionId = exec.agent?.session?.id
      if (!sessionId) coded('MOOD_SESSION_NOT_FOUND', 'mood_requirements needs the current Agent session.')
      const parsed = toolRequestSchema.safeParse(args)
      if (!parsed.success) coded('MOOD_INVALID', 'Use action read, or record with expectedRevision, sourceVersion and requirements; no session or model override.')
      return parsed.data.action === 'read'
        ? service.read(String(sessionId))
        : service.record(String(sessionId), parsed.data, exec.signal)
    },
  }
}
