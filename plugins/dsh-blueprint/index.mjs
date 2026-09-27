import { BlueprintError, MAX_SHARE } from './codec.mjs';
import { closed, text } from './blueprint.mjs';
import { BlueprintEngine } from './engine.mjs';
import { officialPort } from './official.mjs';
export const name = 'dsh-blueprint';
export const inject = ['connection', 'pluginManager', 'profileContext', 'pluginPackages', 'settings', 'loader'];
export function apply(ctx) {
  const engine = new BlueprintEngine(officialPort(ctx)), lifetime = new AbortController();
  ctx.effect(() => () => { lifetime.abort(); engine.dispose(); });
  // The official Connection registry supplies authentication and the Host/Origin fence.
  ctx.connection.rpc.handle('/dsh-blueprint', async (endpoint, payload, signal) => {
    try {
      if (Buffer.byteLength(JSON.stringify(payload) ?? '') > MAX_SHARE + 65536) throw new BlueprintError('size', 'Request too large.');
      const combined = AbortSignal.any([signal, lifetime.signal]); combined.throwIfAborted();
      let value;
      switch (endpoint) {
        case 'catalog': closed(payload, [], 'catalog request'); value = await engine.catalog(); break;
        case 'generate': value = await engine.generate(payload); break;
        case 'preview': value = await engine.preview(payload); break;
        case 'apply':
          closed(payload, ['planId', 'confirmed'], 'apply request');
          if (payload.confirmed !== true) throw new BlueprintError('confirmation', 'Explicit confirmation is required.');
          value = await engine.apply(text(payload.planId, 'plan id'), combined); break;
        case 'result': closed(payload, ['planId'], 'result request'); value = engine.results.get(text(payload.planId, 'plan id')) ?? null; break;
        default: throw new BlueprintError('endpoint', 'Unknown blueprint endpoint.');
      }
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: { code: e instanceof BlueprintError ? e.code : 'operation-failed',
        message: e instanceof BlueprintError ? e.message : 'The operation failed. Review the official plugin manager; no automatic retry was performed.', details: {} } };
    }
  });
}
