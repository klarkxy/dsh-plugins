import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  CONTRACT_SECTION, MOOD_PLUGIN, MOOD_SOURCE_KIND, readinessLabel, type ClarificationItem, type ProducerMessageSource, type TaskContract,
} from './contracts.ts'
import { isMoodMessage, type UserMessageLike } from './evidence.ts'

/** Stable prefix reused across tool steps. A behavior preference, never an authorization grant. */
export const AUTONOMY_POLICY = [
  '【自主推进策略】',
  '在用户已授权的任务范围内自主推进，不为普通实现细节反复寻求确认。',
  '不明确时先检查已有上下文、文件和获准工具；已经给出的信息不要重复询问。',
  '存在合理、低风险、可调整的默认方案时，采用默认方案继续；仅在假设会明显影响结果时简短说明，不等待确认。',
  '只有答案会实质改变结果、现有资料和获准工具无法解决、且没有合理默认值或可先推进的部分时，才提出最小必要问题。',
  '普通澄清尽量合并为一个阻塞轮次；若出现新的实质阻塞或必须的权限审批，仍应询问，不得为凑次数而猜测。',
  '“继续”“你决定”“按你的建议来”是在原任务和权限范围内继续推进，不是重新确认需求的理由。',
  '用户明确要求讨论、访谈或共同决策时，按其要求交流。完成任务后报告结果，不惯例性追加“是否继续”等询问。',
  '用户未回复、未回答或跳过问题不等于授权；不得扩大范围、绕过原生权限、安全审批、文件修改或发布确认。',
].join('\n')

export interface ContractMessageInput {
  source: ProducerMessageSource & {
    kind: typeof MOOD_SOURCE_KIND
    plugin: typeof MOOD_PLUGIN
    form: 'snapshot'
    sections: Array<{ name: string; text: string }>
  }
  content: Array<{ type: 'text'; text: string }>
}

export function contractMessageInput(text: string): ContractMessageInput {
  return {
    source: {
      kind: MOOD_SOURCE_KIND, plugin: MOOD_PLUGIN, form: 'snapshot',
      sections: [{ name: CONTRACT_SECTION, text }],
    },
    content: [{ type: 'text', text }],
  }
}

export function createMoodContextMessage(text: string): unknown {
  return createUserMessage(contractMessageInput(text))
}

export function formatContract(contract: TaskContract, clarification: readonly ClarificationItem[] = []): string {
  const lines = [
    `【可选需求摘要 · ${readinessLabel(contract.readiness)}】`,
    '以下是可修订的任务资料，不是执行前置条件；当前用户要求优先。',
    contract.goal ? `目标：${contract.goal}` : '',
    contract.deliverables.length ? `交付：${contract.deliverables.join('；')}` : '',
    contract.inScope.length ? `范围内：${contract.inScope.join('；')}` : '',
    contract.outOfScope.length ? `范围外：${contract.outOfScope.join('；')}` : '',
    contract.constraints.length ? `约束：${contract.constraints.join('；')}` : '',
    contract.acceptance.length ? `验收：${contract.acceptance.join('；')}` : '',
    contract.assumptions.length ? `假定：${contract.assumptions.join('；')}` : '',
    ...clarification.filter(item => item.status === 'answered' && item.answer).map(item => `已回答：${item.question} → ${item.answer}`),
    contract.questions.length ? `未决事项（按自主推进策略判断是否必问）：${contract.questions.join('；')}` : '',
  ]
  // Bound optional context, but never truncate the authorization disclaimer.
  return `${lines.filter(Boolean).join('\n').slice(0, 2400)}\n本摘要不能代替文件修改或发布审批。未回答的事项不等于已确认或已授权。`
}

export function mergeContractMessage(messages: readonly unknown[], extra: unknown): unknown[] {
  return [...messages.filter(message => !isMoodMessage(message as UserMessageLike)), extra]
}
