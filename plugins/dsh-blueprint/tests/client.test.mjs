import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function client(active = 'en', deferred = false) {
  let definition;
  const effects = [], listeners = new Map();
  const document = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    fire(type, event) { listeners.get(type)?.(event); },
  };
  const hooks = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
    useEffect(effect) { effects.push(effect); },
    useRef(initial) { return { current: initial ?? null }; },
  };
  vm.runInNewContext(source, { document, window: { __ModuleLoader__: { load(value) { definition = value; } } } });
  const registrations = [], injected = [], pending = [];
  const ctx = {
    locale: { getSnapshot: () => ({ active }), subscribe: () => () => {} },
    slots: {
      inject(name, register) { injected.push(name); if (deferred) pending.push(register); else register(); },
      register(options, render) { registrations.push({ options, render }); },
    },
  };
  definition.factory(name => {
    assert.equal(name, 'react');
    return hooks;
  }).apply(ctx);
  return { registrations, injected, pending, effects, document };
}

test('list action and own page register when their host slots become available', () => {
  const { registrations, injected, pending } = client('en', true);
  assert.deepEqual(injected, ['plugins.list.actions', 'plugins.bundle.config']);
  assert.equal(registrations.length, 0);
  pending.forEach(register => register());
  assert.deepEqual(registrations.map(x => x.options.name), injected);
  assert.equal(registrations[1].options.key, '@klarkxy/dsh-blueprint');
  assert.equal(registrations[0].render({}).type, registrations[1].render().type);
});

test('both locales expose one Blueprint menu with Import and Export', () => {
  for (const [locale, expected] of [
    ['en', ['Import blueprint', 'Export blueprint']],
    ['zh-CN', ['导入蓝图', '导出蓝图']],
  ]) {
    const { registrations } = client(locale);
    const component = registrations[0].render({});
    const tree = component.type(component.props);
    const menus = tree.children.find(x => x && x.type === 'div').children;
    assert.equal(menus.length, 1);
    assert.deepEqual(Array.from(menus[0].props.items, item => item.label), expected);
  }
});

test('menu stays within a narrow header and closes on Escape or outside click', () => {
  const { registrations, effects, document } = client();
  const action = registrations[0].render({});
  const tree = action.type(action.props);
  assert.equal(tree.props.style.WebkitAppRegion, 'no-drag');
  const menus = tree.children.find(x => x && x.type === 'div').children;
  const menu = menus[0].type(menus[0].props);
  assert.equal(menu.children[1].props.style.insetInlineStart, 0);
  assert.match(menu.children[1].props.style.background, /dsw-specific-menu/);
  let focused = false, prevented = false;
  const detail = { open: true, contains(target) { return target === this; }, querySelector() { return { focus() { focused = true; } }; } };
  menu.props.ref.current = detail;
  const cleanup = effects.at(-1)();
  document.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(detail.open, false);
  assert.equal(focused, true);
  assert.equal(prevented, true);
  detail.open = true;
  document.fire('pointerdown', { target: {} });
  assert.equal(detail.open, false);
  cleanup();
});

test('client contains no Settings UI or Settings-mode RPC contract', () => {
  assert.doesNotMatch(source, /settings|设置|forms|omit|readFile|mode:/i);
  assert.match(source, /call\('catalog', \{\}\)/);
  assert.match(source, /call\('generate', \{ name, packages: selected \}\)/);
  assert.match(source, /call\('preview', \{ text: source \}\)/);
});
