import { createControl, CHANNEL, REVIEW_FIELDS } from './control.js';

export const name = 'dsh-safe-auto-ui-host';
// Register on this fiber. connection.rpc.handle mounts routes on connection's
// own fiber, which does not inject webServer and throws on activation.
export const inject = ['safeAutoRuntime', 'storageDomain', 'connection', 'webServer', 'permissionPresets', 'sandboxPolicy', 'sessions'];
const ENDPOINT = /^[A-Za-z0-9_$.-]+$/;
const MAX_REQUEST_BYTES = 64 * 1024;

/** Connection-compatible POST /dsh-safe-auto/<endpoint>. Missing auth policy fails closed. */
export function registerControlRoute(ctx, call) {
  return ctx.webServer.register({ kind: 'prefix', path: CHANNEL, handler: async (req, res) => {
    if (typeof ctx.connection.requestRejection !== 'function') { res.writeHead(503); res.end(); return; }
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined) { res.writeHead(rejection); res.end(rejection === 401 ? 'unauthorized' : 'forbidden'); return; }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    const endpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : '';
    if (req.method !== 'POST' || !ENDPOINT.test(endpoint) || endpoint.includes('/')) { res.writeHead(404); res.end(); return; }
    if (String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      res.writeHead(415); res.end(); return;
    }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_REQUEST_BYTES) { res.writeHead(413, { connection: 'close' }); res.end(); req.destroy(); return; }
        chunks.push(bytes);
      }
      let message;
      try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400); res.end(); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)
          || message.type !== 'client-request' || typeof message.rpcId !== 'string'
          || message.method !== endpoint || !Object.hasOwn(message, 'payload')) {
        res.writeHead(400); res.end(); return;
      }
      const result = await call(endpoint, message.payload, controller.signal);
      if (!res.destroyed) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ type: 'server-response', rpcId: message.rpcId, result }));
      }
    } catch {
      if (!res.destroyed) { res.writeHead(500); res.end('rpc request failed'); }
    }
  } });
}

export async function apply(ctx) {
  // Loaded only by the separate UI row; the safety guard keeps its original minimal dependencies.
  const [{ defineDomain, domainTable }, { z }] = await Promise.all([import('@deepseek-ai/dsh-storage-domain'), import('zod')]);
  const domain = await ctx.storageDomain.open(defineDomain({ name: 'dsh_safe_auto', version: 1, tables: {
    settings: domainTable(z.object({ revision: z.number().int().nonnegative(),
      values: z.object({ ...Object.fromEntries(REVIEW_FIELDS.map(k => [k, z.string().max(4096).optional()])), approvalReview: z.boolean().optional() }).strict(),
    }).strict()),
  } }));
  ctx.effect(() => () => domain.close());
  const control = createControl(ctx.safeAutoRuntime.base, { table: domain.table('settings'), presets: ctx.permissionPresets,
    sandboxPolicy: ctx.sandboxPolicy, sessions: ctx.sessions });
  // Validate stored settings before publishing any UI endpoint.
  control.settingsView();
  ctx.effect(() => ctx.safeAutoRuntime.attach(control));
  ctx.effect(() => registerControlRoute(ctx, async (endpoint, payload, signal) => {
    try { return { ok: true, value: await control.call(endpoint, payload, signal) }; }
    catch (error) { return { ok: false, error: { code: 'safe-auto/rejected', message: error instanceof Error ? error.message : 'Request rejected', details: {} } }; }
  }));
}
