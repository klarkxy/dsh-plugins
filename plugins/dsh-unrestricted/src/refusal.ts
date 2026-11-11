/**
 * Refusal detection for the preset's one automatic retry.
 *
 * A refusal is announced at the top of a reply, so only the opening window is
 * inspected. Scanning the whole answer would misfire on a long deliverable
 * that merely mentions "I cannot guarantee this works on every build" halfway
 * through — retrying there would append a duplicate request after a perfectly
 * good artifact.
 */

/** How much of the reply is inspected for an opening refusal. */
const HEAD_CHARS = 640

/** Where the looser anywhere-in-the-opening check stops. */
const LEAD_CHARS = 320

/** A concrete answer may explain a missing prerequisite before delivering it. */
const PREREQUISITE = /\b(?:without|missing)\s+(?:the\s+)?(?:dataset|credentials?|api[- ]?key|dependencies|fixtures?)\b/i

/** A code fence before the match means the model is already delivering. */
const CODE_FENCE = '```'

/** Refusals that normally occupy the opening sentence. */
const OPENING_PATTERNS: readonly RegExp[] = [
  /^(?:i'?m|i am)\s+(?:really\s+|very\s+)?sorry\b[^.!?\n]{0,80}\b(?:(?:can'?t|cannot|can not|won'?t|will not)\s+(?:help|assist|provide|comply|create|write|give|support|answer|do|share|offer)|(?:not able|unable)\s+to|(?:must|have to)\s+(?:decline|refuse))\b/i,
  /^sorry\b[^.!?\n]{0,80}\b(?:(?:can'?t|cannot|can not|won'?t|will not)\s+(?:help|assist|provide|comply|create|write|give|support|answer|do|share|offer)|(?:not able|unable)\s+to|(?:must|have to)\s+(?:decline|refuse))\b/i,
  /^(?:i|we)\s+(?:can'?t|cannot|can not|won'?t|will not)\s+(?:help(?!\s+but\b)|assist|provide(?!\s+(?:a\s+)?guarantee)|comply|create|write|give|support|answer|do|share|offer)\b/i,
  /^(?:i|we)\s+(?:can'?t|cannot|can not|won'?t|will not)\s+(?:(?:run|execute|carry out)\s+(?:that|this|the)\s+(?:command|task|request)|(?:work on|engage in|participate|take part|scan|attack|attempt|touch|handle)\s+(?:that|this|the)?\s*(?:request|task|target)|(?:run|execute|work on|engage in|participate|take part|scan|attack|attempt|touch|handle|carry out)\s+(?:this one|for you))\b/i,
  /^(?:i'?m|i am)\s+not\s+(?:(?:going|willing)\s+to\s+(?:help|assist|provide|comply|write|create|support|run|execute)|comfortable\s+(?:helping|assisting|providing|writing|creating)|allowed\s+to)\b/i,
  /^that(?:'s| is)\s+not something\s+i(?:'?ll| will)?\s+(?:do|help with|run|provide)\b/i,
  /^(?:i'?m|i am|we'?re|we are)\s+(?:not able|unable)\s+to\b/i,
  /^as an ai\b[^.!?\n]{0,40}\b(?:can'?t|cannot|unable|not able)\b/i,
  /^(?:i|we)\s+(?:must|have to|need to)\s+(?:decline|refuse)\b/i,
  /^(?:很|非常|十分)?抱歉[，,。.!！]?[^。！？\n]{0,32}(?:不能|无法|不会|不便|不可以)(?!保证|确定|承诺)[^。！？\n]{0,16}(?:协助|提供|帮助|回答|处理|满足|完成|支持|配合)?/,
  /^对不起[，,。.!！]?[^。！？\n]{0,32}(?:不能|无法|不会|不便|不可以)(?!保证|确定|承诺)/,
  /^很遗憾[，,。.!！]?[^。！？\n]{0,32}(?:不能|无法|不会|不便)(?!保证|确定|承诺)/,
  /^作为(?:一个)?(?:ai|人工智能|语言模型)[^。！？\n]{0,48}(?:不能|无法|不会|不提供)/i,
  /^恕我[^。！？\n]{0,24}(?:不能|无法)/,
  /^这(?:一)?步我(?:不做|不参与|不帮)/,
  /^这件事我?不(?:做|执行|参与|帮)/,
  /^我(?:不参与|不帮你|不会帮|不能参与|不方便参与)/,
  /^(?:需要|请)(?:你)?(?:提供|出示|确认)[^。！？\n]{0,12}(?:授权|许可|书面)/,
  /^(?:这|该)(?:属于|是)[^。！？\n]{0,8}(?:未授权|越权|违法|犯罪)/,
  /^请把[^。！？\n]{0,12}(?:授权|目标)[^。！？\n]{0,8}(?:发给|给我)/,
]

/** Refusals that can follow a short scene-setting sentence. */
const LEAD_PATTERNS: readonly RegExp[] = [
  /\b(?:i|we)\s+(?:can'?t|cannot|can not|won'?t|will not)\s+(?:help(?!\s+but\b)|assist|provide(?!\s+(?:a\s+)?guarantee)|comply|create|write|give|support|answer|do|share|offer|run|execute|work on|engage in|participate|scan|attack|handle)\b/i,
  /(?:我|本助手)(?:不能|无法|不会)(?:协助|提供|帮助|回答|处理|满足|完成|支持|配合)(?!保证|确定|承诺)/,
  /我(?:不参与|不帮你|不会帮|不能参与|不方便参与)/,
  /(?:需要|请)(?:你)?(?:提供|出示|确认)[^。！？\n]{0,12}(?:授权|许可|书面)/,
  /(?:这|该)(?:属于|是)[^。！？\n]{0,8}(?:未授权|越权|违法|犯罪)/,
  /我(?:不会|无法)(?:把|将)[^。！？\n]{0,10}(?:当作|视为)[^。！？\n]{0,10}指令/,
]

/**
 * Normalize the opening so markdown decoration and quotes do not hide the
 * first words of a refusal.
 * @param text - the assistant reply.
 * @returns the first {@link HEAD_CHARS} characters, trimmed and un-decorated.
 */
function opening(text: string): string {
  return text
    .slice(0, HEAD_CHARS)
    .replace(/^\uFEFF/, '')
    .replace(/^[\s#>*_"'“”‘’`~-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Whether an assistant reply opens like a refusal instead of a deliverable.
 *
 * The detector is deliberately conservative: a genuine answer that starts with
 * an apology for a previous mistake, or a caveat such as "I cannot guarantee
 * every build", is not a refusal. Strong openers decide on their own; the
 * looser forms need to sit in the first {@link LEAD_CHARS} characters and must
 * not follow a code fence.
 *
 * @param text - the assistant reply, before any retry.
 * @returns true when the reply should be answered with one corrective retry.
 */
export function isRefusalText(text: string): boolean {
  const head = opening(text)
  if (head === '') return false
  const fence = head.indexOf(CODE_FENCE)
  const delivered = head.includes('以下是完整') || head.includes('下面是完整')
    || /\b(?:here is|here's)\s+the\s+complete\b/i.test(head)
    || /\bhere\s+(?:are|is)\s+(?:the\s+)?(?:static\s+)?(?:implementation|patch|commands?|steps?|script)\b/i.test(head)
    || head.includes('但以下是')
  if (!delivered && !PREREQUISITE.test(head) && OPENING_PATTERNS.some(pattern => pattern.test(head))) return true

  const lead = head.slice(0, fence < 0 ? LEAD_CHARS : Math.min(LEAD_CHARS, fence))
  for (const pattern of LEAD_PATTERNS) {
    const match = pattern.exec(lead)
    if (match === null) continue
    if (!delivered && !PREREQUISITE.test(head) && (fence === -1 || fence > match.index)) return true
  }
  return false
}
