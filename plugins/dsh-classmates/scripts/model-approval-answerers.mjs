// Exercise the installed native approval service with the existing Safe Auto hook.
// The session log is a local fixture; no model or network requests are made.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import * as safeAuto from '../../dsh-safe-auto/src/index.js';

const requireTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'));
const { ApprovalService } = await import(pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-user-approval')).href);
class SandboxPolicy extends Service {
  constructor(ctx) { super(ctx, 'sandboxPolicy'); }
  resolve() { return { mode: 'workspace-write', workspaceRoot: process.cwd() }; }
}
const checks = [];
for (const mode of ['smart', 'unattended']) {
  for (const humanOutcome of ['allowed-once', 'rejected', 'unavailable']) {
    const ctx = new Context();
    try {
      await ctx.plugin(Prompt, {});
      await ctx.plugin(Tools);
      await ctx.plugin(SandboxPolicy);
      await ctx.plugin(ApprovalService, { policy: 'ask' });
      await ctx.plugin(safeAuto, { mode, workspaceRoots: [process.cwd()] });
      let humanCalls = 0;
      ctx.on('approval/request', async () => { humanCalls++; return humanOutcome; });
      const events = [{ type: 'turn/start', data: {} }];
      const agent = { id: 'model-approval-proof', ctx, session: {
        get seq() { return events.length; },
        eventAt(seq) { return events[seq]; },
        append(type, data) { events.push({ type, data }); },
      } };
      const outcome = await ctx.approval.request({ agent, toolName: 'subagent_reviewer',
        callId: 'model-proof', reason: 'classmates:model-approval: fixture/review-model',
        signal: new AbortController().signal });
      assert.equal(outcome, mode === 'smart' ? humanOutcome : 'rejected');
      assert.equal(humanCalls, mode === 'smart' ? 1 : 0);
      assert.equal(events.at(-2).type, 'approval/asked');
      assert.equal(events.at(-1).type, 'approval/decided');
      assert.equal(events.at(-1).data.outcome, outcome);
      checks.push({ mode, downstream: humanOutcome, outcome, downstreamCalls: humanCalls });
    } finally { await ctx.fiber.dispose(); }
  }
}
console.log(JSON.stringify({ checks, modelRequests: 0 }, null, 2));
