import test from 'node:test';
import assert from 'node:assert/strict';
import { isCredentialField, redactCredentialText } from '../src/credential-text.js';

const mask = value => value.replace(/\S/gu, character => '*'.repeat(character.length));
function check(source, expected, filename = '') {
  const result = redactCredentialText(source, filename);
  assert.deepEqual(result, { text: expected, redacted: source !== expected });
  assert.equal(result.text.length, source.length, 'UTF-16 length');
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n' || source[i] === '\r') assert.equal(result.text[i], source[i], `newline ${i}`);
    if (result.text[i] !== source[i]) assert.equal(result.text[i], '*', `only masking at ${i}`);
  }
  return result;
}
function rejects(source, filename) {
  assert.throws(() => redactCredentialText(source, filename), error => {
    assert.equal(error.message, 'Credential text could not be safely redacted.');
    assert.equal(error.cause, undefined);
    assert.ok(!String(error).includes('fictional-sensitive-value'));
    return true;
  });
}

test('GitHub workflow credential references stay readable', () => {
  const source = 'env:\n  API_KEY: ${{ secrets.API_KEY }}\n  TOKEN: ${{ env.ACCESS_TOKEN }}\n';
  check(source, source, '.github/workflows/check.yml');
});

test('credential field names are decoded/narrow and ordinary controls are not fields', () => {
  for (const name of ['apiKey', 'APIKey', 'env.API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'access_token', 'refreshToken', 'id_token', 'client_secret', 'password', 'privatekey', 'privateKey',
    'Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', '_auth', '_authToken', 'AWS_SECRET_ACCESS_KEY']) {
    assert.equal(isCredentialField(name), true, name);
  }
  for (const name of ['model', 'api_key_env', 'env_key', 'token_limit', 'max_tokens', 'tokens',
    'keybindings', 'public_key', 'publicKey', 'credential_path', 'credentialsFile', 'auth',
    'auth_type', 'tokenCount', 'passwordFile', 'private_key_path', 'secretEnabled', 'monkey',
    'key', 'client-key', 'certificate-authority-data', 'client-certificate-data']) {
    assert.equal(isCredentialField(name), false, name);
  }
  assert.equal(isCredentialField(null), false);
});

test('compact nested JSON masks only credential values, preserving keys and ordinary values', () => {
  const source = '{"model":"demo-model","env":{"OPENAI_API_KEY":"opaque-demo-value"},"headers":{"Authorization":"Bearer opaque-session-value","Cookie":"session=opaque-cookie"},"tokens":128,"public_key":"ssh-ed25519 PUBLIC"}';
  const expected = source.replace('opaque-demo-value', mask('opaque-demo-value'))
    .replace('Bearer opaque-session-value', mask('Bearer opaque-session-value'))
    .replace('session=opaque-cookie', mask('session=opaque-cookie'));
  check(source, expected, 'C:\\user\\.codex\\config.json');
});

test('escaped JSON names, escaped secret characters and astral UTF-16 spans are masked', () => {
  const source = '{"env":{"API\\u005fKEY":"fictional\\u002dvalue\\n😀"},"nested":{"pass\\u0077ord":"not\\\"safe"},"model":"😀demo"}\r\n';
  const expected = source.replace('fictional\\u002dvalue\\n😀', mask('fictional\\u002dvalue\\n😀'))
    .replace('not\\\"safe', mask('not\\\"safe'));
  check(source, expected, 'settings.json');
});

test('JSONC keeps comments, trailing commas and indentation while masking comment literals', () => {
  const source = '// ordinary API_KEY field name\r\n{\r\n  "apiKey": "opaque", // password="comment-secret"\r\n  "model": "demo", /* sk-abcdefghijklmnop */\r\n}\r\n';
  const expected = source.replace('"opaque"', `"${mask('opaque')}"`)
    .replace('comment-secret', mask('comment-secret')).replace('sk-abcdefghijklmnop', mask('sk-abcdefghijklmnop'));
  check(source, expected, 'config.jsonc');
});

test('JSON credential containers retain shape and key names while masking primitive payloads', () => {
  const source = '{"api_key":{"first":"opaque-one","list":["opaque-two",123,false,null]},"model":"demo"}';
  check(source, source.replace('opaque-one', mask('opaque-one')).replace('opaque-two', mask('opaque-two')).replace('123', '***'), 'config.json');
});

test('Docker auths payload is contextual and leaves auth modes and helper references intact', () => {
  const source = '{"auths":{"registry.example.test":{"auth":"base64userpass","identitytoken":"opaque-token"},"another.test":{"auth":"${REGISTRY_AUTH}"}},"credsStore":"desktop","credHelpers":{"registry.example.test":"pass"},"auth":"oauth","other":{"auth":"none"}}';
  const expected = source.replace('base64userpass', mask('base64userpass')).replace('opaque-token', mask('opaque-token'));
  check(source, expected, 'C:\\user\\.docker\\config.json');
  const escaped = '{"au\\u0074hs":{"registry.example.test":{"au\\u0074h":"opaque"}}}';
  check(escaped, escaped.replace('"opaque"', '"******"'), '.docker/config.json.bak');
  check('{"auth":"oauth","mode":{"auth":"basic"},"key":"keybinding"}', '{"auth":"oauth","mode":{"auth":"basic"},"key":"keybinding"}', '.dsh/config.json');
});

test('JSONL parses each complete record with exact CRLF and blank-line offsets', () => {
  const source = '{"role":"user","content":"continue work"}\r\n\r\n{"env":{"API_KEY":"opaque"},"model":"demo"}\n';
  check(source, source.replace('"opaque"', '"******"'), 'C:\\user\\.claude\\sessions\\run.jsonl');
  rejects('{"api_key":"fictional-sensitive-value"}\n{"broken":', 'run.jsonl');
});

test('ordinary agent configuration and credential references remain byte-identical', () => {
  const ordinary = {
    model: 'demo', api_key_env: 'OPENAI_API_KEY', env_key: 'ANTHROPIC_AUTH_TOKEN',
    max_tokens: 8192, token_limit: 2048, keybindings: { submit: 'ctrl+enter' },
    public_key: 'ssh-ed25519 AAAApublickey', credential_path: 'C:\\user\\.codex\\auth.json',
    auth: 'oauth', approval_policy: 'on-request', features: { multi_agent: true },
    env: { API_KEY: '${OPENAI_API_KEY}', ANTHROPIC_AUTH_TOKEN: '$env:ANTHROPIC_AUTH_TOKEN' },
  };
  const source = JSON.stringify(ordinary, null, 2);
  for (const directory of ['.codex', '.dsh', '.claude']) check(source, source, `C:\\user\\${directory}\\config.json`);
});

test('placeholders, environment interpolation and explicit credential file references survive', () => {
  for (const value of ['', '***', '[REDACTED]', '<YOUR_API_KEY>', 'your-api-key', 'replace-me',
    'placeholder', 'not-a-real-token', 'sk-placeholder', '${API_KEY}', '${env:OPENAI_API_KEY}',
    '$API_KEY', '$env:API_KEY', '%API_KEY%', '{{ secrets.API_KEY }}', 'env:API_KEY',
    'process.env.API_KEY', './auth.json', '~/.ssh/id_rsa', 'C:\\user\\auth.json']) {
    const source = JSON.stringify({ api_key: value, password: value });
    check(source, source, 'config.json');
  }
  const source = '{"api_key":"${API_KEY:-fictional-sensitive-value}"}';
  check(source, source.replace('${API_KEY:-fictional-sensitive-value}', mask('${API_KEY:-fictional-sensitive-value}')), 'config.json');
  const alternate = '{"api_key":"${API_KEY-fictional-sensitive-value}"}';
  check(alternate, alternate.replace('${API_KEY-fictional-sensitive-value}', mask('${API_KEY-fictional-sensitive-value}')), 'config.json');
});

test('recognizable literals inside ordinary JSON strings are masked without losing prose', () => {
  const source = '{"content":"Keep this sentence. sk-abcdefghijklmnop remains private. Bearer opaqueauthvalue","model":"demo"}';
  check(source, source.replace('sk-abcdefghijklmnop', mask('sk-abcdefghijklmnop')).replace('opaqueauthvalue', mask('opaqueauthvalue')), 'session.json');
});

test('escaped recognizable literals in JSON strings are mapped to exact source characters', () => {
  const source = '{"content":"Before \\u0073k-abcdefghijklmnop after.","ordinary":"api_key"}';
  check(source, source.replace('\\u0073k-abcdefghijklmnop', mask('\\u0073k-abcdefghijklmnop')), 'session.json');
});

test('field names used as scalar values or object keys are not themselves credentials', () => {
  const source = '{"names":["api_key","password","Authorization","Cookie","private_key"],"sk-abcdefghijklmnop":"ordinary","model":"demo"}';
  check(source, source, 'config.json');
  check('The api_key, password, and token fields are documented here.\n', 'The api_key, password, and token fields are documented here.\n', 'SKILL.md');
});

test('YAML decoded keys, quotes and multiline blocks preserve ordinary configuration', () => {
  const source = 'model: demo\r\n"API\\u005fKEY": "opaque"\r\nprivate_key: |- # explanation\r\n  first-secret\r\n  second-secret\r\nmax_tokens: 4096\r\n';
  const expected = source.replace('"opaque"', '"******"').replace('first-secret', mask('first-secret')).replace('second-secret', mask('second-secret'));
  check(source, expected, '.dsh/config.yaml');
});

test('extensionless Kubernetes YAML masks key data and multiline tokens, retaining public data and paths', () => {
  const source = 'apiVersion: v1\r\nclusters:\r\n- name: demo\r\n  cluster:\r\n    server: https://cluster.example.test\r\n    certificate-authority-data: PUBLIC-CA-DATA\r\nusers:\r\n- name: demo\r\n  user:\r\n    client-key-data: opaque-private-key-data\r\n    token: |\r\n      first-token-line\r\n      second-token-line\r\n    client-certificate-data: PUBLIC-CLIENT-CERTIFICATE\r\n    client-key: C:/user/.kube/client.key\r\ncurrent-context: demo\r\n';
  const expected = source.replace('opaque-private-key-data', mask('opaque-private-key-data'))
    .replace('first-token-line', mask('first-token-line')).replace('second-token-line', mask('second-token-line'));
  for (const filename of ['C:\\user\\.kube\\config', '.kube/config']) check(source, expected, filename);
  rejects('users:\n- user:\n    token: "fictional-sensitive-value', '.kube/config');
});

test('YAML aliases mask originating scalars, including aliases to credential containers', () => {
  const source = 'ordinary: &shared opaque-origin\nAPI_KEY: *shared\nother: *shared\ncontainer: &credentials { first: opaque-one, nested: [opaque-two, 7] }\nprivate_key: *credentials\nmodel: demo\n';
  const expected = source.replace('opaque-origin', mask('opaque-origin')).replace('opaque-one', mask('opaque-one')).replace('opaque-two', mask('opaque-two')).replace(', 7]', ', *]');
  check(source, expected, 'config.yml');
});

test('YAML alias keys and merge values cannot hide sensitive fields', () => {
  const source = 'name: &key API_KEY\n*key : opaque-secret\nbase: &base { password: opaque-password, model: demo }\nmerged: { <<: *base, max_tokens: 10 }\n';
  check(source, source.replace('opaque-secret', mask('opaque-secret')).replace('opaque-password', mask('opaque-password')), 'config.yml');
});

test('YAML free prose, escaped literals and comments retain exact nonsensitive text', () => {
  const source = '# sk-abcdefghijklmnop\ncontent: "Before \\u0073k-qrstuvwxyzabcdef after"\nnotes: >-\n  Keep this sentence.\n  Bearer opaqueauthvalue\n# password="comment-secret"\n';
  check(source, source.replace('sk-abcdefghijklmnop', mask('sk-abcdefghijklmnop'))
    .replace('\\u0073k-qrstuvwxyzabcdef', mask('\\u0073k-qrstuvwxyzabcdef'))
    .replace('opaqueauthvalue', mask('opaqueauthvalue')).replace('comment-secret', mask('comment-secret')), 'session.yaml');
});

test('YAML cycles terminate and preserve normal aliases', () => {
  const source = 'model: &model demo\nselected: *model\nloop: &loop { self: *loop, value: ordinary }\n';
  check(source, source, 'config.yaml');
});

test('explicit format names take precedence over JSON-looking flow/table syntax', () => {
  check('{ api_key: opaque, model: demo }\n', '{ api_key: ******, model: demo }\n', 'config.yaml');
  check('["headers"]\nAPI_KEY="opaque"\n', '["headers"]\nAPI_KEY="******"\n', 'config.toml');
});

test('backup suffixes retain structured parser selection and fail safely on malformed backups', () => {
  const yaml = 'model: demo\napi_key: |\n  first-secret\n  second-secret\n';
  const expectedYaml = yaml.replace('first-secret', mask('first-secret')).replace('second-secret', mask('second-secret'));
  const toml = 'model="demo"\nenv."API_KEY"="opaque"\n';
  const expectedToml = toml.replace('"opaque"', '"******"');
  for (const suffix of ['.bak', '.old', '.backup', '~', '.corrupt-a1b2.bak', '.orig', '.save', '.tmp', '.bak.old~']) {
    check(yaml, expectedYaml, `.dsh/config.yaml${suffix}`);
    check(toml, expectedToml, `.codex/config.toml${suffix}`);
    rejects('api_key: "fictional-sensitive-value', `.dsh/config.yaml${suffix}`);
    rejects('env."API_KEY"="fictional-sensitive-value', `.codex/config.toml${suffix}`);
  }
  check('token: |\n  opaque-token\n', 'token: |\n  ************\n', '.kube/config.corrupt-a1b2.bak');
});

test('TOML AST covers dotted/escaped keys, arrays, tables and multiline strings', () => {
  const source = 'model = "demo"\r\nenv."API\\u005fKEY" = "opaque"\r\n[headers]\r\nAuthorization = "Bearer opaqueauthvalue"\r\n[provider]\r\nprivate_key = """\r\nfirst-secret\r\nsecond-secret"""\r\nclient_secret = ["one-secret", "two-secret"]\r\noptions = { apiKey = "inline-secret", max_tokens = 32 }\r\n';
  const expected = source.replace('"opaque"', '"******"').replace('Bearer opaqueauthvalue', mask('Bearer opaqueauthvalue'))
    .replace('first-secret', mask('first-secret')).replace('second-secret', mask('second-secret'))
    .replace('one-secret', mask('one-secret')).replace('two-secret', mask('two-secret')).replace('inline-secret', mask('inline-secret'));
  check(source, expected, '.codex/config.toml');
});

test('TOML literals map escaped and continued strings without reserialization', () => {
  const source = '# password="comment-secret"\ncontent = "Before \\u0073k-abcdefghijklmnop after"\nmultiline = """Before sk-qrstuv\\\n   wxyzabcdef after"""\nordinary = \'api_key\'\n';
  const expected = source.replace('comment-secret', mask('comment-secret'))
    .replace('\\u0073k-abcdefghijklmnop', mask('\\u0073k-abcdefghijklmnop'))
    .replace('sk-qrstuv\\\n   wxyzabcdef', mask('sk-qrstuv\\\n   wxyzabcdef'));
  check(source, expected, 'session.toml');
});

test('ENV and INI assignment fallback keeps unrelated fields and comments', () => {
  const source = 'export OPENAI_API_KEY="opaque" # explanation\r\nANTHROPIC_AUTH_TOKEN=another-opaque\r\nMODEL=demo\r\nAPI_KEY_ENV=OPENAI_API_KEY\r\nMAX_TOKENS=8192\r\nPASSWORD=${PASSWORD}\r\n';
  check(source, source.replace('"opaque"', '"******"').replace('another-opaque', mask('another-opaque')), '.env.local');
  const npm = '//registry.npmjs.org/:_authToken=npm-demo-token\nalways-auth=true\nregistry=https://registry.npmjs.org/\n';
  check(npm, npm.replace('npm-demo-token', mask('npm-demo-token')), '.npmrc');
  check('//registry.npmjs.org/:_auth=opaque-base64\n', '//registry.npmjs.org/:_auth=*************\n', '.npmrc');
  const ini = '[user]\nname = ordinary\n[credential]\npassword = "opaque" ; explanatory comment\nhelper = manager\n';
  check(ini, ini.replace('"opaque"', '"******"'), '.gitconfig');
  check('# API_KEY="comment-secret"\nMODEL=demo\n', '# API_KEY="**************"\nMODEL=demo\n', '.env');
  const escaped = 'API_KEY="ends-with-backslash\\\\"\nMODEL=demo\n';
  check(escaped, escaped.replace('ends-with-backslash\\\\', mask('ends-with-backslash\\\\')), '.env');
});

test('multiline ENV values and PEM private payloads keep every newline position', () => {
  const source = 'PRIVATE_KEY="first\r\nsecond"\r\nMODEL=demo\r\n';
  check(source, source.replace('first\r\nsecond', mask('first\r\nsecond')), '.env');
  const privateKey = 'Ordinary text\n-----BEGIN RSA PRIVATE KEY-----\nYWJjZGVm\nZ2hpamts\n-----END RSA PRIVATE KEY-----\nAfter text\n';
  check(privateKey, privateKey.replace('YWJjZGVm\nZ2hpamts', mask('YWJjZGVm\nZ2hpamts')), 'session.md');
  const publicKey = '-----BEGIN PUBLIC KEY-----\nYWJjZGVm\n-----END PUBLIC KEY-----\n';
  check(publicKey, publicKey, 'public.pem');
});

test('unknown sessions and skills mask recognizable secrets while retaining ordinary prose', () => {
  const source = 'Task: inspect the .codex and .dsh configuration.\napi_key="opaque"\nAuthorization: user approved local tests\nUse ${API_KEY}; keep api_key_env and token_limit.\nBearer opaqueauthvalue\n# npm_abcdefghijklmnop\n';
  check(source, source.replace('"opaque"', '"******"').replace('opaqueauthvalue', mask('opaqueauthvalue')).replace('npm_abcdefghijklmnop', mask('npm_abcdefghijklmnop')), 'SKILL.md');
});

test('URL userinfo passwords are masked across formats while preserving user, host and path', () => {
  const url = 'https://fixture:fixturePassword@example.test/repo.git';
  const redactedUrl = 'https://fixture:***************@example.test/repo.git';
  for (const [source, filename] of [
    [`[remote "origin"]\n  url=${url}\n  fetch=+refs/heads/*:refs/remotes/origin/*\n`, '.git/config'],
    [JSON.stringify({ url, auth: 'oauth', model: 'demo' }), 'config.json'],
    [`{"content":"ordinary"}\r\n${JSON.stringify({ url })}\r\n`, 'session.jsonl'],
    [`url: "${url}"\nmodel: demo\n`, 'config.yaml'],
    [`url="${url}"\nmodel="demo"\n`, 'config.toml'],
    [`REPOSITORY=${url}\nMODEL=demo\n`, '.env'],
    [`Before ${url} after.\n`, 'session.md'],
    [`// ${url}\n{"model":"demo"}`, 'config.jsonc'],
  ]) check(source, source.replace(url, redactedUrl), filename);
  const escaped = '{"content":"Before https://fixture:fixture\\u0050assword@example.test/repo.git after."}';
  check(escaped, escaped.replace('fixture\\u0050assword', mask('fixture\\u0050assword')), 'session.json');
  for (const [source, filename] of [
    ['url: "https://fixture:fixture\\u0050assword@example.test/repo.git"\n', 'config.yaml'],
    ['url="https://fixture:fixture\\u0050assword@example.test/repo.git"\n', 'config.toml'],
  ]) check(source, source.replace('fixture\\u0050assword', mask('fixture\\u0050assword')), filename);
  const encoded = 'https://fixture:p%40ss%3Aword@example.test/repo.git';
  check(encoded, encoded.replace('p%40ss%3Aword', mask('p%40ss%3Aword')), 'session.md');
  for (const ordinary of ['https://example.test/repo.git', 'https://fixture@example.test/repo.git',
    'https://fixture:@example.test/repo.git', 'git@example.test:repo.git', 'https://fixture:${PASSWORD}@example.test/repo.git',
    'https://fixture:%24%7BPASSWORD%7D@example.test/repo.git', 'https://[::1]/repo.git']) {
    check(`Use ${ordinary}\n`, `Use ${ordinary}\n`, 'session.md');
  }
  rejects('https://fixture:fictional-sensitive-value@/repo.git', 'session.md');
});

test('plain authorization, cookies and unquoted environment references are complete values', () => {
  for (const value of ['${API_KEY}', '${env:API_KEY}', '{{ secrets.API_KEY }}', 'Bearer ${API_KEY}', 'Basic ${AUTH}']) {
    check(`api_key=${value}\n`, `api_key=${value}\n`, 'session.md');
  }
  check('Authorization: Bearer ${API_KEY}\n', 'Authorization: Bearer ${API_KEY}\n', 'session.md');
  check('Authorization: Basic opaqueauthvalue\n', `Authorization: ${mask('Basic opaqueauthvalue')}\n`, 'session.md');
  check('Cookie: session=opaque; other=another\n', `Cookie: ${mask('session=opaque; other=another')}\n`, 'session.md');
  check('{"Authorization":"Bearer ${API_KEY}"}', '{"Authorization":"Bearer ${API_KEY}"}', 'config.json');
});

test('Basic-auth literals validate base64 user:password payloads in plain and decoded text', () => {
  const payload = 'Zml4dHVyZTpmaXh0dXJl';
  check(`Authorization: Basic ${payload}`, `Authorization: ${mask(`Basic ${payload}`)}`, 'session.md');
  check(`Captured header Basic ${payload}.`, `Captured header Basic ${mask(payload)}.`, 'session.md');
  const json = JSON.stringify({ content: `Before Basic ${payload} after.`, model: 'demo' });
  check(json, json.replace(payload, mask(payload)), 'session.json');
  const escaped = '{"content":"Before Basic \\u005aml4dHVyZTpmaXh0dXJl after."}';
  check(escaped, escaped.replace('\\u005aml4dHVyZTpmaXh0dXJl', mask('\\u005aml4dHVyZTpmaXh0dXJl')), 'session.json');
  check('Basic Zml4dHVyZTpmaXh0dXJlLQ==', `Basic ${mask('Zml4dHVyZTpmaXh0dXJlLQ==')}`, 'session.md');
  for (const ordinary of ['Basic concepts', 'Basic dGVzdA==', 'Basic Zml4dHVyZTo=',
    'Basic ${AUTH}', 'Basic ${env:AUTH}', 'Basic <AUTH>', 'Basic placeholder']) {
    check(ordinary, ordinary, 'session.md');
    const record = JSON.stringify({ content: ordinary });
    check(record, record, 'session.json');
  }
});

test('well-known credential token families are masked in free text', () => {
  for (const token of ['sk-proj-abcdefghijklmnop', 'sk-ant-api03-abcdefghijklmnop', 'ghp_abcdefghijklmnop',
    'sk-abcdefghijklmnop-', 'glpat-abcdefghijklmnop_',
    'github_pat_abcdefghijklmnop', 'glpat-abcdefghijklmnop', 'xoxb-abcdefghijklmnop',
    'npm_abcdefghijklmnop', 'AKIAABCDEFGHIJKLMNOP', 'ASIAABCDEFGHIJKLMNOP',
    'AIzaabcdefghijklmnopqrstuv', 'SG.abcdefghijklmnop.qrstuvwxyzabcdef',
    'eyJabcdefghijklmnop.qrstuvwxyzabcdef.abcdefghijklmnop']) {
    check(`Before ${token} after.`, `Before ${mask(token)} after.`, 'session.log');
  }
});

test('malformed or unsupported structured formats produce only a generic safe error', () => {
  for (const [source, filename] of [
    ['{"API_KEY":"fictional-sensitive-value", broken}', 'config.json'],
    ['API_KEY: "fictional-sensitive-value', 'config.yaml'],
    ['API_KEY: *missing', 'config.yaml'],
    ['API_KEY: a\nAPI_KEY: fictional-sensitive-value', 'config.yaml'],
    ['API_KEY: !unknown fictional-sensitive-value', 'config.yaml'],
    ['API_KEY = "fictional-sensitive-value', 'config.toml'],
    ['<config><API_KEY>fictional-sensitive-value</API_KEY></config>', 'config.xml'],
    ['{ API_KEY: "fictional-sensitive-value" }', 'config.json5'],
    ['API_KEY="fictional-sensitive-value', '.env'],
    ['API_KEY="fictional-sensitive-value"trailing', '.env'],
    ['-----BEGIN PRIVATE KEY-----\nfictional-sensitive-value', 'session.md'],
  ]) rejects(source, filename);
  rejects('text\u0000fictional-sensitive-value', 'session.md');
  rejects(null, 'config.json');
});

test('empty structured files and ordinary large input are returned without arbitrary truncation', () => {
  for (const filename of ['config.json', 'session.jsonl', 'config.yaml', 'config.toml']) check('', '', filename);
  const source = 'Ordinary session text. api_key_env=OPENAI_API_KEY\n'.repeat(5000);
  check(source, source, 'session.log');
});
