/**
 * Compact review transcript built from the session log.
 *
 * Like Codex Guardian (`core/src/guardian/prompt.rs`, openai/codex,
 * Apache-2.0), the reviewer sees what the user asked and what the agent has
 * done, within a byte budget. Over-budget history is truncated with an
 * explicit marker instead of invalidating the review. Only direct human
 * messages are labeled trusted; everything else is evidence.
 */

const USER_ENTRY_CHARS = 4000;
const ASSISTANT_ENTRY_CHARS = 1200;
const TOOL_ENTRY_CHARS = 800;
const USER_SHARE = 0.6;
// Hygiene only: obvious token formats are masked before they leave the session.
const TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g;

export const redact = text => text.replace(TOKEN, '[redacted-token]');

function clip(text, limit) {
  const clean = redact(text);
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}<truncated chars="${clean.length - limit}" />`;
}

function blocksText(blocks) {
  if (!Array.isArray(blocks)) return typeof blocks === 'string' ? blocks : '';
  return blocks.map(block => {
    if (block?.type === 'text' && typeof block.text === 'string') return block.text;
    if (block?.type === 'image') return '[image]';
    if (block?.type === 'file') return '[file]';
    return '';
  }).filter(Boolean).join('\n');
}

/** Ordered transcript entries; `trusted` marks direct human input. */
export function transcriptEntries(events) {
  const entries = [];
  for (const event of Array.isArray(events) ? events : []) {
    const data = event?.data;
    switch (event?.type) {
      case 'user/message': {
        const text = blocksText(data?.content);
        if (!text) break;
        const human = data?.source?.kind === 'user';
        entries.push({ role: human ? 'user' : 'context', trusted: human, text: clip(text, human ? USER_ENTRY_CHARS : TOOL_ENTRY_CHARS) });
        break;
      }
      case 'assistant/message': {
        const text = blocksText(data?.message?.content);
        if (text) entries.push({ role: 'assistant', trusted: false, text: clip(text, ASSISTANT_ENTRY_CHARS) });
        break;
      }
      case 'tool/call':
        if (typeof data?.name === 'string') {
          entries.push({ role: 'tool_call', trusted: false, text: clip(`${data.name} ${typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {})}`, TOOL_ENTRY_CHARS) });
        }
        break;
      case 'tool/result': {
        const text = blocksText(data?.message?.content);
        if (text) entries.push({ role: 'tool_result', trusted: false, text: clip(text, TOOL_ENTRY_CHARS) });
        break;
      }
      case 'approval/decided':
        if (typeof data?.outcome === 'string') entries.push({ role: 'approval', trusted: false, text: `approval outcome: ${data.outcome}` });
        break;
      default: break;
    }
  }
  return entries;
}

/**
 * Select entries newest-first within the byte budget. User messages get their
 * own share so a long tool log cannot push the task out; the first user
 * message is kept when possible because it usually states the task.
 * @param {readonly object[]} events - session log events.
 * @param {number} maxBytes - total budget for the rendered transcript.
 * @returns {string} transcript text with `<truncated />` markers for gaps.
 */
export function buildTranscript(events, maxBytes) {
  const entries = transcriptEntries(events);
  const size = entry => Buffer.byteLength(entry.text) + 24;
  const keep = new Set();
  let userBudget = Math.floor(maxBytes * USER_SHARE);
  const users = entries.map((entry, index) => [entry, index]).filter(([entry]) => entry.trusted);
  const first = users[0];
  if (first && size(first[0]) <= userBudget) { keep.add(first[1]); userBudget -= size(first[0]); }
  for (const [entry, index] of users.slice(1).reverse()) {
    if (size(entry) > userBudget) break;
    keep.add(index); userBudget -= size(entry);
  }
  let otherBudget = maxBytes - Math.floor(maxBytes * USER_SHARE) + userBudget;
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].trusted) continue;
    if (size(entries[index]) > otherBudget) break;
    keep.add(index); otherBudget -= size(entries[index]);
  }
  const lines = [];
  let omitted = 0;
  entries.forEach((entry, index) => {
    if (!keep.has(index)) { omitted++; return; }
    if (omitted) { lines.push(`<truncated entries="${omitted}" />`); omitted = 0; }
    lines.push(`[${entry.role}${entry.trusted ? ' (trusted)' : ''}] ${entry.text}`);
  });
  if (omitted) lines.push(`<truncated entries="${omitted}" />`);
  return lines.join('\n');
}
