import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli } from '@klarkxy/dsh-plugin-kit/cli-process'
import { GrokBuildError } from './contracts.ts'

export type GuardPolicy = { tool: string; inputs: string[]; sessionId: string; media: boolean; nativeInput?: Record<string, unknown> }
export function guardInputMatches(policy: GuardPolicy, input: Record<string, unknown>): boolean {
  const keys = ['image', 'images', 'first_frame', 'last_frame', 'keyframes', 'voices', 'duration', 'resolution_name', 'aspect_ratio']
  const expected = policy.nativeInput ?? (policy.tool === 'image_to_video' ? { image: policy.inputs[0] } : policy.tool === 'reference_to_video' ? { images: policy.inputs } : policy.tool === 'image_edit' ? { image: policy.inputs } : {})
  function equal(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]))
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const left = Object.keys(a).sort(), right = Object.keys(b).sort()
      return equal(left, right) && left.every(key => equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
    }
    return false
  }
  const defaults: Record<string, unknown> = { images: [], keyframes: [], voices: [], duration: 6, resolution_name: '480p', aspect_ratio: policy.tool === 'reference_to_video' ? '16:9' : 'auto' }
  return keys.every(key => equal(input[key] ?? defaults[key], (expected as Record<string, unknown>)[key] ?? defaults[key]))
}
/** Native PreToolUse is defense in depth: the vendor dispatcher fails open on runner errors. */
export function guardScript(policy: GuardPolicy, marker: string): string {
  return `'use strict';
const fs = require('node:fs');
const policy = ${JSON.stringify(policy)};
const inputMatches = (${guardInputMatches.toString()});
const marker = ${JSON.stringify(marker)};
let data = '', done = false;
function finish(allow) {
  if (done) return; done = true; clearTimeout(timer);
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:allow?'allow':'deny',permissionDecisionReason:allow?'Explicit plugin inputs verified.':'Only the staged plugin inputs and one media call are allowed.'}}));
}
const timer = setTimeout(() => { finish(false); process.stdin.destroy(); }, 2000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { data += chunk; if (data.length > 1000000) { finish(false); process.stdin.destroy(); } });
process.stdin.on('error', () => finish(false));
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(data), input = e.toolInput;
    if (e.hookEventName !== 'pre_tool_use' || e.sessionId !== policy.sessionId || e.toolName !== policy.tool || e.toolInputTruncated || !input || typeof input !== 'object' || Array.isArray(input)) return finish(false);
    if (!inputMatches(policy, input)) return finish(false);
    if (policy.media) fs.writeFileSync(marker, 'verified', {flag:'wx',mode:0o600});
    finish(true);
  } catch { finish(false); }
});
`
}
export async function prepareGuard(home: string, policy: GuardPolicy, signal: AbortSignal): Promise<{ config: string; marker: string; hookPath: string }> {
  const path = join(home, 'input-guard.cjs'), marker = join(home, 'input-guard.used')
  await writeFile(path, guardScript(policy, marker), { flag: 'wx', mode: 0o600 })
  // Prove this runtime can execute the guard and rejects a malformed request before paid work.
  const command = process.platform === 'win32' ? `& '${process.execPath.replace(/'/g, "''")}' '${path.replace(/'/g, "''")}'` : `'${process.execPath.replace(/'/g, "'\\''")}' '${path.replace(/'/g, "'\\''")}'`
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh'
  const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command]
  const probe = await runCli({ command: shell, displayPath: shell }, args, { cwd: home, signal, timeoutMs: 5_000, input: '{}' })
  let denial: unknown
  try { denial = JSON.parse(probe.stdout) } catch { /* rejected below */ }
  if (probe.exitCode !== 0 || (denial as { hookSpecificOutput?: { permissionDecision?: string } })?.hookSpecificOutput?.permissionDecision !== 'deny') throw new GrokBuildError('incompatible', '无法执行原生媒体输入检查。')
  // Grok executes this configured command through its native hook runner.
  // 1.0.50 discovers GROK_HOME/hooks/*.json; config.toml hooks are not supported by that installed version.
  const hookDirectory = join(home, 'hooks'), hookPath = join(hookDirectory, 'input-guard.json')
  await mkdir(hookDirectory, { recursive: true })
  await writeFile(hookPath, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command, timeout: 5 }] }] } }), { flag: 'wx', mode: 0o600 })
  return { config: '', marker, hookPath }
}
