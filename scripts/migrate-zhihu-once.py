#!/usr/bin/env python3
"""One-time, pinned Zhihu source migration. Only edits the selected checkout."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

MODE, ROOT = sys.argv[1], Path(sys.argv[2]).resolve()
NAME = '@klarkxy/dsh-zhihu'
VERSION = '0.1.7'
SOURCE_REVISION = '36eadb6fbae398a12dc21e7b2200dd06e2bf3f7b'

def read_json(p):
    return json.loads(p.read_text())

def write_json(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def replace(p, old, new, count=None):
    text = p.read_text()
    actual = text.count(old)
    if actual == 0 or (count is not None and actual != count):
        raise RuntimeError(f'{p}: expected {count or "at least one"} occurrences, got {actual}: {old!r}')
    p.write_text(text.replace(old, new))

BUTTON = '''
/** Prefer a structurally supplied host control; standalone Web needs no private UI package. */
export const ZhihuButton = forwardRef<HTMLButtonElement, HostButtonProps & { host?: HostButton }>(
  function ZhihuButton({ host, variant, className, ...rest }, ref) {
    if (host) {
      const Host = host as ComponentType<HostButtonProps & { ref?: Ref<HTMLButtonElement> }>
      return <Host ref={ref} variant={variant} className={className} {...rest} />
    }
    const variantClass = variant === 'primary'
      ? 'primary-action'
      : variant === 'danger'
        ? 'danger-action'
        : variant === 'icon'
          ? 'icon-button'
          : ''
    return <button ref={ref} type="button" className={[variantClass, className].filter(Boolean).join(' ')} {...rest} />
  },
)
'''

BUTTON_TEST = '''import { createRef, forwardRef, type ReactElement, type Ref } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ZhihuButton, type HostButton, type HostButtonProps } from './client-host-ui.tsx'

type Props = HostButtonProps & { host?: HostButton }
function render(props: Props, ref: Ref<HTMLButtonElement> = null) {
  return (ZhihuButton as unknown as {
    render(props: Props, ref: Ref<HTMLButtonElement>): ReactElement<Props & { ref?: Ref<HTMLButtonElement> }>
  }).render(props, ref)
}

describe('portable Zhihu button adapter', () => {
  it.each([
    [undefined, ''], ['default', ''], ['primary', 'primary-action'],
    ['danger', 'danger-action'], ['icon', 'icon-button'],
  ] as const)('keeps standalone variant %s without a host dependency', (variant, expected) => {
    const button = render({ variant, className: 'zhihu-button', children: '搜索' })
    expect(button.type).toBe('button')
    expect(button.props.type).toBe('button')
    expect(button.props.className).toBe([expected, 'zhihu-button'].filter(Boolean).join(' '))
    expect(button.props).not.toHaveProperty('host')
    expect(button.props).not.toHaveProperty('variant')
  })

  it('preserves native events, focus refs, disabled state and accessible tab properties', () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const button = render({ onClick, disabled: true, role: 'tab', tabIndex: -1,
      'aria-selected': true, 'aria-controls': 'zhihu-results', 'data-testid': 'zhihu-search' }, ref)
    expect((button as unknown as { ref: unknown }).ref).toBe(ref)
    expect(button.props).toMatchObject({ onClick, disabled: true, role: 'tab', tabIndex: -1,
      'aria-selected': true, 'aria-controls': 'zhihu-results', 'data-testid': 'zhihu-search' })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards host controls and refs without leaking the adapter-only host prop', () => {
    const Host = forwardRef<HTMLButtonElement, HostButtonProps>((props, ref) => <button ref={ref} {...props} />)
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const button = render({ host: Host, variant: 'primary', className: 'zhihu-button',
      disabled: true, onClick, 'aria-label': '搜索', children: '执行' }, ref)
    expect(button.type).toBe(Host)
    expect((button as unknown as { ref: unknown }).ref).toBe(ref)
    expect(button.props).toMatchObject({ variant: 'primary', className: 'zhihu-button',
      disabled: true, onClick, 'aria-label': '搜索', children: '执行' })
    expect(button.props).not.toHaveProperty('host')
  })

  it('defaults to a non-submitting button but preserves an explicit submit type', () => {
    expect(render({}).props.type).toBe('button')
    expect(render({ type: 'submit' }).props.type).toBe('submit')
  })

  it('renders standalone disabled and ARIA attributes through React', () => {
    const html = renderToStaticMarkup(<ZhihuButton variant="primary" disabled aria-label="搜索">查找</ZhihuButton>)
    expect(html).toContain('type="button"')
    expect(html).toContain('class="primary-action"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-label="搜索"')
    expect(html).not.toContain('variant=')
    expect(html).not.toContain('host=')
  })
})
'''

if MODE == 'plugins':
    SOURCE = Path(sys.argv[3]).resolve()
    src = SOURCE / 'packages/dsh-zhihu'
    dest = ROOT / 'plugins/dsh-zhihu'
    manifest = read_json(src / 'package.json')
    assert manifest['name'] == NAME and manifest['version'] == VERSION
    if dest.exists():
        raise RuntimeError('Destination already exists; refusing to overwrite migrated work')
    original_hashes = {str(p.relative_to(SOURCE)): hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in sorted(src.rglob('*')) if p.is_file()}
    shutil.copytree(src, dest)
    manifest['devDependencies'].pop('dsh-editor-seats')
    manifest['devDependencies']['react-dom'] = '^18.2.0'
    manifest['devDependencies']['@types/react-dom'] = '^18.3.1'
    manifest['scripts']['build'] = 'tsdown && node ../../scripts/editor-plugins/wrap-client.mjs @klarkxy/dsh-zhihu'
    manifest['scripts']['test'] = 'vitest run --root ../.. --config vitest.editor-plugins.config.ts --maxWorkers=2 plugins/dsh-zhihu/src'
    manifest['repository'] = {'type': 'git', 'url': 'git+https://github.com/klarkxy/dsh-plugins.git', 'directory': 'plugins/dsh-zhihu'}
    manifest['homepage'] = 'https://klarkxy.github.io/dsh-plugins/plugins/zhihu/'
    manifest['bugs'] = {'url': 'https://github.com/klarkxy/dsh-plugins/issues'}
    write_json(dest / 'package.json', manifest)
    config = read_json(dest / 'tsconfig.json')
    config['extends'] = '../../tsconfig.editor-plugins.json'
    config['exclude'] = ['src/**/*.spec.ts', 'src/**/*.spec.tsx']
    write_json(dest / 'tsconfig.json', config)
    replace(dest / 'tsdown.config.ts', ", alwaysBundle: ['dsh-editor-seats/seat-button']", '', 1)
    replace(dest / 'src/client.tsx', "import { SeatButton } from 'dsh-editor-seats/seat-button'", "import { ZhihuButton } from './client-host-ui.tsx'", 1)
    replace(dest / 'src/client.tsx', 'SeatButton', 'ZhihuButton')
    helper = dest / 'src/client-host-ui.tsx'
    replace(helper, 'import { type ChangeEvent,', 'import { forwardRef, type ChangeEvent,', 1)
    replace(helper, "  'aria-label'?: string\n  'aria-pressed'?: boolean", "  'aria-label'?: string\n  'aria-labelledby'?: string\n  'aria-controls'?: string\n  'aria-describedby'?: string\n  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time'\n  'aria-pressed'?: boolean", 1)
    helper.write_text(helper.read_text() + BUTTON)
    (dest / 'src/client-button.spec.tsx').write_text(BUTTON_TEST)
    for p in [dest / 'README.md', dest / 'docs/README.zh-CN.md']:
        text = p.read_text().replace('klarkxy/dsh-editor/blob/main/packages/dsh-zhihu', 'klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu')
        text = text.replace('https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md', 'https://github.com/klarkxy/dsh-plugins/blob/main/docs/editor-plugin-migration.md')
        if p.name == 'README.md':
            text += '\nThe client accepts structural host controls and has native HTML fallbacks. Building or using this package does not require application-private UI packages. Agent tools, credentials, RPC contracts and storage identifiers are unchanged.\n'
        else:
            text += '\n客户端接收宿主提供的结构化控件，缺失时使用原生 HTML 控件。构建和使用本包不依赖应用私有 UI 包；Agent 工具、凭据、RPC 合同和存储标识保持不变。\n'
        p.write_text(text)
    migration_path = ROOT / 'scripts/editor-plugin-migration.json'
    migration = read_json(migration_path)
    assert migration['holdPublish'] is True
    migration['packages'].append({'name': NAME, 'version': VERSION, 'directory': 'plugins/dsh-zhihu', 'sourceRevision': SOURCE_REVISION})
    migration['files'].update(original_hashes)
    migration['zhihuAdjustments'] = ['Replace the inlined private SeatButton import with a package-local structural host/native adapter.', 'Migrate build/test paths and documentation links; preserve all backend files and original package tests.']
    write_json(migration_path, migration)
    style_src = (SOURCE / 'scripts/client-style-ownership.spec.mjs').read_text()
    special = style_src[style_src.index("  it('recreates Zhihu styles"):style_src.rindex('})')]
    style = ROOT / 'scripts/editor-plugins/client-style-ownership.spec.mjs'
    replace(style, "import { apply as search } from '../../plugins/dsh-web-search-manager/src/client.tsx'", "import { apply as search } from '../../plugins/dsh-web-search-manager/src/client.tsx'\nimport { apply as zhihu } from '../../plugins/dsh-zhihu/src/client.tsx'", 1)
    replace(style, "[['@klarkxy/dsh-web-search-manager', search]]", "[['@klarkxy/dsh-web-search-manager', search], ['@klarkxy/dsh-zhihu', zhihu]]", 1)
    text = style.read_text()
    index = text.rindex('})')
    style.write_text(text[:index] + special + text[index:])
    catalog_path = ROOT / 'site/catalog.json'
    catalog = read_json(catalog_path)
    entries = catalog['plugins']
    entry = next(p for p in entries if p['package'] == NAME)
    entry['repository'] = 'https://github.com/klarkxy/dsh-plugins'
    entry['directory'] = 'plugins/dsh-zhihu'
    write_json(catalog_path, catalog)
    for p in [ROOT / 'README.md', ROOT / 'README.zh-CN.md']:
        replace(p, 'klarkxy/dsh-editor/tree/main/packages/dsh-zhihu', 'klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu', 1)
    replace(ROOT / 'README.md', 'Nine portable packages are now maintained under `plugins/`. Package names, runtime code and persisted settings are unchanged. Zhihu, manuscript, proofread and application-private packages remain in Editor.', 'Ten portable packages are now maintained under `plugins/`, including Zhihu. Package names, tool behavior and persisted settings are unchanged; Zhihu now uses a local structural control adapter instead of a private UI dependency. Manuscript, proofread and application-private packages remain in Editor.', 1)
    replace(ROOT / 'README.zh-CN.md', '9 个可独立运行的包迁入 `plugins/`，保留包名、运行时代码与持久化设置。知乎、稿纸、校对及应用私有包暂留 Editor。', '10 个可独立运行的包（含知乎）迁入 `plugins/`，保留包名、工具行为与持久化设置；知乎改用包内结构化控件适配，解除私有 UI 依赖。稿纸、校对及应用私有包暂留 Editor。', 1)
    doc = ROOT / 'docs/editor-plugin-migration.md'
    replace(doc, 'Nine public packages', 'Ten public packages', 1)
    replace(doc, '| dsh-web-search-manager | 0.1.7 |', '| dsh-web-search-manager | 0.1.7 |\n| dsh-zhihu | 0.1.7 |', 1)
    replace(doc, 'Package names, public exports, plugin IDs, runtime implementation, default toggles, storage-domain names and data formats are preserved. The extraction changes build/test paths and publishing ownership, not plugin behavior.', 'Package names, public exports, plugin IDs, backend implementation, default toggles, storage-domain names and data formats are preserved. Zhihu alone replaces its private SeatButton build import with a package-local structural host/native adapter, retaining classes, events, ref forwarding and accessibility props. Its tools, credentials and original tests are unchanged.', 1)
    replace(doc, 'Zhihu stays in Editor because its build still depends on Editor seats. Manuscript, proofread and all Editor-specific packages also stay there.', 'Zhihu is included from the pinned Editor consumer revision recorded on its migration entry. It has no private runtime, peer or development dependency. Existing optional settings/overlay slot names remain for host compatibility; they do not require Editor. Manuscript, proofread and all Editor-specific packages stay in Editor.', 1)
    replace(doc, 'The nine packages', 'The ten packages', 1)
    doc.write_text(doc.read_text() + '\n## Zhihu follow-up validation scope\n\nThe original Zhihu package tests and three stylesheet lifecycle regressions move with the source. New control-adapter tests cover hosted/native rendering, variants, events, refs, disabled and ARIA properties. The shared private-dependency guard includes Zhihu. The existing Editor pin remains the already-published 0.1.7 archive; this source refactor needs a later authorized release before consumers receive the new adapter. No live Zhihu request, credential migration or npm publication is performed. UI layout and stylesheet bytes are unchanged; real browser/Electron visual acceptance is not implied by unit/build results.\n')
    allowed = {'package.json', 'tsconfig.json', 'tsdown.config.ts', 'src/client.tsx', 'src/client-host-ui.tsx', 'README.md', 'docs/README.zh-CN.md'}
    for original in src.rglob('*'):
        if original.is_file() and str(original.relative_to(src)) not in allowed:
            assert original.read_bytes() == (dest / original.relative_to(src)).read_bytes(), original
    print('Zhihu copied; all original tests/backend/style bytes retained; publish gate remains closed.')
elif MODE == 'editor':
    source = ROOT / 'packages/dsh-zhihu'
    assert read_json(source / 'package.json')['name'] == NAME
    manifest = read_json(ROOT / 'package.json')
    manifest['devDependencies'][NAME] = VERSION
    write_json(ROOT / 'package.json', manifest)
    path = ROOT / 'apps/desktop/resources/external-plugins.json'
    pins = read_json(path)
    pins['packages'][NAME] = VERSION
    write_json(path, pins)
    config = read_json(ROOT / 'tsconfig.base.json')
    for name in [NAME + '/usage', NAME + '/contracts']:
        del config['compilerOptions']['paths'][name]
    write_json(ROOT / 'tsconfig.base.json', config)
    vitest = ROOT / 'vitest.config.ts'
    for suffix in ['usage', 'contracts']:
        replace(vitest, f"      '@klarkxy/dsh-zhihu/{suffix}': `${{root}}packages/dsh-zhihu/src/{suffix}.ts`,\n", '', 1)
    style = ROOT / 'scripts/client-style-ownership.spec.mjs'
    replace(style, "import { apply as zhihu } from '../packages/dsh-zhihu/src/client.tsx'\n", '', 1)
    replace(style, ", ['@klarkxy/dsh-zhihu', zhihu]", '', 1)
    text = style.read_text()
    start = text.index("  it('recreates Zhihu styles")
    style.write_text(text[:start] + '})\n')
    replace(ROOT / 'scripts/public-package-boundaries.spec.mjs', "['dsh-manuscript', '@klarkxy/dsh-zhihu']", "['dsh-manuscript']", 1)
    text = (ROOT / 'scripts/codemod/targets.txt').read_text()
    (ROOT / 'scripts/codemod/targets.txt').write_text(''.join(line for line in text.splitlines(keepends=True) if not line.startswith('packages/dsh-zhihu/')))
    for p, old in [(ROOT / 'README.md', '(packages/dsh-zhihu/docs/README.zh-CN.md)'), (ROOT / 'packages/README.md', '(dsh-zhihu/docs/README.zh-CN.md)'), (ROOT / 'docs/user-guide.md', '(../packages/dsh-zhihu/docs/README.zh-CN.md)')]:
        replace(p, old, '(https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/docs/README.zh-CN.md)', 1)
    replace(ROOT / 'packages/PUBLISHING.md', 'https://github.com/klarkxy/dsh-editor/tree/main/packages/dsh-zhihu', 'https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu', 1)
    replace(ROOT / 'docs/architecture.md', '9 个可移植公共插件', '10 个可移植公共插件（含知乎）', 1)
    doc = ROOT / 'docs/public-plugin-migration.md'
    replace(doc, '- @klarkxy/dsh-web-search-manager@0.1.7', '- @klarkxy/dsh-web-search-manager@0.1.7\n- @klarkxy/dsh-zhihu@0.1.7', 1)
    replace(doc, '知乎仍有 Editor 私有界面合同的构建依赖；稿纸和校对仍按本地 tarball 交付。这三项与所有 dsh-editor-* 包暂留本仓库。', '知乎一并迁出；新仓库解除其按钮控件对 Editor 私有包的构建依赖，保留工具、凭据、RPC、存储和可选界面插槽。稿纸、校对与所有 dsh-editor-* 包仍留本仓库。', 1)
    replace(doc, '这9个包', '这10个包', 1)
    doc.write_text(doc.read_text() + '\n## 知乎补充说明\n\nEditor 仍锁定已发布的 @klarkxy/dsh-zhihu@0.1.7 制品，包含原有预装界面和 Agent 工具，不需要先发布新版本。新仓库中的独立按钮适配会在后续获准发布并更新 pin 后进入桌面版，不能把源码迁入当成 npm 已更新。原有知乎包测试及样式生命周期测试迁往 dsh-plugins，Editor 继续检查外部制品和组合顺序。没有变更密钥、设置或用户数据。\n')
    replace(ROOT / 'CHANGELOG.md', '## 未发布\n', '## 未发布\n\n- 公共插件迁移：知乎与其他 9 个公共插件的源码、独立测试迁至 dsh-plugins；桌面继续使用精确版本的 npm 制品离线预装，不增加启动下载。\n', 1)
    test_path = ROOT / 'scripts/external-plugins.test.mjs'
    replace(test_path, 'import { mkdirSync, mkdtempSync, rmSync, writeFileSync }', 'import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync }', 1)
    test_path.write_text(test_path.read_text() + '''\ntest('Zhihu has one source owner and retains a pinned offline product input', () => {
  const root = new URL('../', import.meta.url);
  const name = '@klarkxy/dsh-zhihu';
  const pins = JSON.parse(readFileSync(new URL(EXTERNAL_PLUGIN_MANIFEST, root), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pins.packages[name], '0.1.7');
  assert.equal(pkg.devDependencies[name], pins.packages[name]);
  assert.equal(existsSync(new URL('packages/dsh-zhihu', root)), false);
  const config = JSON.parse(readFileSync(new URL('tsconfig.base.json', root), 'utf8'));
  assert.equal(Object.keys(config.compilerOptions.paths).some(key => key.startsWith(name)), false);
});
''')
    shutil.rmtree(source)
    print('Editor source removed; pinned archive/preinstallation retained; unit/style tests moved to source owner.')
else:
    raise RuntimeError('Expected plugins or editor')
