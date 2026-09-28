import { randomUUID } from 'node:crypto';
import { decode, encode, fail } from './codec.mjs';
import { validate, closed, array, text, equal } from './blueprint.mjs';

// Catalog enumeration order is not composition order. Compare identities and
// activation/protection state by name, while preserving the exact bundle order.
function sameProfile(actual, expected) {
  return equal(actual.order, expected.order)
    && actual.packages.length === expected.packages.length
    && expected.packages.every(p => actual.packages.some(q => q.name === p.name
      && q.version === p.version && q.source === p.source && q.enabled === p.enabled
      && q.readonly === p.readonly && q.reason === p.reason));
}

export class BlueprintEngine {
  constructor(port, now = Date.now) { this.port = port; this.now = now; this.plans = new Map(); this.results = new Map(); this.busy = false; this.lifetime = new AbortController(); }
  async catalog() {
    this.lifetime.signal.throwIfAborted();
    const s = await this.port.snapshot();
    this.lifetime.signal.throwIfAborted();
    return { packages: s.packages, order: s.order };
  }
  async generate(request) {
    this.lifetime.signal.throwIfAborted();
    closed(request, ['packages', 'name'], 'export request');
    const selection = array(request.packages, 'selected packages', 128).map(n => text(n, 'package'));
    if (new Set(selection).size !== selection.length) fail('package', 'Duplicate selected package.');
    const s = await this.port.snapshot(), packages = [];
    this.lifetime.signal.throwIfAborted();
    for (const name of selection) {
      const p = s.packages.find(p => p.name === name);
      if (!p || p.readonly || !p.source || p.reason) fail('package', 'Cannot export ' + name + '; inspect its status in the plugin manager.');
      packages.push({ name, version: p.version, source: p.source });
    }
    // Preserve explicit installation order and the enabled subset in that order.
    const document = validate({
      kind: 'dsh-blueprint', formatVersion: 2,
      metadata: { name: text(request.name, 'name', 120) },
      packages, bundles: selection.filter(n => s.order.includes(n)),
    });
    return { code: encode(document) };
  }
  async preview(request, signal) {
    signal = AbortSignal.any([this.lifetime.signal, ...signal ? [signal] : []]);
    signal.throwIfAborted();
    closed(request, ['text'], 'preview request');
    const bp = validate(decode(request.text));
    const s = await this.port.snapshot(), operations = [], blockers = [];
    signal.throwIfAborted();
    for (const p of bp.packages) {
      const current = s.packages.find(x => x.name === p.name);
      if (current) {
        if (current.readonly || current.reason || current.source !== p.source || current.version !== p.version) blockers.push(`${p.name}: protected, unsupported source or different version; resolve it in the official manager first.`);
      } else if (p.source !== 'npm') blockers.push(`${p.name}: this host does not supply the requested built-in bundle.`);
      else {
        const inspected = await this.port.inspect(`${p.name}@${p.version}`, signal);
        signal.throwIfAborted();
        if (inspected.status !== 'accepted' || inspected.bundle !== true || inspected.name !== p.name || inspected.version !== p.version) blockers.push(`${p.name}: the official manager did not confirm this exact bundle.`);
        else operations.push({ type: 'install', name: p.name, version: p.version });
      }
    }
    // Import adds to the current composition. Document order is a preference for
    // new activations, never permission to move or disable an existing layer.
    const enabled = new Set(s.order);
    const added = bp.bundles.filter(name => !enabled.has(name));
    for (const name of added) operations.push({ type: 'bundle', name, enabled: true });
    // Inspection can involve network I/O. Bind the plan only if the observed profile stayed unchanged.
    const latest = await this.port.snapshot();
    signal.throwIfAborted();
    if (latest.stamp !== s.stamp) fail('stale', 'Profile changed while preparing the preview.');
    const result = {
      stage: 'packages', blockers, operations,
      order: [...s.order, ...added],
      notice: 'Existing bundle order and active layers are preserved. Requested new activations append in blueprint order. Native installation may execute previously approved package scripts; enabling bundles executes plugin code.',
    };
    if (blockers.length || !operations.length) return { ...result, planId: null };
    for (const [id, p] of this.plans) if (p.expires <= this.now()) this.plans.delete(id);
    if (this.plans.size >= 8) fail('capacity', 'Too many outstanding previews. Let an old preview expire.');
    const planId = randomUUID();
    this.plans.set(planId, { ...structuredClone(result), expected: structuredClone({ packages: s.packages, order: s.order }),
      stamp: s.stamp, expires: this.now() + 300_000 });
    return { ...result, planId };
  }
  async apply(planId, signal = new AbortController().signal) {
    this.lifetime.signal.throwIfAborted();
    signal = AbortSignal.any([this.lifetime.signal, signal]);
    text(planId, 'plan id');
    if (this.results.has(planId)) return this.results.get(planId);
    if (this.busy) fail('busy', 'A blueprint operation is already running.');
    const p = this.plans.get(planId);
    if (!p || p.expires <= this.now()) { this.plans.delete(planId); fail('expired', 'Preview expired or was already consumed.'); }
    this.busy = true;
    const report = { planId, status: 'applied', steps: [] };
    try {
      if ((await this.port.snapshot()).stamp !== p.stamp) fail('stale', 'Profile changed after preview.');
      this.plans.delete(planId);
      let stamp = p.stamp;
      const expected = p.expected;
      for (const operation of p.operations) {
        if (signal.aborted) { report.status = 'interrupted'; break; }
        try {
          const before = await this.port.snapshot();
          if (signal.aborted) { report.status = 'interrupted'; break; }
          if (before.stamp !== stamp || !sameProfile(before, expected)) { report.status = 'conflict'; break; }
          const outcome = await this.port.execute(operation, signal);
          report.steps.push({ type: operation.type, target: operation.name, outcome });
          if (outcome.application && outcome.application !== 'applied') { report.status = outcome.application; break; }
          const after = await this.port.snapshot();
          if (!this.port.verify(operation, after)) { report.status = 'verification-failed'; break; }
          // Advance only the authorized effect; never adopt unrelated changes
          // that arrived during native installation or activation.
          if (operation.type === 'install') expected.packages.push({ name: operation.name, version: operation.version,
            source: 'npm', enabled: false, readonly: false, reason: null });
          else {
            expected.packages.find(pkg => pkg.name === operation.name).enabled = true;
            expected.order.push(operation.name);
          }
          if (!sameProfile(after, expected)) { report.status = 'verification-failed'; break; }
          stamp = after.stamp;
        } catch (e) {
          // Native installation errors can contain private environment details. Never echo arbitrary messages.
          if (report.steps.length === p.operations.indexOf(operation)) report.steps.push({ type: operation.type, target: operation.name, outcome: { application: 'failed', code: 'operation-failed' } });
          report.status = 'failed'; break;
        }
      }
      if (report.status === 'applied') {
        try {
          const final = await this.port.snapshot();
          if (final.stamp !== stamp || !sameProfile(final, expected)) report.status = 'verification-failed';
        }
        catch { report.status = 'verification-failed'; }
      }
      report.remaining = p.operations.length - report.steps.length;
      if (!this.lifetime.signal.aborted) {
        this.results.set(planId, report);
        if (this.results.size > 8) this.results.delete(this.results.keys().next().value);
      }
      return report;
    } finally { this.busy = false; }
  }
  dispose() { this.lifetime.abort(); this.plans.clear(); this.results.clear(); }
}
