import { randomUUID } from 'node:crypto';
import { decode, encode, fail } from './codec.mjs';
import { validate, closed, array, text, path, identity, equal, overlaps, prefix, publicFields, policy, get } from './blueprint.mjs';

function changesConnection(at, before, after) {
  if (equal(before, after)) return false;
  if (at.some(p => /^(?:base[_-]?url|endpoint|url|host|api[_-]?key[_-]?env)$/i.test(p))) return true;
  const keys = value => value !== null && typeof value === 'object' ? Object.keys(value) : [];
  // Whole-container edits must also protect nested additions, removals and replacements.
  return [...new Set([...keys(before), ...keys(after)])]
    .some(key => changesConnection([...at, key], get(before, [key]), get(after, [key])));
}

export class BlueprintEngine {
  constructor(port, now = Date.now) { this.port = port; this.now = now; this.plans = new Map(); this.results = new Map(); this.busy = false; }
  fields(form) {
    const result = publicFields(form, form.policy), fields = [];
    for (const field of result.fields) {
      if (this.port.allows(form, field.path, field.value)) fields.push(field);
      else result.omitted.push({ path: field.path, reason: 'not-native-editable' });
    }
    return { fields, omitted: result.omitted };
  }
  async catalog() {
    const s = await this.port.snapshot();
    return {
      packages: s.packages.map(({ name, version, source, enabled, readonly, reason }) => ({ name, version, source, enabled, readonly, reason })),
      forms: s.forms.map(f => ({ package: f.package, row: f.row, module: f.module, builtin: f.builtin, ...this.fields(f) })),
      warnings: s.warnings,
    };
  }
  async generate(request) {
    closed(request, ['packages', 'forms', 'omit', 'mode', 'name'], 'export request');
    if (!['plugins', 'settings'].includes(request.mode)) fail('mode', 'Choose plugins or settings.');
    const selected = new Set(array(request.packages, 'selected packages', 128).map(n => text(n, 'package')));
    const selectedForms = new Set(array(request.forms ?? [], 'selected forms').map(n => text(n, 'form', 2000)));
    const omit = array(request.omit ?? [], 'omitted fields', 2048);
    for (const o of omit) { closed(o, ['form', 'path'], 'omitted field'); text(o.form, 'form', 2000); path(o.path); }
    const s = await this.port.snapshot(), packages = [];
    for (const name of selected) {
      const p = s.packages.find(p => p.name === name);
      if (!p || p.readonly || !p.source || p.reason) fail('package', `Cannot export ${name}; inspect its status in the plugin manager.`);
      packages.push({ name, version: p.version, source: p.source });
    }
    // Native order, not checkbox order or alphabetical UI card order.
    packages.sort((a, b) => s.packages.findIndex(p => p.name === a.name) - s.packages.findIndex(p => p.name === b.name));
    const blueprint = {
      kind: 'dsh-blueprint', formatVersion: 2, metadata: { name: text(request.name, 'name', 120), version: '1.0.0' },
      packages, bundles: s.order.filter(n => selected.has(n)),
    };
    const omitted = [];
    if (request.mode === 'settings') {
      blueprint.settings = [];
      for (const id of selectedForms) {
        const f = s.forms.find(f => identity(f) === id);
        if (!f || (!selected.has(f.package) && !f.builtin)) fail('form', 'Selected form is not available for the selected packages.');
        const result = this.fields(f);
        const fields = result.fields.filter(field => !omit.some(o => o.form === id && overlaps(o.path, field.path)));
        omitted.push(...result.omitted.map(o => ({ form: id, ...o })));
        if (fields.length) blueprint.settings.push({ package: f.package, row: f.row, module: f.module, fields });
      }
      blueprint.rows = s.rows.filter(r => selected.has(r.package) && !r.readonly)
        .map(({ package: pkg, row, module, enabled }) => ({ package: pkg, row, module, enabled }));
    }
    const checked = validate(blueprint);
    return { blueprint: checked, json: JSON.stringify(checked, null, 2), code: encode(checked), omitted, warnings: s.warnings };
  }
  async preview(request) {
    closed(request, ['text'], 'preview request');
    const bp = validate(decode(request.text));
    const s = await this.port.snapshot(), operations = [], blockers = [];
    const selected = new Set(bp.packages.map(p => p.name));
    for (const p of bp.packages) {
      const current = s.packages.find(x => x.name === p.name);
      if (current) {
        if (current.readonly || current.reason || current.source !== p.source || current.version !== p.version) blockers.push(`${p.name}: protected, unsupported source or different version; resolve it in the official manager first.`);
      } else if (p.source !== 'npm') blockers.push(`${p.name}: this host does not supply the requested built-in bundle.`);
      else {
        const inspected = await this.port.inspect(`${p.name}@${p.version}`);
        if (inspected.status !== 'accepted' || inspected.bundle !== true || inspected.name !== p.name || inspected.version !== p.version) blockers.push(`${p.name}: the official manager did not confirm this exact bundle.`);
        else operations.push({ type: 'install', name: p.name, version: p.version });
      }
    }
    const currentOrder = s.order.filter(n => selected.has(n));
    const reorder = !equal(currentOrder, bp.bundles);
    if (reorder) {
      for (const name of currentOrder) operations.push({ type: 'bundle', name, enabled: false });
      for (const name of bp.bundles) operations.push({ type: 'bundle', name, enabled: true });
    }
    const packageStage = operations.length > 0;
    const settingsRequested = (bp.settings?.length ?? 0) + (bp.rows?.length ?? 0) > 0;
    if (!packageStage) {
      for (const config of bp.settings ?? []) {
        const form = s.forms.find(f => identity(f) === identity(config));
        if (!form || (!selected.has(form.package) && !form.builtin)) { blockers.push(`${config.row}: no matching native editable Settings form on this host; custom configuration is not imported.`); continue; }
        const rules = policy(form.policy), edits = [];
        for (const field of config.fields) {
          const denied = (form.secrets ?? []).some(secret => overlaps(secret.path, field.path))
            || rules.exclude.some(p => overlaps(p, field.path))
            || rules.include !== null && !rules.include.some(p => prefix(p, field.path));
          if (denied || !this.port.allows(form, field.path, field.value)) { blockers.push(`${config.row}/${field.path.join('/')}: not a shareable editable field.`); continue; }
          if (equal(get(form.value, field.path), field.value)) continue;
          if (changesConnection(field.path, get(form.value, field.path), field.value)) {
            blockers.push(`${config.row}: changing a connection target while retaining a credential requires rebinding in the official configuration page.`); continue;
          }
          edits.push({ op: 'set', path: field.path, value: field.value });
        }
        if (edits.length) operations.push({ type: 'settings', package: config.package, row: config.row, module: config.module, revision: form.revision, edits });
      }
      for (const row of bp.rows ?? []) {
        const current = s.rows.find(r => identity(r) === identity(row));
        if (!current || current.readonly) { blockers.push(`${row.row}: unavailable or protected row.`); continue; }
        if (current.enabled !== row.enabled) operations.push({ type: 'row', entryId: current.entryId, row: row.row, enabled: row.enabled });
      }
    }
    // Inspection can involve network I/O. Bind the plan only if the observed profile stayed unchanged.
    if ((await this.port.snapshot()).stamp !== s.stamp) fail('stale', 'Profile changed while preparing the preview.');
    const result = {
      stage: packageStage ? 'packages' : 'settings', blockers,
      operations, next: packageStage && settingsRequested ? 'preview-settings' : null,
      order: reorder ? [...s.order.filter(n => !selected.has(n)), ...bp.bundles] : s.order,
      notice: 'No packages are removed. Native installation may execute previously approved package scripts. Enabling bundles executes plugin code. Settings are additive field edits, not a full environment clone.',
    };
    if (blockers.length) return { ...result, planId: null };
    for (const [id, p] of this.plans) if (p.expires <= this.now()) this.plans.delete(id);
    if (this.plans.size >= 8) fail('capacity', 'Too many outstanding previews. Let an old preview expire.');
    const planId = randomUUID();
    this.plans.set(planId, { ...result, stamp: s.stamp, expires: this.now() + 300_000 });
    return { ...result, planId };
  }
  async apply(planId, signal = new AbortController().signal) {
    text(planId, 'plan id');
    if (this.results.has(planId)) return this.results.get(planId);
    if (this.busy) fail('busy', 'A blueprint operation is already running.');
    const p = this.plans.get(planId);
    if (!p || p.expires <= this.now()) { this.plans.delete(planId); fail('expired', 'Preview expired or was already consumed.'); }
    this.busy = true;
    const report = { planId, status: 'applied', next: p.next, steps: [] };
    try {
      if ((await this.port.snapshot()).stamp !== p.stamp) fail('stale', 'Profile changed after preview.');
      this.plans.delete(planId);
      let stamp = p.stamp;
      for (const operation of p.operations) {
        if (signal.aborted) { report.status = 'interrupted'; break; }
        try {
          const before = await this.port.snapshot();
          if (before.stamp !== stamp) { report.status = 'conflict'; break; }
          const outcome = await this.port.execute(operation, signal);
          report.steps.push({ type: operation.type, target: operation.name ?? operation.row, outcome });
          if (outcome.application && outcome.application !== 'applied') { report.status = outcome.application; break; }
          const after = await this.port.snapshot();
          if (!this.port.verify(operation, after)) { report.status = 'verification-failed'; break; }
          stamp = after.stamp;
        } catch (e) {
          // Plugin validation errors can contain submitted values or credentials. Never echo arbitrary messages.
          if (report.steps.length === p.operations.indexOf(operation)) report.steps.push({ type: operation.type, target: operation.name ?? operation.row, outcome: { application: 'failed', code: 'operation-failed' } });
          report.status = 'failed'; break;
        }
      }
      if (report.status === 'applied') {
        try { if (!equal((await this.port.snapshot()).order, p.order)) report.status = 'verification-failed'; }
        catch { report.status = 'verification-failed'; }
      }
      report.remaining = p.operations.length - report.steps.length;
      if (report.status !== 'applied') report.next = null;
      this.results.set(planId, report);
      if (this.results.size > 8) this.results.delete(this.results.keys().next().value);
      return report;
    } finally { this.busy = false; }
  }
  dispose() { this.plans.clear(); this.results.clear(); }
}
