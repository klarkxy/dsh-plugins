import { MAX_SHARE } from './codec.mjs';

const CHANNEL = '/dsh-blueprint';
// The payload may contain a full share code plus JSON framing and RPC metadata.
const MAX_REQUEST_BYTES = MAX_SHARE + 65536 + 1024;

/** Mount Blueprint's authenticated Connection-compatible RPC on the host server. */
export function registerHostRpc(ctx, call) {
  return ctx.webServer.register({ kind: 'prefix', path: CHANNEL, handler: async (req, res) => {
    // rc.2's Connection service owns this policy, even though it cannot register
    // plugin channels through rpc.handle() when its own context lacks webServer.
    if (typeof ctx.connection.requestRejection !== 'function') { res.writeHead(503); res.end(); return; }
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined) { res.writeHead(rejection); res.end(); return; }

    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    const endpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : '';
    if (req.method !== 'POST' || endpoint === '.' || endpoint === '..' || !/^[A-Za-z0-9_$.-]+$/.test(endpoint)) {
      res.writeHead(404); res.end(); return;
    }
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
