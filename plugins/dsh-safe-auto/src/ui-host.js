import { createControl, CHANNEL, REVIEW_FIELDS } from './control.js';
import { registerHostRpc } from '@klarkxy/dsh-plugin-kit/host-rpc';
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts';
import { createModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-changes';
import { registerModelSettings, notifyModelSettingsChanged } from '@klarkxy/dsh-plugin-kit/model-settings';

export const name = 'dsh-safe-auto-ui-host';
// Register on this fiber. connection.rpc.handle mounts routes on connection's
// own fiber, which does not inject webServer and throws on activation.
export const inject = ['safeAutoRuntime', 'storageDomain', 'connection', 'webServer', 'permissionPresets', 'sandboxPolicy', 'sessions'];
const ENDPOINT = /^[A-Za-z0-9_$.-]+$/;
const MAX_REQUEST_BYTES = 64 * 1024;

/** Connection-compatible POST /dsh-safe-auto/<endpoint>. Missing auth policy fails closed. */
export function registerControlRoute(ctx, call) {
  return registerHostRpc(ctx, CHANNEL, (endpoint, payload, signal) => call(endpoint, payload, signal), {
    maxBodyBytes: MAX_REQUEST_BYTES,
    isEndpoint: endpoint => ENDPOINT.test(endpoint),
    caseInsensitiveContentType: true,
    requirePayload: true,
    errorBody: status => status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : undefined,
  });
}

export async function apply(ctx) {
  createModelSettingsChanges(ctx, modelSettingsChangesIdentity('@klarkxy/dsh-safe-auto'), '@klarkxy/dsh-safe-auto');
  // Loaded only by the separate UI row; the review plugin keeps its minimal dependencies.
  const [{ defineDomain, domainTable }, { z }] = await Promise.all([import('@deepseek-ai/dsh-storage-domain'), import('zod')]);
  // No strict(): rows saved by 0.1.x carry retired keys (fastProvider, approvalReview, …),
  // which strip on load instead of breaking the panel; the reviewer simply falls back to defaults.
  const domain = await ctx.storageDomain.open(defineDomain({ name: 'dsh_safe_auto', version: 1, tables: {
    settings: domainTable(z.object({ revision: z.number().int().nonnegative(),
      values: z.object(Object.fromEntries(REVIEW_FIELDS.map(k => [k, z.string().max(4096).optional()]))),
    }).strict()),
  } }));
  let control;
  ctx.effect(() => async () => { await control?.dispose(); await domain.close(); });
  control = createControl(ctx.safeAutoRuntime.base, { table: domain.table('settings'), presets: ctx.permissionPresets,
    sandboxPolicy: ctx.sandboxPolicy, sessions: ctx.sessions,
    onSettingsChanged: revision => notifyModelSettingsChanged(ctx, '@klarkxy/dsh-safe-auto', revision) });
  // Validate stored settings before publishing any UI endpoint.
  control.settingsView();
  ctx.effect(() => registerModelSettings(ctx, {
    ns: '@klarkxy/dsh-safe-auto', title: { zh: '安全自动', en: 'Safe Auto' },
    read(signal) {
      signal.throwIfAborted(); control.signal.throwIfAborted();
      const { revision, values } = control.settingsView();
      const current = { provider: values.provider, model: values.model,
        ...(values.reasoningEffort ? { reasoningEffort: values.reasoningEffort } : {}) };
      return { revision, fields: [{ path: ['model'], label: { zh: '审查模型', en: 'Reviewer model' }, current,
        followLabel: { zh: '当前会话模型', en: 'Current conversation model' }, allowFollow: true }] };
    },
    async write(path, route, expectedRevision, signal) {
      if (path.length !== 1 || path[0] !== 'model') throw new Error('Unknown Safe Auto model setting');
      return control.call('settings.save', { values: { provider: route.provider, model: route.model,
        reasoningEffort: route.reasoningEffort || '' }, expectedRevision }, signal);
    },
  }));
  ctx.effect(() => ctx.safeAutoRuntime.attach(control));
  ctx.effect(() => registerControlRoute(ctx, async (endpoint, payload, signal) => {
    try {
      control.signal.throwIfAborted();
      return { ok: true, value: await control.call(endpoint, payload, signal) };
    }
    catch (error) { return { ok: false, error: { code: 'safe-auto/rejected', message: error instanceof Error ? error.message : 'Request rejected', details: {} } }; }
  }));
}
