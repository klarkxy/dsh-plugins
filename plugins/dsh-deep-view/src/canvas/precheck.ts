// Lightweight Host-side static precheck and non-echoing credential leak scan
// for `show_canvas` HTML files before or alongside first-paint rendering.
// The 5-pattern redacted secret scan floor is inspired by liliMozi/showcard
// (Agent Showcard 1.0 Specification §7.3, https://github.com/liliMozi/showcard).
import { Script } from 'node:vm'
import { parse, type DefaultTreeAdapterMap } from 'parse5'

type Document = DefaultTreeAdapterMap['document']
type Element = DefaultTreeAdapterMap['element']
type TextNode = DefaultTreeAdapterMap['textNode']

export type CanvasPrecheckCode =
  | 'js-syntax'
  | 'local-module-script'
  | 'base-href'
  | 'missing-asset'
  | 'svg-open-path-fill'
  | 'secret-pattern'

export type CanvasPrecheckFinding = {
  readonly code: CanvasPrecheckCode
  readonly severity: 'error' | 'warn'
  readonly file: string
  readonly line?: number
  readonly message: string
}

export type ReadPrecheckAsset = (relativePath: string) => Promise<{
  readonly exists: boolean
  readonly text?: string
}>

// 5-pattern credential floor adapted from liliMozi/showcard (Agent Showcard 1.0 §7.3).
// Matches are strictly redacted: only the rule category and 1-based line number are reported.
const SECRET_PATTERNS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { id: 'sk-* API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
  { id: 'GitHub token', pattern: /\bghp_[A-Za-z0-9]{36}\b/u },
  { id: 'PEM private key', pattern: /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/u },
  { id: 'Bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}\b/u },
]

const MAX_SECRETS_PER_FILE = 5
const MAX_SVG_WARNINGS = 3

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find(attr => attr.name === name)?.value
}

function isRelativeReference(reference: string): boolean {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/#?\\])/iu.test(reference) && !reference.includes('\0')
}

function normalizeRelativeAssetPath(reference: string): string {
  const index = reference.search(/[?#]/u)
  const withoutSuffix = index === -1 ? reference : reference.slice(0, index)
  return withoutSuffix.replace(/^(?:\.\/)+/u, '')
}

function hasExplicitFill(element: Element): boolean {
  if (attribute(element, 'fill') !== undefined) return true
  const style = attribute(element, 'style')
  return style !== undefined && /(?:^|;)\s*fill\s*:/iu.test(style)
}

function hasExplicitStroke(element: Element): boolean {
  if (attribute(element, 'stroke') !== undefined) return true
  const style = attribute(element, 'style')
  return style !== undefined && /(?:^|;)\s*stroke\s*:/iu.test(style)
}

/** Scan text for common hardcoded secret shapes without ever echoing matched secret text. */
export function scanCanvasSecrets(text: string, fileLabel: string): CanvasPrecheckFinding[] {
  const findings: CanvasPrecheckFinding[] = []
  const lines = text.split(/\r?\n/u)
  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineText = lines[idx]!
    if (lineText.length === 0 || lineText.length > 16_384) continue
    for (const rule of SECRET_PATTERNS) {
      if (rule.pattern.test(lineText)) {
        const line = idx + 1
        findings.push({
          code: 'secret-pattern',
          severity: 'warn',
          file: fileLabel,
          line,
          message: `Potential hardcoded credential (${rule.id}) detected at ${fileLabel}:${line} [redacted — remove secrets from canvas files].`,
        })
        if (findings.length >= MAX_SECRETS_PER_FILE) return findings
      }
    }
  }
  return findings
}

/** Parse-only classic JavaScript syntax check via `node:vm` (never executes user code). */
export function checkClassicScriptSyntax(code: string, fileLabel: string, lineOffset = 0): CanvasPrecheckFinding | undefined {
  if (code.trim() === '') return undefined
  try {
    // `new Script(...)` compiles the AST to check syntax only; it never runs the script.
    void new Script(code, { filename: fileLabel, lineOffset })
    return undefined
  } catch (error) {
    const rawStack = error instanceof Error && typeof error.stack === 'string' ? error.stack : ''
    const locMatch = new RegExp(`${escapeRegExp(fileLabel)}:(\\d+)`, 'u').exec(rawStack)
    const line = locMatch ? Number(locMatch[1]) : (lineOffset > 0 ? lineOffset + 1 : undefined)
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return {
      code: 'js-syntax',
      severity: 'error',
      file: fileLabel,
      ...(line !== undefined && Number.isFinite(line) ? { line } : {}),
      message: `JavaScript syntax error in ${fileLabel}${line !== undefined ? `:${line}` : ''} — ${reason}`,
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function inlineTextOf(element: Element): string {
  let out = ''
  for (const child of element.childNodes) {
    if (child.nodeName === '#text') out += (child as TextNode).value
  }
  return out
}

/**
 * Run fast static prechecks on an HTML document and its packed relative classic
 * `.js` / `.css` dependencies before returning `show_canvas` to the model.
 */
export async function precheckCanvasHtml(
  html: string,
  filePath: string,
  readAsset?: ReadPrecheckAsset,
): Promise<CanvasPrecheckFinding[]> {
  const findings: CanvasPrecheckFinding[] = [...scanCanvasSecrets(html, filePath)]
  const doc = parse(html, { sourceCodeLocationInfo: true })
  const queuedAssets: { kind: 'script' | 'stylesheet'; rawRef: string; cleanPath: string; line?: number }[] = []
  const seenAssets = new Set<string>()
  let hasBaseHref = false
  let svgWarnings = 0

  const visit = (node: Document | Element, inSvg: boolean, inheritedFill: boolean, inheritedStroke: boolean): void => {
    for (const child of node.childNodes) {
      const element = child as Element
      if (element.tagName === undefined) continue
      const tag = element.tagName.toLowerCase()
      const line = element.sourceCodeLocation?.startLine
      const nextSvg = inSvg || tag === 'svg'
      const nextFill = (nextSvg && hasExplicitFill(element)) || (inSvg && inheritedFill)
      const nextStroke = (nextSvg && hasExplicitStroke(element)) || (inSvg && inheritedStroke)

      if (tag === 'base' && attribute(element, 'href') !== undefined) {
        if (!hasBaseHref) {
          findings.push({
            code: 'base-href',
            severity: 'warn',
            file: filePath,
            ...(line !== undefined ? { line } : {}),
            message: `<base href> at ${filePath}${line !== undefined ? `:${line}` : ''} disables local .js/.css packing in the sandboxed canvas; remove <base> to pack relative files.`,
          })
        }
        hasBaseHref = true
      } else if (tag === 'script') {
        const type = attribute(element, 'type')?.trim().toLowerCase() ?? ''
        const src = attribute(element, 'src')?.trim()
        const isClassic = type === '' || type === 'text/javascript' || type === 'application/javascript'
        if (src !== undefined && src !== '') {
          if (type === 'module' && isRelativeReference(src)) {
            findings.push({
              code: 'local-module-script',
              severity: 'warn',
              file: filePath,
              ...(line !== undefined ? { line } : {}),
              message: `Local ES module script "${src}" at ${filePath}${line !== undefined ? `:${line}` : ''} is skipped by the opaque Blob sandbox; inline the script or use a classic <script src="...">.`,
            })
          } else if (isClassic && isRelativeReference(src)) {
            const cleanPath = normalizeRelativeAssetPath(src)
            if (/\.js$/iu.test(cleanPath) && !seenAssets.has(`script:${cleanPath}`)) {
              seenAssets.add(`script:${cleanPath}`)
              queuedAssets.push({ kind: 'script', rawRef: src, cleanPath, ...(line !== undefined ? { line } : {}) })
            }
          }
        } else if (isClassic) {
          const code = inlineTextOf(element)
          const startLine = element.sourceCodeLocation?.startTag?.endLine ?? line ?? 1
          const syntaxError = checkClassicScriptSyntax(code, filePath, Math.max(0, startLine - 1))
          if (syntaxError !== undefined) findings.push(syntaxError)
        }
      } else if (tag === 'link') {
        const rel = attribute(element, 'rel')?.toLowerCase().split(/\s+/u) ?? []
        const href = attribute(element, 'href')?.trim()
        if (rel.includes('stylesheet') && href !== undefined && isRelativeReference(href)) {
          const cleanPath = normalizeRelativeAssetPath(href)
          if (/\.css$/iu.test(cleanPath) && !seenAssets.has(`stylesheet:${cleanPath}`)) {
            seenAssets.add(`stylesheet:${cleanPath}`)
            queuedAssets.push({ kind: 'stylesheet', rawRef: href, cleanPath, ...(line !== undefined ? { line } : {}) })
          }
        }
      } else if (nextSvg && svgWarnings < MAX_SVG_WARNINGS && !nextFill) {
        if (tag === 'polyline' && (attribute(element, 'points') ?? '').trim() !== '') {
          svgWarnings += 1
          findings.push({
            code: 'svg-open-path-fill',
            severity: 'warn',
            file: filePath,
            ...(line !== undefined ? { line } : {}),
            message: `SVG <polyline> at ${filePath}${line !== undefined ? `:${line}` : ''} omits fill="none" and will render with a default black fill.`,
          })
        } else if (tag === 'path' && nextStroke) {
          const d = (attribute(element, 'd') ?? '').trim()
          if (d !== '' && !/[zZ]\s*$/u.test(d)) {
            svgWarnings += 1
            findings.push({
              code: 'svg-open-path-fill',
              severity: 'warn',
              file: filePath,
              ...(line !== undefined ? { line } : {}),
              message: `Open SVG <path> with stroke at ${filePath}${line !== undefined ? `:${line}` : ''} omits fill="none" and may render as a solid black shape.`,
            })
          }
        }
      }

      visit(element, nextSvg, nextFill, nextStroke)
    }
  }

  visit(doc, false, false, false)

  if (!hasBaseHref && readAsset !== undefined) {
    for (const item of queuedAssets) {
      let decodedRef = item.cleanPath
      try {
        decodedRef = decodeURIComponent(item.cleanPath)
      } catch {
        // Keep raw cleanPath when malformed percent-encoding appears.
      }
      const dep = await readAsset(decodedRef)
      if (!dep.exists) {
        findings.push({
          code: 'missing-asset',
          severity: 'error',
          file: filePath,
          ...(item.line !== undefined ? { line: item.line } : {}),
          message: `Relative ${item.kind} "${item.rawRef}" referenced at ${filePath}${item.line !== undefined ? `:${line}` : ''} is missing or unreadable.`,
        })
        continue
      }
      if (dep.text !== undefined) {
        findings.push(...scanCanvasSecrets(dep.text, decodedRef))
        if (item.kind === 'script') {
          const syntaxError = checkClassicScriptSyntax(dep.text, decodedRef, 0)
          if (syntaxError !== undefined) findings.push(syntaxError)
        }
      }
    }
  }

  return findings
}
