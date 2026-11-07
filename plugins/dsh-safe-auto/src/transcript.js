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

/**
 * The current message of an event.
 *
 * `resolve` projects the current message of an event. It returns `null` when
 * the event produces no current message: that is not a reason to read the
 * durable event again, so the entry is dropped. A projection that throws
 * fails the review closed — it never falls back to the event data, which
 * could still carry the old authorization.
 */
function derivedOf(event, resolve) {
  if (!resolve) return undefined;
  return resolve(event);
}

/** The current text of an event and whether it may still be trusted. */
function currentMessage(event, resolve) {
  const derived = derivedOf(event, resolve);
  if (derived === null) return undefined;
  const data = event?.data;
  if (derived) {
    return { content: derived.content, role: derived.role, source: derived.source };
  }
  // No projection available: the event data is the message.
  if (event?.type === 'assistant/message' || event?.type === 'tool/result') {
    return { content: data?.message?.content, role: event.type === 'assistant/message' ? 'assistant' : 'tool', source: data?.message?.source };
  }
  return { content: data?.content, role: 'user', source: data?.source };
}

/** Ordered transcript entries; `trusted` marks direct human input. */
export function transcriptEntries(events, resolve) {
  const entries = [];
  for (const event of Array.isArray(events) ? events : []) {
    const data = event?.data;
    switch (event?.type) {
      case 'user/message': {
        const message = currentMessage(event, resolve);
        if (!message) break;
        const text = blocksText(message.content);
        if (!text) break;
        // A human request stays trusted only while the current message is
        // still a human user message. A projection that rewrote the role or
        // the producer downgrades it to plain evidence.
        const human = data?.source?.kind === 'user'
          && message.role === 'user'
          && message.source?.kind === 'user';
        entries.push({ role: human ? 'user' : 'context', trusted: human, text: clip(text, human ? USER_ENTRY_CHARS : TOOL_ENTRY_CHARS) });
        break;
      }
      case 'assistant/message': {
        const message = currentMessage(event, resolve);
        if (!message) break;
        const text = blocksText(message.content);
        if (text) entries.push({ role: 'assistant', trusted: false, text: clip(text, ASSISTANT_ENTRY_CHARS) });
        break;
      }
      case 'tool/call':
        if (typeof data?.name === 'string') {
          entries.push({ role: 'tool_call', trusted: false, text: clip(`${data.name} ${typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {})}`, TOOL_ENTRY_CHARS) });
        }
        break;
      case 'tool/result': {
        const message = currentMessage(event, resolve);
        if (!message) break;
        const text = blocksText(message.content);
        if (text) entries.push({ role: 'tool_result', trusted: false, text: clip(text, TOOL_ENTRY_CHARS) });
        break;
      }
      case 'approval/decided':
        // An earlier decision about another call. It is evidence, never a
        // grant for the action under review.
        if (typeof data?.outcome === 'string') entries.push({ role: 'approval', trusted: false, text: `approval outcome: ${data.outcome} (earlier decision, not user authorization)` });
        break;
      default: break;
    }
  }
  return entries;
}

/** A surface replacement shadows the range it replaces. */
const isReplacement = event => {
  const op = event?.surfaceOp;
  return !!op && typeof op === 'object' && op.op === 'replace';
};

/** The tool call ids the current assistant messages requested. */
function currentCallIds(events) {
  const ids = new Set();
  for (const event of events) {
    if (event?.type !== 'assistant/message') continue;
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool-call' && typeof block.id === 'string' && block.id !== '') ids.add(block.id);
    }
  }
  return ids;
}

/** The tool call each approval request belongs to. */
function approvalCallIds(events) {
  const asked = new Map();
  for (const event of events) {
    if (event?.type !== 'approval/asked') continue;
    const id = event.data?.id;
    const callId = event.data?.callId;
    if (id === undefined || id === null || callId === undefined || callId === null) continue;
    asked.set(String(id), String(callId));
  }
  return asked;
}

/**
 * The events that make up the conversation as it stands now.
 *
 * The log is append-only: a message can be replaced later, and the
 * replacement shadows the range it replaces. The live surface projection
 * (`session.surface.nodes`) is the current view, so the reviewer reads the
 * messages the agent actually works with — a replaced request and the
 * assistant message it produced are not current facts any more.
 *
 * Tool calls and approval outcomes are not surface entries. They are kept
 * only while the assistant message that requested the call is still current,
 * so an abandoned turn leaves no tool history behind.
 *
 * Reading the durable event data is allowed only while the log holds no
 * replacement: with a replacement in the log, the current text comes from
 * the session's projection, and a runtime that cannot project is refused
 * instead of guessing which text is current.
 * @throws Error SESSION_SURFACE_UNAVAILABLE when the log holds a replacement
 *   and the runtime cannot project the current surface.
 */
export function currentEvents(session, derive) {
  const events = session?.snapshotEvents?.() ?? [];
  const replaced = events.some(isReplacement);
  const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : undefined;
  if (!nodes) {
    if (replaced) throw new Error('SESSION_SURFACE_UNAVAILABLE');
    return events;
  }
  if (replaced && typeof derive !== 'function') throw new Error('SESSION_SURFACE_UNAVAILABLE');
  const bySeq = new Map();
  for (const event of events) bySeq.set(event?.seq, event);
  const current = [];
  for (const seq of nodes) {
    const event = bySeq.get(seq);
    if (event) current.push(event);
  }
  const callIds = currentCallIds(current);
  const asked = approvalCallIds(events);
  const related = [];
  for (const event of events) {
    if (event?.type === 'tool/call') {
      if (callIds.has(String(event.data?.callId ?? ''))) related.push(event);
    } else if (event?.type === 'approval/decided') {
      const callId = asked.get(String(event.data?.id ?? ''));
      if (callId !== undefined && callIds.has(callId)) related.push(event);
    }
  }
  return [...current, ...related].sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0));
}

/**
 * Select entries newest-first within the byte budget. User messages get their
 * own share so a long tool log cannot push the task out; the first user
 * message is kept when possible because it usually states the task.
 * @param {readonly object[]} events - session log events.
 * @param {number} maxBytes - total budget for the rendered transcript.
 * @param {(event: object) => {content?: readonly object[]} | undefined} [resolve]
 *   projects the current message of an event, when the session can derive it.
 * @returns {string} transcript text with `<truncated />` markers for gaps.
 */
export function buildTranscript(events, maxBytes, resolve) {
  const entries = transcriptEntries(events, resolve);
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
