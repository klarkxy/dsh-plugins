// Path names identify dedicated stores, never entire agent/config directories.
// Content screening handles credentials embedded in otherwise ordinary files.
export function normalizedCredentialPath(path) {
  return String(path ?? '').replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase();
}

export function credentialSourcePath(path) {
  return normalizedCredentialPath(path).replace(/:(?:\$data|:\$data)$/i, '').replace(/[. ]+$/g, '')
    .replace(/(?:\.(?:bak|backup|old|orig|save|tmp)|\.corrupt-[a-z0-9_-]+|~)+$/g, '');
}

export function isCredentialPath(path) {
  const normalized = credentialSourcePath(path);
  const parts = normalized.split('/').filter(Boolean);
  const base = parts.at(-1) ?? '';
  if (/^(?:auth(?:entication)?|credentials?|\.credentials|tokens?|token-cache|access-tokens|refresh-tokens)\.(?:jsonc?|jsonl|ya?ml|toml|db|sqlite3?)$/.test(base)) return true;
  if (['credentials', '.netrc', '_netrc', '.git-credentials', '.dockercfg'].includes(base)) return true;
  if (parts.includes('.ssh') && /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|identity)$/.test(base)) return true;
  if (parts.includes('.gnupg') && (parts.includes('private-keys-v1.d') || /^(?:secring|secret-keys)\./.test(base))) return true;
  if (parts.includes('.aws') && (parts.includes('sso') && parts.includes('cache') || parts.includes('cli') && parts.includes('cache'))) return true;
  if (parts.includes('.azure') && /^(?:msal_token_cache|accesstokens)\./.test(base)) return true;
  if (parts.includes('gcloud') && /^(?:application_default_credentials\.json|credentials\.db|access_tokens\.db)$/.test(base)) return true;
  return /\.(?:p12|pfx)$/.test(base);
}

// Mutation protection deliberately remains stricter than read protection.
export const isMutationProtectedPath = path => /(?:^|[\\/])(?:\.git|\.ssh|\.aws|\.gnupg|\.codex|\.dsh|\.claude|\.agents|\.github|\.kube|\.azure|\.config)(?:[\\/]|$)|(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.npmrc|\.netrc|\.pypirc|\.gitconfig|\.bashrc|\.zshrc|\.profile|AGENTS(?:\.local)?\.md|CLAUDE\.md|id_rsa|id_ed25519|credentials)(?:[\\/]|$)|\.(?:pem|key|p12|pfx)$/i.test(String(path ?? ''));

export const isStructuredCredentialText = path => /\.(?:jsonc?|jsonl|ndjson|ya?ml|toml|ini|conf|config)$/.test(credentialSourcePath(path)) || /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.gitconfig|config)$/.test(credentialSourcePath(path));
