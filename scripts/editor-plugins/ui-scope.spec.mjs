import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const plugins = fileURLToPath(new URL('../../plugins/', import.meta.url))
// Independent of the CSS being checked: deriving roots from its selectors
// would allow a newly introduced global rule to approve itself.
const roots = {
  'dsh-context-cleaner': ['.lc-root'],
  'dsh-current-title': ['.ct-root'],
  'dsh-deep-view': ['.dvui-root'],
  'dsh-delegation': ['.dlg-root'],
  'dsh-dev-index': ['.dsh-di-root'],
  'dsh-font': ['.font-root'],
  'dsh-git-commit': ['.gcm-root'],
  'dsh-model-hub': ['.dsh-model-hub', '.dsh-model-hub-subagent'],
  'dsh-model-picker': ['.dsh-model-picker', '.dsh-model-picker-'],
  'dsh-model-route': ['.dsh-model-menu-'],
  'dsh-quick-review': ['.qrv-root'],
  'dsh-safe-auto': ['.dsh-safe-auto'],
  'dsh-secret-manager': ['.sm-root'],
  'dsh-session-manager': ['.dsh-free-chat'],
  'dsh-shortcuts': ['.shortcuts-root', '.shortcuts-fixed-root'],
  'dsh-unrestricted': ['[data-dsh-unrestricted-warning]'],
  'dsh-update': ['.dsh-upd-root'],
  'dsh-web-search-manager': ['.ws-root'],
  'dsh-workspace-folders': ['.workspace-folders'],
  'dsh-zhihu': ['.zhihu-panel', '.zs-page'],
}
const skip = new Set(['node_modules', 'lib', 'dist', 'coverage', 'test', 'tests'])
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || skip.has(entry.name)) return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path)
    if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(?:spec|test)\.|\.d\.ts$/.test(path)) return []
    // Ignore generated JS siblings of TypeScript sources.
    if (/\.js$/.test(path) && [path.slice(0, -3) + '.ts', path.slice(0, -3) + '.tsx'].some(existsSync)) return []
    return [path]
  })
}

// Commas inside :is() and attribute values do not separate selector branches.
function branches(text) {
  let depth = 0, quote = '', start = 0
  const result = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) { if (char === quote && text[index - 1] !== '\\') quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if ('(['.includes(char)) depth++
    else if (')]'.includes(char)) depth--
    else if (char === ',' && depth === 0) { result.push(text.slice(start, index).trim()); start = index + 1 }
  }
  return [...result, text.slice(start).trim()]
}
function scopedRules(input, allowed) {
  const css = input.replace(/\/\*[\s\S]*?\*\//g, '')
  const stack = [], problems = []
  let statement = '', quote = ''
  const rooted = branch => {
    // :where() contributes zero specificity, but every alternative still needs
    // a plugin root; accepting only one branch would let global selectors out.
    if (branch.startsWith(':where(')) {
      // Sibling combinators can leave the root. Keep this deliberately narrow:
      // new wrapped selectors containing +/~ need explicit review.
      if (/[+~]/.test(branch)) return false
      let depth = 1
      for (let index = 7; index < branch.length; index++) {
        if (branch[index] === '(') depth++
        else if (branch[index] === ')' && --depth === 0) {
          return branches(branch.slice(7, index)).every(rooted)
        }
      }
      return false
    }
    return allowed.some(root => branch.startsWith(root) &&
      (root.endsWith('-') || !/[\w-]/.test(branch[root.length] ?? '')))
  }
  for (let index = 0; index < css.length; index++) {
    const char = css[index]
    if (quote) {
      statement += char
      if (char === quote && css[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; statement += char; continue }
    if (char === '{') {
      const parent = stack.at(-1) ?? { scoped: false, descriptor: false }
      const head = statement.trim()
      const at = head.startsWith('@')
      const descriptor = parent.descriptor || /^@(?:keyframes|-webkit-keyframes|font-face|property)\b/.test(head)
      const scoped = parent.scoped || (!at && branches(head).every(rooted))
      if (!at && !descriptor && !scoped) problems.push(head)
      // An at-rule inherits scope; @media alone never establishes a root.
      stack.push({ scoped, descriptor })
      statement = ''
    } else if (char === '}') {
      if (!stack.length) problems.push('unmatched closing brace')
      stack.pop(); statement = ''
    } else if (char === ';') statement = ''
    else statement += char
  }
  if (stack.length) problems.push('unclosed block')
  return problems
}

// All current interpolation sites are declarations, shared sheets, or these
// literal roots. Unknown interpolation fails so new dynamic CSS needs review.
function interpolation(expression, source) {
  const text = expression.getText(source)
  if (text === 'FREE_CHAT_ROOT') return 'dsh-free-chat'
  if (text === 'WARNING_ATTRIBUTE') return 'data-dsh-unrestricted-warning'
  if (['modelMenuCss', 'currentTitleOwnCss'].includes(text)) return '' // checked at their definitions
  if (ts.isCallExpression(expression) &&
      ['officialUiCss', 'officialFocus', 'officialElevation', 'officialStrokedElevation'].includes(expression.expression.getText(source))) return ''
  throw new Error(`Unreviewed CSS interpolation: ${source.fileName}: ${text}`)
}
function sheets(path, text = readFileSync(path, 'utf8')) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const result = []
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const parts = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map(span => span.literal.text)] : [node.text]
      // These reviewed prompt constants contain {type: ...} wire examples,
      // never styles. Do not infer prose from content: a heading can also be
      // followed by CSS rules that browsers still apply.
      if (/[\\/]dsh-deep-view[\\/]src[\\/](?:prompt|skill)\.ts$/.test(path) &&
          ts.isVariableDeclaration(node.parent) &&
          ['DEEP_VIEW_PROMPT', 'DEEP_VIEW_SKILL'].includes(node.parent.name.getText(source))) return
      // The report calculator is a script, not a stylesheet. STUDY_REPORT_CSS
      // in the same file stays under the normal scope check.
      if (/[\\/]dsh-zhihu[\\/]src[\\/]study-report\.ts$/.test(path) &&
          ts.isVariableDeclaration(node.parent) &&
          node.parent.name.getText(source) === 'STUDY_PAGE_SCRIPT') return
      // CSS has a block with a declaration; incidental message templates do not.
      const cssLiteral = !ts.isStringLiteral(node) || /^\s*[.#\[&@:]/.test(node.text)
      if (cssLiteral && parts.some(part => /\{[^{}]*[\w-]+\s*:/.test(part))) {
        const text = ts.isTemplateExpression(node)
          ? node.head.text + node.templateSpans.map(span => interpolation(span.expression, source) + span.literal.text).join('')
          : node.text
        result.push(text)
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

describe('repository stylesheet scope', () => {
  it('checks authored CSS against each plugin root, including conditional groups', () => {
    const checked = new Set(), offenders = []
    for (const entry of readdirSync(plugins, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'dsh-plugin-kit') continue // generated recipe has its own guard
      for (const path of files(join(plugins, entry.name))) {
        for (const css of sheets(path)) {
          checked.add(entry.name)
          expect(roots[entry.name], `Declare the UI root for ${path}`).toBeDefined()
          for (const rule of scopedRules(css, roots[entry.name] ?? [])) offenders.push(`${path}: ${rule}`)
        }
      }
    }
    expect([...checked].sort()).toEqual(Object.keys(roots).sort())
    expect(offenders).toEqual([])
  })

  it('rejects global branches, root lookalikes, and unscoped conditional bodies', () => {
    for (const css of [
      '.root .ok, .bare { color: red }',
      '.root-other { color: red }',
      '@media (width < 500px) { .bare { color: red } }',
      '@supports (display: grid) { @media (width > 1px) { p { color: red } } }',
      '& .child { color: red }',
      ':where(.root, .bare) { color: red }',
      ':where(.root-other) { color: red }',
      ':where(.root + body) { color: red }',
      ':where(.root ~ *) { color: red }',
      ':where(.root) + body { color: red }',
    ]) expect(scopedRules(css, ['.root']), css).not.toEqual([])
  })

  it('distinguishes Markdown protocol examples from CSS without allowing unknown CSS interpolation', () => {
    expect(sheets('plugins/dsh-deep-view/src/prompt.ts', 'const DEEP_VIEW_PROMPT = `## Reply format\n{type:"table"}`')).toEqual([])
    expect(sheets('plugins/dsh-deep-view/src/skill.ts', 'const DEEP_VIEW_SKILL = `# Reference\n${COMMON}\n{type:"table"}`')).toEqual([])
    const headingCss = sheets('style.ts', 'const css = `# heading\n.root { color: red }\nbody { color: red }`')
    expect(headingCss).toHaveLength(1)
    expect(scopedRules(headingCss[0], ['.root'])).toContain('body')
    expect(sheets('style.ts', 'const css = `.root { color: red }`')).toEqual(['.root { color: red }'])
    expect(() => sheets('style.ts', 'const css = `.root { color: ${UNKNOWN} }`')).toThrow('Unreviewed CSS interpolation')
  })

  it('accepts scoped nesting and keyframes without letting later rules escape', () => {
    expect(scopedRules(':where(.root.mh-menu:not([data-menu-material]))::before { color: red }', ['.root'])).toEqual([])
    expect(scopedRules('.root { color: red; @media (width < 500px) { & .child, .other { display: grid } } }', ['.root'])).toEqual([])
    expect(scopedRules('@media (width < 500px) { .root .child { display: grid } }', ['.root'])).toEqual([])
    expect(scopedRules('@keyframes pulse { from { opacity: 0 } to { opacity: 1 } } .bare { color: red }', ['.root'])).toEqual(['.bare'])
    expect(scopedRules('.root :is(.a, .b) { content: "};{" }', ['.root'])).toEqual([])
  })
})
