import type { EvidenceRef, TaskContract } from './contracts.ts'
import { MAX_QUESTIONS } from './contracts.ts'
import type { TriggerKind } from './trigger.ts'

export interface AnalysisDraft {
  goal: string
  deliverables: string[]
  inScope: string[]
  outOfScope: string[]
  constraints: string[]
  acceptance: string[]
  assumptions: string[]
  questions: string[]
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asList(value: unknown, max = 16): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const entry of value) {
    const text = asString(entry)
    if (!text) continue
    items.push(text.slice(0, 400))
    if (items.length >= max) break
  }
  return items
}

export function parseAnalysis(text: string): AnalysisDraft | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fence?.[1]?.trim() ?? trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const row = parsed as Record<string, unknown>
    return {
      goal: asString(row.goal).slice(0, 2000),
      deliverables: asList(row.deliverables), inScope: asList(row.inScope), outOfScope: asList(row.outOfScope),
      constraints: asList(row.constraints), acceptance: asList(row.acceptance), assumptions: asList(row.assumptions),
      questions: asList(row.questions, MAX_QUESTIONS),
    }
  } catch { return undefined }
}

/** Empty means no question. Never turn a classifier label into a fabricated question. */
export function boundQuestions(questions: readonly string[], _kind: TriggerKind): string[] {
  return [...new Set(questions.map(question => question.trim().slice(0, 400)).filter(Boolean))].slice(0, MAX_QUESTIONS)
}

export const ANALYZE_SYSTEM = [
  '用户主动要求梳理任务。根据给定的真实用户原文和上下文生成可选需求摘要，不是执行审批。',
  '不要编造文件、人物、数量或验收条件；引用已有回答，不重复询问已经给出的信息。',
  '能调查解决的细节、低风险且可调整的默认选择，归入 assumptions，不向用户索取确认。',
  '只有答案会实质改变结果、无法从现有资料或获准工具获取、且没有合理默认值或可先推进的部分时，才列入 questions。',
  '“继续”“你决定”表示在已有任务范围内推进，不构成新的澄清理由。未回答不等于同意。',
  '不要把需求摘要写成文件修改或发布授权。',
  '返回一个 JSON 对象，不要 Markdown。',
  '键：goal, deliverables, inScope, outOfScope, constraints, acceptance, assumptions, questions。',
  `questions 最多 ${MAX_QUESTIONS} 条；没有真正阻塞项时必须为空数组，不为格式凑问题。`,
].join('\n')

export function thinContract(input: {
  id: string
  sessionId: string
  sourceVersion: string
  revision: number
  goal: string
  evidence: EvidenceRef[]
  readiness: TaskContract['readiness']
  now: number
  extra?: Partial<Pick<TaskContract, 'deliverables' | 'inScope' | 'outOfScope' | 'constraints' | 'acceptance' | 'assumptions' | 'questions'>>
}): TaskContract {
  return {
    id: input.id, sessionId: input.sessionId, sourceVersion: input.sourceVersion, revision: input.revision,
    goal: input.goal.slice(0, 2000), deliverables: input.extra?.deliverables ?? [],
    inScope: input.extra?.inScope ?? [], outOfScope: input.extra?.outOfScope ?? [],
    constraints: input.extra?.constraints ?? [], acceptance: input.extra?.acceptance ?? [],
    assumptions: input.extra?.assumptions ?? [], questions: input.extra?.questions ?? [],
    evidence: input.evidence, readiness: input.readiness, updatedAt: input.now,
  }
}

export function contractFromDraft(input: {
  id: string
  sessionId: string
  sourceVersion: string
  revision: number
  goalFallback: string
  evidence: EvidenceRef[]
  draft: AnalysisDraft | undefined
  questions: string[]
  readiness: TaskContract['readiness']
  now: number
}): TaskContract {
  return thinContract({
    ...input, goal: input.draft?.goal || input.goalFallback,
    extra: { ...input.draft, questions: input.questions },
  })
}

export const analyzePurpose = {
  id: 'mood.analyze', label: '手动需求梳理',
  defaultTarget: { kind: 'role' as const, role: 'normal' as const },
  maxOutputTokens: 1024, timeoutMs: 60_000,
}
