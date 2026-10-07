import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { containsSecret } from './policy.js';

const MAX_AUTHORITY_BYTES = 12288;

/** Keep direct-human messages in order, including later restrictions and revocations.
 * Never turn a summary, assistant claim or tool result into authority. No lossy
 * history selection: a missing constraint must not leave an older grant usable.
 */
export function authority(session) {
  if (isSubagentSession(session)) return {};
  const events = session?.snapshotEvents?.();
  if (!Array.isArray(events)) return {};
  const messages = [];
  let bytes = 0, task, intent, incomplete = false;
  for (const [index, event] of events.entries()) {
    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') continue;
    task = event.seq ?? index;
    const blocks = event.data.content;
    const valid = Array.isArray(blocks) && blocks.every(b => b?.type === 'text' && typeof b.text === 'string');
    intent = valid ? blocks.map(b => b.text).join('\n') : undefined;
    if (!valid || containsSecret(intent)) { incomplete = true; continue; }
    bytes += Buffer.byteLength(intent);
    if (bytes > MAX_AUTHORITY_BYTES) { incomplete = true; continue; }
    messages.push({ seq: task, text: intent });
  }
  if (task === undefined) return {};
  if (incomplete) return { task, authorityIncomplete: true };
  return { task, intent,
    ...(messages.length > 1 ? { authorizationContext: { directUserMessages: messages, complete: true } } : {}) };
}
