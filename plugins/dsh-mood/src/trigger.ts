export type TriggerKind = 'skip' | 'clear' | 'mild' | 'material' | 'risk'
export type MoodMode = 'auto' | 'manual' | 'strict'

const ACK = /^(好的?|嗯+|行|ok|okay|收到|谢谢|thanks)$/i
const CONTINUE = /^(继续|接着(?:做|写|改)?|go on|continue)$/i
const DELEGATE = /^(你决定|都行|无所谓|看着办|按你的建议来|按你的建议(?:做|来做)|you decide|use your judgment)$/i
const VAGUE = /帮我(?:看|改|写|弄)?一下|改一下|写一下|处理一下|优化一下|弄好|随便|看情况|或者就|怎么写都行|帮我改改|改改/
const RISK = /删除全部|全部删除|清空(?:全书|所有|全部)?|覆盖原文|覆盖所有|重写全|全部重写|并发布|发布到|永久删除|替换所有/
const PATH = /\.[A-Za-z][A-Za-z0-9]{0,7}\b|第[一二三四五六七八九十百0-9]+章|[A-Za-z]:\\|\//
const BOUND = /不超过|不少于|至少|最多|保持|不要|仅|只|必须|字以内|<=|≥|\d+\s*(?:字|句|段|行)/
const NAMED = /[\u4e00-\u9fff]{2,6}(?:的)?(?:对白|对话|语气|出场)|“[^”]{2,40}”/
const EXPLAIN = /解释什么是|^什么是|explain\s+what/i
const TRANSLATE = /翻译成|译成|translate\s+.+\s+into/i
const LOCAL_EDIT = /把第[一二三四五六七八九十百0-9]+[行句段]|修正拼写|重命名为|把错字|typo/i

export function isContinuationRequest(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim().replace(/[。.!！]+$/, '')
  return ACK.test(trimmed) || CONTINUE.test(trimmed) || DELEGATE.test(trimmed)
}

/** Legacy diagnostic labels, not permission or clarification gates. */
export function classifyRequest(text: string, _options: { hasConfirmedContract?: boolean } = {}): TriggerKind {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed || isContinuationRequest(trimmed)) return 'skip'
  if (RISK.test(trimmed)) return 'risk'
  if (EXPLAIN.test(trimmed) || TRANSLATE.test(trimmed) || LOCAL_EDIT.test(trimmed)) return 'clear'
  if (VAGUE.test(trimmed)) return 'material'
  const specific = PATH.test(trimmed) || NAMED.test(trimmed)
  const bounded = BOUND.test(trimmed)
  if (specific && bounded && trimmed.length >= 16) return 'clear'
  if (specific || bounded) return 'mild'
  return 'clear'
}

/** Model analysis is explicit opt-in, regardless of old persisted mode names. */
export function shouldAnalyze(_kind: TriggerKind, _mode: MoodMode, pendingManual: boolean): boolean {
  return pendingManual
}

export function shouldWriteClearContract(_kind: TriggerKind, _pendingManual: boolean, _mode: MoodMode = 'auto'): boolean {
  return false
}

/** Kept only for interpreting legacy answers. The service never uses this to block a step. */
export function isBlockingKind(kind: TriggerKind): boolean {
  return kind === 'material' || kind === 'risk'
}
