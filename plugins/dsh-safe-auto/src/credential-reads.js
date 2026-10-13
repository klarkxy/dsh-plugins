import { isAbsolute } from 'node:path';
import { credentialSourcePath, isCredentialPath, isStructuredCredentialText, isMutationProtectedPath } from './credential-paths.js';
import { redactCredentialText } from './credential-text.js';
import { analyzeShell, isSafeStaticExposure, shellRefusals } from './shell-command.js';

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_WINDOW_BYTES = 8 * MAX_SOURCE_BYTES;
const errorResult = code => {
  const message = `safe-auto: ${code}. Use the native read tool for non-secret file content; credentials are withheld.`;
  return { isError: true, error: { message, info: { name: 'SafeAutoError', code } }, content: [{ type: 'text', text: message }] };
};
const failure = () => { throw new Error('CREDENTIAL_READ_UNAVAILABLE'); };
const stripCR = line => line.endsWith('\r') ? line.slice(0, -1) : line;
const fresh = value => ({ isError: false, value, content: [] });
const identity = (fs, target) => `${target.targetKey ?? ''}\0${fs.processPath(target)}`;
const fsAvailable = fs => fs && ['resolve', 'stat', 'readBytes', 'processPath'].every(key => typeof fs[key] === 'function');
const textRead = exec => exec.name === 'read' || exec.name === 'str_replace_editor' && exec.arguments?.command === 'view';
const cwdOf = exec => exec.name === 'str_replace_editor' ? undefined : exec.agent?.session?.header?.cwd;

async function resolveFile(fs, path, exec, cwd = cwdOf(exec)) {
  const target = await fs.resolve(path, { cwd, signal: exec.signal });
  if (isCredentialPath(path) || isCredentialPath(fs.processPath(target))) throw new Error('CREDENTIAL_PATH');
  return { target, path, key: identity(fs, target), info: await fs.stat(target, exec.signal) };
}

async function unchanged(fs, saved, exec) {
  const next = await resolveFile(fs, saved.path, exec);
  if (saved.key !== next.key || saved.info?.version !== next.info?.version || saved.info?.type !== next.info?.type) failure();
}

async function wholeSource(fs, saved, exec) {
  const bytes = await fs.readBytes(saved.target, exec.signal, MAX_SOURCE_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_SOURCE_BYTES) failure();
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (source.includes('\0')) failure();
  const sanitized = redactCredentialText(source, fs.processPath(saved.target));
  await unchanged(fs, saved, exec);
  return { source, sanitized };
}

// Preserve the host's exact window and configured caps. A truncated native
// line is matched to its original prefix, never independently parsed as JSON.
function projectLine(raw, safe, rendered) {
  raw = stripCR(raw); safe = stripCR(safe);
  if (rendered === raw) return safe;
  const suffix = /\.\.\. \(line truncated to (\d+) chars\)$/.exec(rendered);
  const cap = suffix && Number(suffix[1]);
  if (!cap || raw.length <= cap || rendered !== raw.slice(0, cap) + suffix[0]) failure();
  return safe.slice(0, cap) + suffix[0];
}

async function windowSource(fs, saved, value, exec) {
  const name = credentialSourcePath(fs.processPath(saved.target));
  const jsonl = /\.(?:jsonl|ndjson)$/i.test(name);
  if (isStructuredCredentialText(name) && !jsonl || typeof fs.streamText !== 'function') failure();
  const wanted = new Set(value.lines.map(line => line.number));
  const selected = new Map();
  let pending = '', lineNumber = 0, bytes = 0, inPrivateKey = false;
  const consume = () => {
    lineNumber++;
    const raw = pending; pending = '';
    if (raw.includes('\0')) failure();
    if (!jsonl && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) inPrivateKey = true;
    if (wanted.has(lineNumber)) {
      bytes += Buffer.byteLength(raw);
      if (bytes > MAX_WINDOW_BYTES) failure();
      const safe = inPrivateKey ? raw.replace(/[^\s]/g, '*') : redactCredentialText(raw, jsonl ? 'session.jsonl' : name).text;
      selected.set(lineNumber, { raw, safe });
    }
    if (!jsonl && /-----END [A-Z ]*PRIVATE KEY-----/.test(raw)) inPrivateKey = false;
  };
  for await (const chunk of await fs.streamText(saved.target, exec.signal)) {
    exec.signal.throwIfAborted();
    if (typeof chunk !== 'string') failure();
    const pieces = chunk.split('\n');
    for (let i = 0; i < pieces.length; i++) {
      pending += pieces[i];
      // Complete JSONL lines are bounded independently; the overall session
      // may be arbitrarily large. A too-long selected line is withheld.
      if (pending.length > MAX_SOURCE_BYTES) {
        if (!jsonl || wanted.has(lineNumber + 1)) failure();
        pending = pending.slice(0, MAX_SOURCE_BYTES);
      }
      if (i < pieces.length - 1) consume();
    }
  }
  if (pending.length) consume();
  if (lineNumber !== value.totalLines) failure();
  await unchanged(fs, saved, exec);
  return selected;
}

async function projectRead(fs, saved, result, exec) {
  const value = result.value;
  if (!value || !Array.isArray(value.lines) || typeof value.path !== 'string' || !Number.isInteger(value.totalLines)) failure();
  let selected;
  if (saved.info.size === undefined || saved.info.size > MAX_SOURCE_BYTES) selected = await windowSource(fs, saved, value, exec);
  else {
    const { source, sanitized } = await wholeSource(fs, saved, exec);
    const raw = source.split('\n'), safe = sanitized.text.split('\n');
    const total = source ? raw.length - Number(source.endsWith('\n')) : 0;
    if (total !== value.totalLines) failure();
    selected = new Map(value.lines.map(({ number }) => [number, { raw: raw[number - 1], safe: safe[number - 1] }]));
  }
  const lines = value.lines.map(({ number, text }) => {
    const line = selected.get(number);
    if (!line || typeof line.raw !== 'string' || typeof text !== 'string') failure();
    return { number, text: projectLine(line.raw, line.safe, text) };
  });
  return fresh({ path: value.path, offset: value.offset, lines, totalLines: value.totalLines });
}

async function projectGrep(fs, result, exec) {
  if (!Array.isArray(result.value?.matches)) failure();
  const sources = new Map();
  const matches = [];
  for (const match of result.value.matches) {
    exec.signal.throwIfAborted();
    if (typeof match.path !== 'string' || !Number.isInteger(match.lineNumber) || typeof match.line !== 'string') failure();
    let lines = sources.get(match.path);
    if (!lines) {
      try {
        const saved = await resolveFile(fs, match.path, exec);
        if (saved.info?.type !== 'file' || saved.info.size > MAX_SOURCE_BYTES || sources.size >= 64) failure();
        const { source, sanitized } = await wholeSource(fs, saved, exec);
        lines = { raw: source.split('\n'), safe: sanitized.text.split('\n') };
      } catch { lines = { withheld: true }; }
      sources.set(match.path, lines);
    }
    const raw = lines.raw?.[match.lineNumber - 1];
    const coherent = typeof raw === 'string' && stripCR(raw) === match.line;
    matches.push({ path: match.path, lineNumber: match.lineNumber,
      line: !lines.withheld && coherent ? stripCR(lines.safe[match.lineNumber - 1]) : '[content withheld; use native read]' });
  }
  return fresh({ matches });
}

/** Native tool registrations and their filesystem provider are trusted host
 * components. Bind global definitions so scope shadows/replacements cannot
 * inherit the verified 0.2.0-rc.2 read/grep pipeline contract.
 * Read has no body-owned raw persistence; grep spills only in post-execute.
 * Shell jobs persist before around-return, so known secret inputs are refused
 * BEFORE their body. This is not an OS sandbox for arbitrary scripts.
 */
export function createCredentialReads(ctx, lifetimeSignal) {
  const owners = new Map();
  const owner = exec => {
    const current = ctx.tools?.get?.(exec.name);
    if (!current) return false;
    if (!owners.has(exec.name)) owners.set(exec.name, current);
    return owners.get(exec.name) === current && ctx.tools.get(exec.name, exec.agent) === current;
  };
  async function shellCheck(fs, exec) {
    const command = exec.arguments?.command;
    if (typeof command !== 'string') return;
    if (isSafeStaticExposure(analyzeShell(command))) return;
    const values = new Set([...shellRefusals(command).values,
      ...(command.match(/"[^"\r\n]+"|'[^'\r\n]+'|[^\s;&|<>]+/g) ?? []).map(value => value.replace(/^["']|["']$/g, ''))]);
    let count = 0;
    for (const path of values) {
      if (isCredentialPath(path)) throw new Error('CREDENTIAL_PATH');
      if (!isAbsolute(path) && !/^[A-Za-z]:[\\/]/.test(path)) continue;
      if (++count > 32) throw new Error('CREDENTIAL_READ_UNAVAILABLE');
      // Persistent shells may have a different cwd; only absolute operands
      // have a provable target here. Relative/opaque commands stay reviewed.
      let saved;
      try { saved = await resolveFile(fs, path, exec); }
      catch (error) { if (error.message === 'CREDENTIAL_PATH') throw error; continue; }
      if (saved.info?.type !== 'file') continue;
      try {
        const { sanitized } = await wholeSource(fs, saved, exec);
        if (sanitized.redacted) throw new Error('USE_SAFE_READ');
      } catch (error) {
        if (error.message === 'USE_SAFE_READ') throw error;
        if (isStructuredCredentialText(path)) throw new Error('USE_SAFE_READ');
      }
    }
  }
  return { async execute(exec, next) {
    if (lifetimeSignal) exec = { ...exec, signal: AbortSignal.any([exec.signal, lifetimeSignal]) };
    const fs = typeof ctx.get === 'function' ? ctx.get('fs') : ctx.fs;
    // Hosts without the FS seam still retain the lexical hard-risk policy;
    // no filesystem projection or extra exposure is claimed for custom tools.
    if (!fsAvailable(fs)) return next();
    const fileTool = textRead(exec) || ['read_image', 'write', 'edit', 'str_replace_editor'].includes(exec.name);
    const grep = exec.name === 'grep';
    const shell = ['bash', 'pwsh', 'shell'].includes(exec.name);
    if (!fileTool && !grep && !shell) return next();
    try {
      let saved;
      const path = exec.arguments?.file_path ?? exec.arguments?.path;
      if (fileTool && typeof path === 'string') {
        const cwd = ['write', 'edit'].includes(exec.name)
          ? ctx.sandboxPolicy?.resolve({ session: exec.agent?.session })?.workspaceRoot ?? cwdOf(exec)
          : cwdOf(exec);
        saved = await resolveFile(fs, path, exec, cwd);
      }
      if (saved && !textRead(exec) && exec.name !== 'read_image' && isMutationProtectedPath(fs.processPath(saved.target))) throw new Error('CREDENTIAL_PATH');
      if (grep && typeof path === 'string') await resolveFile(fs, path, exec);
      if (shell) await shellCheck(fs, exec);
      if (textRead(exec) && saved?.info?.type === 'file' || grep) {
        if (!owner(exec)) throw new Error('CREDENTIAL_READER_CHANGED');
      }
      if (textRead(exec) && exec.name === 'str_replace_editor' && saved?.info?.type === 'file') {
        const { sanitized } = await wholeSource(fs, saved, exec);
        if (sanitized.redacted) throw new Error('USE_SAFE_READ');
      }
      exec.signal.throwIfAborted();
      const result = await next();
      if (result?.isError) return result;
      exec.signal.throwIfAborted();
      if (exec.name === 'read' && saved?.info?.type === 'file') {
        if (!owner(exec)) failure();
        return await projectRead(fs, saved, result, exec);
      }
      if (grep) {
        if (!owner(exec)) failure();
        return await projectGrep(fs, result, exec);
      }
      if (exec.name === 'str_replace_editor' && textRead(exec) && saved) await unchanged(fs, saved, exec);
      return result;
    } catch (error) {
      if (exec.signal.aborted) return errorResult('CANCELLED');
      return errorResult(['CREDENTIAL_PATH', 'USE_SAFE_READ', 'CREDENTIAL_READER_CHANGED'].includes(error.message) ? error.message : 'CREDENTIAL_READ_UNAVAILABLE');
    }
  } };
}
