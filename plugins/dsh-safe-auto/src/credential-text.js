import { createScanner, parseTree, SyntaxKind } from 'jsonc-parser';
import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, Parser } from 'yaml';
import { parseTOML } from 'toml-eslint-parser';
import { Buffer } from 'node:buffer';
import { credentialSourcePath } from './credential-paths.js';

const SAFE_ERROR = 'Credential text could not be safely redacted.';
const fail = () => { throw new Error(SAFE_ERROR); };
const whitespace = character => /\s/u.test(character);

/** Match credential names, rather than words such as model, keybindings or token limits. */
export function isCredentialField(name) {
  if (typeof name !== 'string') return false;
  const normalized = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
    .replace(/[^a-z\d]+/g, '_').replace(/^_+|_+$/g, '');
  return /(?:^|[/:])_auth$/i.test(name) || /(?:^|_)(?:api_key|apikey|auth_token|access_token|refresh_token|id_token|api_token|bearer_token|session_token|security_token|personal_access_token|client_secret|client_key_data|secret_key|secret_access_key|access_key_id|access_key|private_key|privatekey|password|passwd|passphrase|authorization|proxy_authorization|cookie|set_cookie|secret|token)$/.test(normalized);
}

function isReference(value) {
  const text = value.trim();
  const header = /^(?:Bearer|Basic)[ \t]+(.+)$/i.exec(text);
  if (header) return isReference(header[1]);
  return !text || /^(?:\*+|\.{3}|\[redacted\]|<redacted>|redacted|null|none|undefined)$/i.test(text)
    || /^(?:\$\{(?:env:)?[\w.]+\}|\$(?:env:)?[\w.]+|%[\w]+%|\$?\{\{\s*(?:env|secrets)\.[\w.]+\s*\}\}|(?:env:|process\.env\.)[\w.]+)$/i.test(text)
    || /^<(?:your[_ -]?)?(?:api[_ -]?key|token|password|secret|private[_ -]?key)>$/i.test(text)
    || /^<[A-Z][A-Z\d_]*>$/.test(text)
    || /^(?:(?:your|example|placeholder|dummy|fake|test)[_-])?(?:api[_-]?key|token|password|secret)(?:[_-](?:here|placeholder|example))?$/i.test(text)
    || /^(?:replace[-_ ]?me|change[-_ ]?me|placeholder|dummy|example|not[-_ ]a[-_ ]real[-_ ](?:key|token|secret)|sk-(?:placeholder|your[-_]?(?:key|api[-_]?key)|example))$/i.test(text)
    || /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|file:\/\/)[^\r\n]+$/.test(text)
    || /^(?:[\\/]|\.[\w-]+[\\/])[^\r\n]*\.(?:jsonc?|ya?ml|toml|pem|key|txt|env)$/i.test(text);
}

function addRange(ranges, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) fail();
  if (end > start) ranges.push([start, end]);
}

function literalRanges(text) {
  const ranges = [];
  // URL parsing validates the authority; source offsets preserve the original
  // username, host, path and percent encoding without URL reserialization.
  for (const match of text.matchAll(/\b[A-Za-z][A-Za-z\d+.-]*:\/\//g)) {
    const start = match.index + match[0].length;
    const tail = text.slice(start);
    const authorityEnd = /[/?#\\\s"'`<>]/.exec(tail)?.index ?? tail.length;
    const authority = tail.slice(0, authorityEnd);
    const at = authority.lastIndexOf('@');
    const colon = authority.indexOf(':');
    if (at < 0 || colon < 0 || colon >= at || colon + 1 === at) continue;
    try { new URL(match[0] + authority + '/'); } catch { fail(); }
    const password = authority.slice(colon + 1, at);
    let decoded = password;
    try { decoded = decodeURIComponent(password); } catch { /* Invalid percent escapes are still password payload. */ }
    if (!isReference(decoded)) addRange(ranges, start + colon + 1, start + at);
  }
  const token = /\b(?:sk-[A-Za-z\d_-]{8,}|gh[pousr]_[A-Za-z\d_]{8,}|github_pat_[A-Za-z\d_]{8,}|glpat-[A-Za-z\d_-]{8,}|xox[baprs]-[A-Za-z\d_-]{8,}|npm_[A-Za-z\d]{8,}|(?:AKIA|ASIA)[A-Z\d]{16}|AIza[A-Za-z\d_-]{20,}|SG\.[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,}|eyJ[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,})(?![A-Za-z\d_-])/g;
  for (const match of text.matchAll(token)) {
    if (!isReference(match[0])) addRange(ranges, match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/\bBearer[ \t]+([^\s"'`,;<>]+)/gi)) {
    if (!isReference(match[1])) {
      const start = match.index + match[0].length - match[1].length;
      addRange(ranges, start, start + match[1].length);
    }
  }
  for (const match of text.matchAll(/\bBasic[ \t]+([A-Za-z\d+/]+={0,2})(?![A-Za-z\d+/=])/gi)) {
    const payload = match[1];
    const bytes = Buffer.from(payload, 'base64');
    const colon = bytes.indexOf(0x3a);
    // A Basic credential is base64(user:password), not any word after Basic.
    if (bytes.toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')
      || colon < 0 || colon + 1 >= bytes.length || bytes.some(byte => byte < 0x20 || byte === 0x7f)) continue;
    const start = match.index + match[0].length - payload.length;
    addRange(ranges, start, start + payload.length);
  }
  const pem = /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----/g;
  for (const match of text.matchAll(pem)) {
    const start = match.index + match[0].length;
    const end = text.indexOf(`-----END ${match[1]}-----`, start);
    if (end < 0) fail();
    addRange(ranges, start, end);
  }
  return ranges;
}

// ENV/INI have no shared grammar. This scanner only recognizes assignments to
// credential names; comments and all other keys retain their original bytes.
function assignmentRanges(text, mode = 'plain') {
  const ranges = [];
  const assignment = mode === 'config'
    ? /^[ \t]*(?:[#;][ \t]*)?(?:export[ \t]+)?(?:((?:[A-Za-z_]|\/\/)[\w./:@-]*)|"([^"\r\n]+)"|'([^'\r\n]+)')[ \t]*[=:][ \t]*/gm
    : /(?:^|[\s{,;])(?:((?:\$?(?:env:)?)[A-Za-z_][\w.-]*)|"((?:\\.|[^"\\\r\n])+)"|'([^'\r\n]+)')[ \t]*([=:])[ \t]*/gm;
  for (const match of text.matchAll(assignment)) {
    let name = match[1] ?? match[2] ?? match[3];
    if (mode === 'plain' && match[2]) {
      try { name = JSON.parse(`"${name}"`); } catch { continue; }
    }
    if (!isCredentialField(name)) continue;
    const start = match.index + match[0].length;
    // In ordinary prose, an authorization heading may describe permission.
    if (mode === 'plain' && /(?:authorization|cookie)$/i.test(name) && match[4] === ':'
      && !/^(?:["']|Bearer\b|Basic\b|[\w-]+=)/i.test(text.slice(start))) continue;
    const quote = text[start];
    let end, contentStart = start;
    if (quote === '"' || quote === "'") {
      contentStart++;
      end = contentStart;
      while (end < text.length) {
        if (text[end] === quote) break;
        if (text[end] === '\\' && quote === '"') end++;
        end++;
      }
      if (end >= text.length) fail();
      if (mode === 'config') {
        const nextLine = text.indexOf('\n', end);
        const remainder = text.slice(end + 1, nextLine < 0 ? text.length : nextLine).trim();
        if (remainder && !/^[#;]/.test(remainder)) fail();
      }
    } else {
      end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      const tail = text.slice(start, end);
      if (mode === 'config') {
        const stop = /[ \t]+[#;]/.exec(tail);
        if (stop) end = start + stop.index;
      } else if (!/(?:^|[_.-])cookie$/i.test(name)) {
        const prefix = /^(?:(?:Bearer|Basic)[ \t]+)?(?:\$\{[^}\r\n]+\}|\{\{[^}\r\n]+\}\}|[^\s,;}]+)/i.exec(tail);
        if (prefix) end = start + prefix[0].length;
      }
    }
    const value = text.slice(contentStart, end).trimEnd();
    let decoded = value;
    if (quote === '"') {
      try { decoded = JSON.parse(`"${value}"`); } catch { /* ENV permits literal newlines and non-JSON escapes. */ }
    }
    if (!isReference(decoded)) addRange(ranges, contentStart, contentStart + value.length);
  }
  return ranges;
}

// The parser owns the grammar and decoded value. This only maps decoded scalar
// characters back to source spans, so escaped literals can be masked in place.
function sourceUnits(text, start, end, style) {
  const units = [];
  const simple = style === 'yaml' ? { '0': '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' }
    : { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '/': '/', '\\': '\\' };
  for (let i = start; i < end; i++) {
    const begin = i;
    let decoded = text[i];
    if (style === 'yaml-single' && text[i] === "'" && text[i + 1] === "'") i++;
    else if (['json', 'toml', 'yaml'].includes(style) && text[i] === '\\') {
      const escaped = text[++i];
      const length = escaped === 'u' ? 4 : escaped === 'U' && style !== 'json' ? 8 : escaped === 'x' && style === 'yaml' ? 2 : 0;
      if (length) {
        const digits = text.slice(i + 1, i + length + 1);
        if (digits.length !== length || !/^[\da-f]+$/i.test(digits)) fail();
        const code = Number.parseInt(digits, 16);
        if (code > 0x10ffff) fail();
        decoded = String.fromCodePoint(code); i += length;
      } else if (Object.hasOwn(simple, escaped)) decoded = simple[escaped];
      else if (style !== 'json' && /\s/u.test(escaped)) {
        while (i + 1 < end && /\s/u.test(text[i + 1])) i++;
        continue;
      } else fail();
    }
    for (let j = 0; j < decoded.length; j++) units.push({ character: decoded[j], start: begin, end: i + 1 });
  }
  return units;
}

function maskDecodedLiterals(text, decoded, start, end, style, ranges) {
  const matches = [...literalRanges(decoded), ...assignmentRanges(decoded)];
  if (!matches.length) return;
  const units = sourceUnits(text, start, end, style).filter(unit => !whitespace(unit.character));
  const map = new Map();
  let position = 0;
  for (let i = 0; i < decoded.length; i++) {
    if (whitespace(decoded[i])) continue;
    if (units[position]?.character !== decoded[i]) fail();
    map.set(i, units[position++]);
  }
  if (position !== units.length) fail();
  for (const [from, to] of matches) {
    let first, last;
    for (let i = from; i < to; i++) {
      if (map.has(i)) { first ??= map.get(i); last = map.get(i); }
    }
    if (first) addRange(ranges, first.start, last.end);
  }
}

function scalar(text, value, start, end, style, sensitive, ranges) {
  if (sensitive && typeof value === 'string' && !isReference(value)) addRange(ranges, start, end);
  else if (typeof value === 'string') maskDecodedLiterals(text, value, start, end, style, ranges);
  else if (sensitive && value != null && typeof value !== 'boolean') addRange(ranges, start, end);
}

function jsonRanges(text, ranges, offset = 0) {
  const errors = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true });
  if (errors.length) fail();
  const local = [];
  const queue = root ? [[root, false, []]] : [];
  while (queue.length) {
    const [node, sensitive, path] = queue.pop();
    if (node.type === 'object') {
      for (const property of node.children ?? []) {
        if (property.type !== 'property' || property.children?.length !== 2) fail();
        const [key, value] = property.children;
        // Docker's auths registry entries use an otherwise ordinary auth key.
        const registryCredential = path.length === 2 && path[0] === 'auths'
          && ['auth', 'identitytoken', 'registrytoken'].includes(key.value);
        queue.push([value, sensitive || registryCredential || isCredentialField(key.value), [...path, key.value]]);
      }
    } else if (node.type === 'array') {
      for (const [index, child] of (node.children ?? []).entries()) queue.push([child, sensitive, [...path, index]]);
    } else {
      const quoted = node.type === 'string';
      scalar(text, node.value, node.offset + Number(quoted), node.offset + node.length - Number(quoted), 'json', sensitive, local);
    }
  }
  const scanner = createScanner(text, false);
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    if ([SyntaxKind.LineCommentTrivia, SyntaxKind.BlockCommentTrivia].includes(kind)) {
      const start = scanner.getTokenOffset(), comment = text.slice(start, start + scanner.getTokenLength());
      for (const [from, to] of literalRanges(comment)) addRange(local, start + from, start + to);
      for (const [from, to] of assignmentRanges(comment)) addRange(local, start + from, start + to);
    }
  }
  for (const [start, end] of local) addRange(ranges, start + offset, end + offset);
}

function yamlRanges(text, ranges) {
  const docs = parseAllDocuments(text, { keepSourceTokens: true, strict: true, uniqueKeys: true });
  for (const doc of docs) {
    if (doc.errors.length || doc.warnings.length) fail();
    const seen = new WeakMap();
    const queue = doc.contents ? [[doc.contents, false]] : [];
    const keyName = key => {
      if (isAlias(key)) key = key.resolve(doc);
      if (!isScalar(key)) fail();
      return String(key.value ?? '');
    };
    while (queue.length) {
      const [node, sensitive] = queue.pop();
      if (!node) continue;
      const bit = sensitive ? 2 : 1;
      if ((seen.get(node) ?? 0) & bit) continue;
      seen.set(node, (seen.get(node) ?? 0) | bit);
      if (isAlias(node)) {
        const origin = node.resolve(doc);
        if (!origin) fail();
        queue.push([origin, sensitive]);
      } else if (isMap(node)) {
        for (const pair of node.items) queue.push([pair.value, sensitive || isCredentialField(keyName(pair.key))]);
      } else if (isSeq(node)) {
        for (const item of node.items) queue.push([item, sensitive]);
      } else if (isScalar(node)) {
        if (!node.range) fail();
        let [start, end] = node.range;
        let style = 'literal';
        if (node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE') {
          start++; end--; style = node.type === 'QUOTE_DOUBLE' ? 'yaml' : 'yaml-single';
        } else if (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') {
          if (node.srcToken?.type !== 'block-scalar') fail();
          start = node.srcToken.offset + node.srcToken.props.reduce((total, prop) => total + prop.source.length, 0);
          end = start + node.srcToken.source.length;
        }
        if (node.value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof node.value)) fail();
        scalar(text, node.value, start, end, style, sensitive, ranges);
      } else fail();
    }
  }
  // Comments are outside AST value ranges. Restrict recognition to comment text.
  // A # within a quoted or block value must not be misread as a comment.
  const comments = [];
  const collect = token => {
    if (!token || typeof token !== 'object') return;
    if (token.type === 'comment') comments.push(token);
    for (const [key, value] of Object.entries(token)) {
      if (key === 'source') continue;
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') collect(value);
    }
  };
  for (const token of new Parser().parse(text)) collect(token);
  for (const token of comments) {
    for (const [start, end] of [...literalRanges(token.source), ...assignmentRanges(token.source)]) {
      addRange(ranges, token.offset + start, token.offset + end);
    }
  }
}

function tomlRanges(text, ranges) {
  const root = parseTOML(text, { tomlVersion: '1.0' });
  const queue = [[root, false]];
  while (queue.length) {
    const [node, sensitive] = queue.pop();
    if (node.type === 'TOMLKeyValue') {
      const names = node.key.keys.map(key => key.name ?? key.value);
      queue.push([node.value, sensitive || names.some(isCredentialField)]);
    } else if (node.type === 'TOMLTable') {
      const inherited = sensitive || node.resolvedKey.some(isCredentialField);
      for (const child of node.body) queue.push([child, inherited]);
    } else if (['Program', 'TOMLTopLevelTable', 'TOMLInlineTable'].includes(node.type)) {
      for (const child of node.body) queue.push([child, sensitive]);
    } else if (node.type === 'TOMLArray') {
      for (const child of node.elements) queue.push([child, sensitive]);
    } else if (node.type === 'TOMLValue') {
      let [start, end] = node.range;
      let style = 'literal';
      if (node.kind === 'string') {
        const delimiter = node.multiline ? 3 : 1;
        start += delimiter; end -= delimiter;
        style = node.style === 'basic' ? 'toml' : 'literal';
      }
      scalar(text, node.value, start, end, style, sensitive, ranges);
    } else fail();
  }
  for (const comment of root.comments) {
    const source = text.slice(...comment.range);
    for (const [start, end] of [...literalRanges(source), ...assignmentRanges(source)]) {
      addRange(ranges, comment.range[0] + start, comment.range[0] + end);
    }
  }
}

/** Pure value redaction. Offsets are UTF-16 and every original newline survives. */
export function redactCredentialText(text, filename = '') {
  try {
    if (typeof text !== 'string' || typeof filename !== 'string' || /\0/.test(text)) fail();
    const sourcePath = credentialSourcePath(filename);
    const base = sourcePath.split('/').pop();
    const ranges = [];
    if (/\.(?:jsonl|ndjson)$/.test(base)) {
      let offset = 0;
      for (const line of text.split('\n')) { jsonRanges(line, ranges, offset); offset += line.length + 1; }
    } else if (/\.jsonc?$/.test(base)) jsonRanges(text, ranges);
    else if (/\.ya?ml$/.test(base) || /(?:^|\/)\.kube\/config$/.test(sourcePath)) yamlRanges(text, ranges);
    else if (/\.toml$/.test(base)) tomlRanges(text, ranges);
    else if (/\.(?:json5|xml|plist|hcl|tfvars|edn)$/.test(base)) fail();
    else if (/^[\s\uFEFF]*(?:\{|\[\s*(?:\{|"))/.test(text)) jsonRanges(text, ranges);
    else {
      const config = /^(?:\.env(?:\..*)?|\.npmrc|\.gitconfig|\.pypirc|credentials|config)$/.test(base)
        || /\.(?:env|ini|conf|cfg|properties)$/.test(base);
      ranges.push(...literalRanges(text), ...assignmentRanges(text, config ? 'config' : 'plain'));
    }
    const masked = new Uint8Array(text.length);
    for (const [start, end] of ranges) {
      if (end > text.length) fail();
      masked.fill(1, start, end);
    }
    let redacted = false;
    const result = text.split('');
    for (let i = 0; i < result.length; i++) {
      if (masked[i] && !whitespace(result[i]) && result[i] !== '*') { result[i] = '*'; redacted = true; }
    }
    return { text: result.join(''), redacted };
  } catch { throw new Error(SAFE_ERROR); }
}
