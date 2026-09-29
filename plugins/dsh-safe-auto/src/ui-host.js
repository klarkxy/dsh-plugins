import { createControl, CHANNEL, REVIEW_FIELDS } from './control.js';

export const name = 'dsh-safe-auto-ui-host';
export const inject = ['safeAutoRuntime', 'storageDomain', 'connection', 'permissionPresets', 'sandboxPolicy', 'sessions'];

export async function apply(ctx) {
  // Loaded only by the separate UI row; the safety guard keeps its original minimal dependencies.
  const [{ defineDomain, domainTable }, { z }] = await Promise.all([import('@deepseek-ai/dsh-storage-domain'), import('zod')]);
  const domain = await ctx.storageDomain.open(defineDomain({ name: 'dsh_safe_auto', version: 1, tables: {
    settings: domainTable(z.object({ revision: z.number().int().nonnegative(),
      values: z.object(Object.fromEntries(REVIEW_FIELDS.map(k => [k, z.string().max(4096).optional()]))).strict(),
    }).strict()),
  } }));
  ctx.effect(() => () => domain.close());
  const control = createControl(ctx.safeAutoRuntime.base, { table: domain.table('settings'), presets: ctx.permissionPresets,
    sandboxPolicy: ctx.sandboxPolicy, sessions: ctx.sessions });
  // Validate stored settings before publishing any UI endpoint.
  control.settingsView();
  ctx.effect(() => ctx.safeAutoRuntime.attach(control));
  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
    try { return { ok: true, value: await control.call(endpoint, payload, signal) }; }
    catch (error) { return { ok: false, error: { code: 'safe-auto/rejected', message: error instanceof Error ? error.message : 'Request rejected', details: {} } }; }
  }));
}
