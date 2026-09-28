import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import type { SpawnTeammateResult } from '@deepseek-ai/dsh-experimental-agent-team';
import { ReasoningEffortId, type ContentBlock, type GenerateOptions } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SubagentService from '@deepseek-ai/dsh-subagent';
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import TeamService from '@deepseek-ai/dsh-experimental-agent-team';
import { BindingStore } from '../../src/bindings.js';
import { PROVIDER, type ClassmateDefinition, type ModelProfile } from '../../src/contracts.js';
import { installNative } from '../../src/native.js';
import { CaptureAdapter } from './capture-adapter.js';
import { TestSessionQuery } from './test-session-query.js';

export const SIGNAL = new AbortController().signal;
export const PROFILE_ID = 'p0-profile';

export const REASONING = {
  efforts: [
    { id: ReasoningEffortId('low'), name: 'Low' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
};

export const ALLOWED_MODELS = new Set(['mock', 'specialist-a', 'specialist-b']);

export function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }];
}

export function role(partial: Omit<ClassmateDefinition, 'schemaVersion' | 'enabled'> & {
  enabled?: boolean;
}): ClassmateDefinition {
  return {
    schemaVersion: 1,
    enabled: partial.enabled ?? true,
    ...partial,
  };
}

export function modelProfile(partial: Partial<ModelProfile> & Pick<ModelProfile, 'id'>): ModelProfile {
  return {
    revision: 1,
    name: partial.id,
    description: 'purpose preset',
    enabled: true,
    model: { provider: 'mock', id: 'specialist-a' },
    ...partial,
  };
}

export interface Runtime {
  ctx: Context;
  lead: Agent;
  adapter: CaptureAdapter;
  store: BindingStore;
  storageRoot: string;
  bindingsRoot: string;
}

export async function createRuntime(options: {
  storageRoot?: string;
  bindingsRoot: string;
  resumeLead?: boolean;
  install?: boolean;
  team?: boolean;
} ): Promise<Runtime> {
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  const storageRoot = options.storageRoot ?? mkdtempSync(join(tmpdir(), 'dsh-classmates-sessions-'));
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot });
  await ctx.plugin(TestSessionQuery);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(SubagentService);
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' });
  if (options.team !== false) await ctx.plugin(TeamService);
  const adapter = new CaptureAdapter(REASONING, ALLOWED_MODELS);
  ctx.llm.registerAdapter(['mock'], adapter);
  const store = new BindingStore(options.bindingsRoot, PROFILE_ID);
  if (options.install !== false && options.team !== false) installNative(ctx, store);
  const lead = options.resumeLead
    ? (await ctx.agents.resume({
      resumeSessionId: SessionId('lead'),
      agentOptions: { provider: 'mock', model: 'mock', reasoningEffort: ReasoningEffortId('high') },
    })).agent
    : await ctx.agentLoop.create(SessionId('lead'), {
      provider: 'mock',
      model: 'mock',
      reasoningEffort: ReasoningEffortId('high'),
    });
  return { ctx, lead, adapter, store, storageRoot, bindingsRoot: options.bindingsRoot };
}

export async function waitIdle(agent: Agent): Promise<void> {
  await agent.whenIdle();
}

export function spawnClassmate(
  ctx: Context,
  lead: Agent,
  name: string,
  task: string,
): Promise<SpawnTeammateResult> {
  return ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} classmate`,
    prompt: text(task),
    context: 'fresh',
    provider: PROVIDER,
    signal: SIGNAL,
  });
}

export function requestText(request: GenerateOptions): string {
  const parts: string[] = [];
  for (const message of request.messages) {
    if (!('content' in message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text);
    }
  }
  return parts.join('\n');
}

export function firstRequest(
  adapter: CaptureAdapter,
  model: string,
): GenerateOptions {
  const found = adapter.requests.find(request => request.model === model);
  if (found === undefined) throw new Error(`no captured request for model ${model}`);
  return found;
}
