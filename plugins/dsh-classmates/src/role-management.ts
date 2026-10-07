import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type {} from '@deepseek-ai/dsh-experimental-agent-team';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { ClassmatesError, currentModelFromOwnRequestHeaders } from './config.js';
import { CREATOR_PRESET_ID, type ModelBinding, type NormalizedRole } from './contracts.js';
import { COLLABORATION_GUIDANCE, createPresets, SOFTWARE_COLLABORATION_RULES } from './presets.js';
import { isModelProtected, requestModelApproval, validateModelRoute } from './model-protection.js';

export const MODEL_AVAILABILITY_NOTICE = '目录列出的是宿主已注册项，不代表连通或可完成请求。Local OCG 只表示公开供应商名称或当前路由，不代表模型在本机推理。';

const POLICY = `In Creator mode, the top-level agent may configure reusable Classmates role templates and independent model-use presets when the user requests that configuration. This capability supplements the normal Creator workflow; it does not replace your task, tool, permission, or collaboration instructions. Do not change the shared libraries merely to suit an unrelated task. Role templates apply to future native DSH subagents and Team teammates, not your own current session or existing members. Templates describe duties, output boundaries, and instructions; they do not require a user model selection.

Call classmates_read first. Inspect the current roles, modelProfiles, presets, settingsRevision, model catalog, currentModel, and modelAvailabilityNotice before making changes. Presets are optional duty templates, including a disabled Advisor preset for read-only consultation. New roles and model-use presets use revision 0; do not overwrite existing entries with matching names or IDs. Existing custom roles stay as stored.

Explain roles, model-use presets, model choices, and save results in plain language. Unless the user specifies a model on a template, set that role's model to { kind: 'inherit' } so the role follows the dispatching chat's actual configuration; an inherit role may still carry a top-level reasoningEffort override. Do not copy currentModel into a fixed role binding. Legacy role shapes ({ provider, id, reasoningEffort } models, model null, and reasoningEffort) remain accepted for compatibility only and normalize on save; do not silently migrate them into model-use presets or delete them.

A role's model is a first-class three-state setting stored on the model field: { kind: 'inherit' } follows the dispatching chat and is the default; { kind: 'profile', profileId } is a strong reference to an existing enabled model-use preset; { kind: 'fixed', provider, id, effort? } binds an exact catalog route. A profile reference is a hard requirement at dispatch: a missing or disabled preset fails with guidance and never falls back to another route. The dispatch-time model_profile argument remains the highest-priority one-call override for both classmates_spawn and role subagent tools. Legacy recommendedModelProfileId input (the old soft pairing hint) is still accepted on classmates_batch: when the role has no fixed model it migrates into a strong { kind: 'profile' } reference on save; when a legacy fixed model is also present, the fixed model wins and the role reports migratedRecommendation with the unused preset id. Do not copy a recommendation into the role's fixed model, do not treat a missing preset as a reason to invent a route, and do not silently rebind, fall back, or recreate a preset. Roles referencing a deleted or disabled preset stay editable; fix them by choosing another preset or { kind: 'inherit' }.

Independent model-use presets are a separate editable library. Each preset names a purpose and binds an exact catalog provider and model. Put cost or capability usage guidance in the preset description; put duties in the role. Omitted effort means that model's default, never the parent chat's effort. The same provider and model may appear in multiple presets with different efforts or purposes. Explicit models must exist in the catalog. Catalog entries, including any descriptions, are not proof of connectivity. Do not inspect or configure credentials, or invent model prices or capability rankings. Ask briefly only when a material choice is ambiguous.

Common pairings are easy to express: Advisor for read-only consultation; Implementer with one Reviewer as the verification owner; Researcher then Writer then Verifier for sourced writing. Do not require every task to delegate or add extra review layers. ${COLLABORATION_GUIDANCE}

For an exploratory request, propose a complete set of complementary roles that can be adopted together, rather than repeatedly filling individual forms. For explicit reversible edits, submit one classmates_batch for templates or one classmates_models_batch for model-use presets without an extra approval step and report the result accurately and concisely.

Batches validate completely before a single write; do not assume partial success. On a settingsRevision, role revision, or model-use preset revision conflict, call classmates_read again. Do not overwrite unseen changes.

A member's actual model, effort, and instructions are frozen at creation. Editing or deleting a role, disabling it, or switching the Lead's model does not change existing members. Role IDs and preset IDs use lowercase letters, digits, and hyphens. A role with an inherit model can be enabled. If an explicit model does not support inherited effort, creation fails and requires a compatible explicit effort; it never silently downgrades.

Write role instructions in English and keep user-facing descriptions concise in the user's language. For software roles, the following guidance may be included in instructions. Do not add it to general research, writing, or verification roles, or introduce project-specific game rules: ${SOFTWARE_COLLABORATION_RULES}

Model protection is per provider/model route across all profiles and efforts. Read protectedModels with classmates_read. Use classmates_model_protection only when the user requests a protection setting change. Disabling existing protection requests native approval; never remove protection merely to make a delegation succeed. Creation approval covers one new child, not its later requests or continuation. Rejected approval leaves the next decision to the delegating agent, with no automatic fallback.

Respond in the user's language.`;

function jsonOutput() {
  return {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

const ROLE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: true,
  description: '完整角色对象；空库创建第一条也用此形状，不要省略字段。',
  properties: {
    schemaVersion: {
      type: 'integer' as const,
      const: 1 as const,
      required: true,
      description: '角色格式版本，固定为 1。',
    },
    id: {
      type: 'string' as const,
      required: true,
      description: '角色标识；须匹配 ^[a-z0-9]+(?:-[a-z0-9]+)*$ ，最长 80 字符，例如 researcher。',
    },
    revision: {
      type: 'integer' as const,
      required: true,
      description: '角色版本；新建为 0，修改已有角色时须等于 classmates_read 返回的当前 revision。',
    },
    name: {
      type: 'string' as const,
      required: true,
      description: '显示名称，1 到 100 字符。',
    },
    description: {
      type: 'string' as const,
      required: true,
      description: '职责与产出边界，1 到 200 字符。写何时调用、负责什么、交什么结果；不要写模型、价格或思考强度。',
    },
    instructions: {
      type: 'string' as const,
      required: true,
      description: '角色指令，1 到 32000 字符。',
    },
    enabled: {
      type: 'boolean' as const,
      required: true,
      description: '是否对普通主控可见。跟随当前聊天的角色也可启用。',
    },
    model: {
      required: true,
      description: '三态模型设置：inherit 跟随派发会话（默认），profile 强引用模型用途预设（缺失或停用即报错，不回落），fixed 绑定目录中的精确路由。旧格式（null 或 {provider,id,reasoningEffort}）仍接受，保存时自动迁移。',
      oneOf: [
        {
          type: 'null' as const,
          description: '旧格式：跟随当前聊天模型，保存时迁移为 { kind: \'inherit\' }。',
        },
        {
          type: 'object' as const,
          additionalProperties: false,
          description: '旧格式：宿主目录中的模型路由，保存时迁移为 { kind: \'fixed\' }（顶层 reasoningEffort 并入 effort）。',
          properties: {
            provider: {
              type: 'string' as const,
              required: true,
              description: '目录中的供应商 id，最长 250 字符。',
            },
            id: {
              type: 'string' as const,
              required: true,
              description: '目录中的模型 id，最长 250 字符。',
            },
            reasoningEffort: {
              type: 'string' as const,
              description: '旧格式兼容字段；新配置使用 fixed 的 effort。',
            },
          },
        },
        {
          type: 'object' as const,
          additionalProperties: false,
          description: '跟随派发会话的模型与强度（默认）。',
          properties: {
            kind: { type: 'string' as const, const: 'inherit' as const, required: true, description: '固定值 inherit。' },
          },
        },
        {
          type: 'object' as const,
          additionalProperties: false,
          description: '强引用一个已启用模型用途预设；派发时预设缺失或停用即硬错误，不会回落。',
          properties: {
            kind: { type: 'string' as const, const: 'profile' as const, required: true, description: '固定值 profile。' },
            profileId: {
              type: 'string' as const,
              required: true,
              description: '已有模型用途预设 id；须匹配 ^[a-z0-9]+(?:-[a-z0-9]+)*$ ，最长 80 字符。',
            },
          },
        },
        {
          type: 'object' as const,
          additionalProperties: false,
          description: '绑定宿主目录中的精确模型路由。',
          properties: {
            kind: { type: 'string' as const, const: 'fixed' as const, required: true, description: '固定值 fixed。' },
            provider: {
              type: 'string' as const,
              required: true,
              description: '目录中的供应商 id，最长 250 字符。',
            },
            id: {
              type: 'string' as const,
              required: true,
              description: '目录中的模型 id，最长 250 字符。',
            },
            effort: {
              type: 'string' as const,
              description: '该模型支持的思考强度 id；省略则跟随派发会话的强度。',
            },
          },
        },
      ],
    },
    reasoningEffort: {
      type: 'string' as const,
      description: '独立的思考强度覆盖，仅对跟随派发会话（inherit）的角色生效；省略则继承创建成员时当前聊天的强度。显式模型须支持此 effort id，跟随模型时在创建时验证。',
    },
    recommendedModelProfileId: {
      type: 'string' as const,
      description: '旧格式兼容字段。角色无固定模型时保存为 { kind: \'profile\' } 强引用；与旧形固定模型并存时固定模型优先，该 id 记入 migratedRecommendation。新配置请直接使用 model 的 profile 形。',
    },
  },
} as const;

const MODEL_PROFILE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: true,
  description: '完整模型用途预设；空库创建第一条也用此形状，不要省略字段。',
  properties: {
    id: {
      type: 'string' as const,
      required: true,
      description: '预设标识；须匹配 ^[a-z0-9]+(?:-[a-z0-9]+)*$ ，最长 80 字符，例如 coding-high。',
    },
    revision: {
      type: 'integer' as const,
      required: true,
      description: '预设版本；新建为 0，修改已有预设时须等于 classmates_read 返回的当前 revision。',
    },
    name: {
      type: 'string' as const,
      required: true,
      description: '显示名称，1 到 100 字符。',
    },
    description: {
      type: 'string' as const,
      required: true,
      description: '用途说明，1 到 200 字符。说明何时选用此模型与思考强度；可写用法，不要编造价格或质量，也不要写角色职责。',
    },
    enabled: {
      type: 'boolean' as const,
      required: true,
      description: '是否对普通主控可见。停用的预设仍保留，不会改写角色模板。',
    },
    model: {
      type: 'object' as const,
      additionalProperties: false,
      required: true,
      description: '宿主目录中的模型路由。省略 reasoningEffort 表示该模型的默认强度，而不是当前聊天的强度。',
      properties: {
        provider: {
          type: 'string' as const,
          required: true,
          description: '目录中的供应商 id，最长 250 字符。',
        },
        id: {
          type: 'string' as const,
          required: true,
          description: '目录中的模型 id，最长 250 字符。',
        },
        reasoningEffort: {
          type: 'string' as const,
          description: '该模型支持的思考强度 id。省略则使用模型默认，不继承父会话。',
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function callingAgentEvents(agent: Agent): { events: readonly unknown[]; inheritedEventCount: number } {
  const session = (agent as { session?: unknown }).session;
  if (!isRecord(session)) return { events: [], inheritedEventCount: 0 };
  const inherited = typeof session.inheritedEventCount === 'number' && Number.isSafeInteger(session.inheritedEventCount) && session.inheritedEventCount >= 0
    ? session.inheritedEventCount
    : 0;
  if (typeof session.ownEvents === 'function') {
    try {
      const own = session.ownEvents();
      if (Array.isArray(own)) return { events: own, inheritedEventCount: inherited };
    } catch { /* try other session views */ }
  }
  if (Array.isArray(session.events)) return { events: session.events, inheritedEventCount: inherited };
  if (typeof session.snapshotEvents === 'function') {
    try {
      const snapshot = session.snapshotEvents();
      if (Array.isArray(snapshot)) return { events: snapshot, inheritedEventCount: inherited };
    } catch { /* unknown readiness */ }
  }
  return { events: [], inheritedEventCount: inherited };
}

function currentModelFromCallingAgent(agent: Agent): ModelBinding | null {
  const { events, inheritedEventCount } = callingAgentEvents(agent);
  return currentModelFromOwnRequestHeaders(events, inheritedEventCount);
}

/** The actual composed preset is authoritative; session labels are not. */
export function isCreatorRoot(ctx: Context, agent: Agent): boolean {
  if (ctx.get('agentPresets')?.composedPreset(agent.ctx) !== CREATOR_PRESET_ID) return false;
  if (isSubagentSession(agent.session)) return false;
  return ctx.get('agentTeams')?.tryMembership(agent)?.role !== 'teammate';
}

/** Register on one Agent's own scope, with a second identity check at dispatch. */
export function installRoleManagement(ctx: Context, owner: Agent): () => void {
  if (!isCreatorRoot(ctx, owner)) return () => {};
  let active = true;
  const assertCaller = (agent: Agent | undefined): Agent => {
    if (!active || agent !== owner || !isCreatorRoot(ctx, owner)) {
      throw new ClassmatesError('CREATOR_ONLY', '角色配置工具仅限创造模式的主智能体使用');
    }
    return owner;
  };
  const scope = owner.ctx;
  const disposers: Array<() => void> = [];
  disposers.push(scope.systemPrompt.section({
    name: 'classmates:configuration',
    order: scope.systemPrompt.getSectionOrder('TEAM_POLICY') + 20,
    text: POLICY,
    interpolate: false,
  }));

  const output = jsonOutput();
  disposers.push(scope.tools.register(defineTool({
    name: 'classmates_read',
    description: '读取角色模板、模型用途预设、宿主模型目录、调用方最近自有请求路由（currentModel）与目录连通说明。只读：目录项不代表连通，也不补造目录外的模型。',
    parameters: {},
    output,
    execute: async (_args, exec) => {
      const agent = assertCaller(exec.agent);
      const state = JSON.parse(JSON.stringify(await ctx.classmatesController.load())) as Record<string, unknown>;
      delete state.currentModel;
      delete state.modelAvailabilityNotice;
      return JSON.parse(JSON.stringify({
        ...state,
        presets: createPresets(),
        currentModel: currentModelFromCallingAgent(agent),
        modelAvailabilityNotice: MODEL_AVAILABILITY_NOTICE,
      }));
    },
  })));
  disposers.push(scope.tools.register(defineTool({
    name: 'classmates_batch',
    description: '一次性提交一组角色增改删。全部校验通过才写入；重复 id、过期版本或无效模型整批拒绝，不分多次部分保存。',
    parameters: {
      changes: {
        type: 'array',
        required: true,
        description: 'upsert 或 remove 操作列表，每项只针对一个角色 id。',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                op: { type: 'string', const: 'upsert', required: true, description: '写入或更新一个角色。' },
                role: ROLE_SCHEMA,
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                op: { type: 'string', const: 'remove', required: true, description: '删除一个角色。已有团队成员绑定保持冻结，不会改写。' },
                id: { type: 'string', required: true, description: '要删除的角色标识，须与库中 id 一致。' },
                revision: { type: 'integer', required: true, description: '必须等于 classmates_read 返回的当前角色 revision。' },
              },
            },
          ],
        },
      },
      expected: { type: 'integer', required: true, description: '当前 settingsRevision，用作一次比较后写入。' },
    },
    output,
    execute: async (args, exec) => {
      assertCaller(exec.agent);
      return JSON.parse(JSON.stringify(await ctx.classmatesController.batch(args.changes, args.expected)));
    },
  })));
  disposers.push(scope.tools.register(defineTool({
    name: 'classmates_models_batch',
    description: '一次性提交一组模型用途预设增改删。全部校验通过才写入；重复 id、过期版本或无效模型整批拒绝。不改写角色模板，不分多次部分保存。删除或停用某预设时，返回的 referencingRoles 列出仍引用它的角色名，不阻断操作。',
    parameters: {
      changes: {
        type: 'array',
        required: true,
        description: 'upsert 或 remove 操作列表，每项只针对一个预设 id。',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                op: { type: 'string', const: 'upsert', required: true, description: '写入或更新一个模型用途预设。' },
                profile: MODEL_PROFILE_SCHEMA,
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                op: { type: 'string', const: 'remove', required: true, description: '删除一个模型用途预设。引用它的角色保持原样，其 profile 强引用在派发时会硬报错。' },
                id: { type: 'string', required: true, description: '要删除的预设标识，须与库中 id 一致。' },
                revision: { type: 'integer', required: true, description: '必须等于 classmates_read 返回的当前预设 revision。' },
              },
            },
          ],
        },
      },
      expected: { type: 'integer', required: true, description: '当前 settingsRevision，用作一次比较后写入。' },
    },
    output,
    execute: async (args, exec) => {
      assertCaller(exec.agent);
      const affected = new Set<string>();
      if (Array.isArray(args.changes)) {
        for (const change of args.changes as Array<{ op?: unknown; id?: unknown; profile?: { id?: unknown; enabled?: unknown } }>) {
          if (change?.op === 'remove' && typeof change.id === 'string') affected.add(change.id);
          if (change?.op === 'upsert' && change.profile?.enabled === false && typeof change.profile.id === 'string') affected.add(change.profile.id);
        }
      }
      const next = await ctx.classmatesController.batchModelProfiles(args.changes, args.expected);
      if (affected.size === 0) return JSON.parse(JSON.stringify(next));
      // 返回状态中的角色已是规范化三态；ClassmatesState.roles 的声明仍待 UI 阶段切换。
      const roles = (next.roles ?? []) as unknown as NormalizedRole[];
      const referencingRoles = roles
        .filter(role => role.model.kind === 'profile' && affected.has(role.model.profileId))
        .map(role => role.name);
      return JSON.parse(JSON.stringify({ ...next, referencingRoles }));
    },
  })));
  disposers.push(scope.tools.register(defineTool({
    name: 'classmates_model_protection',
    description: '设置某供应商和模型的使用前审批，影响同一路由的所有用途与思考强度。仅在用户要求时使用。关闭已有保护需原生审批，不能为完成任务自行解锁。',
    parameters: {
      model: { type: 'object', additionalProperties: false, required: true, properties: {
        provider: { type: 'string', required: true, description: '供应商标识。' },
        id: { type: 'string', required: true, description: '模型标识。' },
      } },
      required: { type: 'boolean', required: true, description: 'true 开启保护；false 关闭保护。' },
      expected: { type: 'integer', required: true, description: 'classmates_read 返回的 settingsRevision。' },
    },
    output,
    execute: async (args, exec) => {
      const agent = assertCaller(exec.agent);
      const model = validateModelRoute(args.model);
      const state = await ctx.classmatesController.load();
      assertCaller(exec.agent);
      exec.signal.throwIfAborted();
      if (state.settingsRevision !== args.expected) throw new ClassmatesError('SETTINGS_CONFLICT', '配置已改变，请重新调用 classmates_read');
      if (!args.required && isModelProtected(state.protectedModels, model)) {
        await requestModelApproval(ctx, agent, { model, action: 'unlock', roleName: 'model protection',
          task: 'Remove approval-before-use for this model route.', toolName: exec.name, callId: exec.callId, signal: exec.signal });
        assertCaller(exec.agent);
        exec.signal.throwIfAborted();
      }
      return JSON.parse(JSON.stringify(await ctx.classmatesController.setModelProtection(model, args.required, args.expected)));
    },
  })));
  return () => { active = false; for (const dispose of disposers.splice(0).reverse()) dispose(); };
}
