import { createControl, CHANNEL, REVIEW_FIELDS } from './control.js';
import { registerHostRpc } from '@klarkxy/dsh-plugin-kit/host-rpc';

export const name = 'dsh-safe-auto-ui-host';
// Register on this fiber. connection.rpc.handle mounts routes on connection's
// own fiber, which does not inject webServer and throws on activation.
export const inject = ['safeAutoRuntime', 'storageDomain', 'connection', 'webServer', 'permissionPresets', 'sandboxPolicy', 'sessions'];
const ENDPOINT = /^[A-Za-z0-9_$.-]+$/;
const MAX_REQUEST_BYTES = 64 * 1024;

/** Connection-compatible POST /dsh-safe-auto/<endpoint>. Missing auth policy fails closed. */
export function registerControlRoute(ctx, call) {
  return registerHostRpc(ctx, CHANNEL, (endpoint, payload, signal) =>
    call(endpoint, payload, signal, { interaction: endpoint === 'approval.list' || endpoint === 'approval.answer' }), {
    maxBodyBytes: MAX_REQUEST_BYTES,
    isEndpoint: endpoint => ENDPOINT.test(endpoint),
    caseInsensitiveContentType: true,
    requirePayload: true,
    errorBody: status => status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : undefined,
    beforeBody: (req, endpoint) => {
      // Host admission is authoritative; this metadata gate protects the two
      // browser approval endpoints, including Desktop's forwarded requests.
      const interaction = endpoint === 'approval.list' || endpoint === 'approval.answer';
      const site = req.headers['sec-fetch-site'];
      const desktopRequest = site === undefined && req.headers.origin === undefined;
      const trustedSite = ['same-origin', 'same-site'].includes(site) || desktopRequest;
      const trustedDestination = req.headers['sec-fetch-dest'] === 'empty'
        || (desktopRequest && req.headers['sec-fetch-dest'] === undefined && req.headers['sec-fetch-mode'] === 'cors');
      if (interaction && (!['cors', 'same-origin'].includes(req.headers['sec-fetch-mode']) ||
          !trustedSite || !trustedDestination)) {
        return { status: 403, body: 'browser confirmation required' };
      }
    },
  });
}

export async function apply(ctx) {
  // Loaded only by the separate UI row; the safety guard keeps its original minimal dependencies.
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
    sandboxPolicy: ctx.sandboxPolicy, sessions: ctx.sessions, onChange: () => ctx.safeAutoRuntime.invalidateApprovals?.() });
  // Validate stored settings before publishing any UI endpoint.
  control.settingsView();
  ctx.effect(() => ctx.safeAutoRuntime.attach(control));
  ctx.effect(() => registerControlRoute(ctx, async (endpoint, payload, signal, source) => {
    try {
      control.signal.throwIfAborted();
      if (endpoint === 'approval.list' || endpoint === 'approval.answer') {
        if (!source?.interaction) throw new Error('Browser confirmation required');
        signal.throwIfAborted();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid approval payload');
        const value = endpoint === 'approval.list' ? ctx.safeAutoRuntime.listApprovals(payload.sessionId)
          : ctx.safeAutoRuntime.answerApproval(payload);
        return { ok: true, value };
      }
      return { ok: true, value: await control.call(endpoint, payload, signal) };
    }
    catch (error) { return { ok: false, error: { code: 'safe-auto/rejected', message: error instanceof Error ? error.message : 'Request rejected', details: {} } }; }
  }));
}
