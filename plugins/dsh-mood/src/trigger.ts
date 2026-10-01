/** A plain acknowledgement keeps the existing task; other meaning is judged by the Agent. */
export function isContinuationRequest(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim().replace(/[。.!！]+$/, '')
  return /^(好的?|嗯+|行|ok|okay|收到|谢谢|thanks|继续|接着(?:做|写|改)?|go on|continue|你决定|都行|无所谓|看着办|按你的建议来|按你的建议(?:做|来做)|you decide|use your judgment)$/i.test(trimmed)
}
