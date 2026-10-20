// Rejects any published artifact that still carries credential material.
//
// The app redacts before download and before publishing (src/utils/reportArtifact.ts),
// so a correctly produced artifact never changes when scanned here. This guard is a
// dependency-free port of the detection half of that redaction: the sensitive-key
// vocabulary, assignment and URL parameter scanning, Bearer/Basic credentials, JWTs
// and JSON-shaped strings, plus a few well-known API key shapes. Every rule flags a
// strict subset of what the app's redaction would rewrite (the key-shape rules are
// the one deliberate addition), so an artifact the app produced is always accepted
// and a hand-built one carrying `Authorization: Bearer …`, `?token=…` or a raw
// key is refused.

export const REDACTED_VALUE = '[REDACTED]';
const ENCODED_REDACTED_VALUE = '%5BREDACTED%5D';
const MAX_URL_COMPONENT_DECODE_PASSES = 4;
const MAX_URL_SCAN_DEPTH = 4;
const MAX_JSON_STRING_DECODE_PASSES = 4;

const EXACT_SENSITIVE_KEYS = new Set([
  'key', 'accesskey', 'subscriptionkey', 'authorization', 'proxyauthorization',
  'xmcpauthorization', 'cookie', 'setcookie', 'cookies', 'password', 'passwd', 'secret',
  'secrets', 'clientsecret', 'credential', 'credentials', 'accesstoken', 'refreshtoken',
  'idtoken', 'jwt', 'idtokenhint', 'clientassertion', 'devicecode', 'usercode', 'apikey',
  'xapikey', 'authorizationcode', 'authorizationcodes', 'oauthcode', 'oauthcodes', 'code',
  'token', 'tokens', 'sid', 'sessionid', 'phpsessid', 'connectsid', 'signature', 'sig',
  'privatekey', 'auth', 'codeverifier', 'state', 'nonce', 'csrf',
]);

const SENSITIVE_KEY_COMPONENTS = new Set([
  'auth', 'authorization', 'cookie', 'cookies', 'credential', 'credentials', 'passwd',
  'password', 'secret', 'secrets', 'token', 'tokens', 'signature',
]);

const NON_SENSITIVE_COMPOUND_KEYS = new Set(['codechallengemethodssupported', 'estimatedcontexttokens']);
const WRAPPED_CREDENTIAL_KEY = /(?:api|private)key(?:value|header)$/;
const SESSION_CREDENTIAL_KEY = /(?:session|sessionid|sessionkey|sessiontoken)s?$/;

const TOOL_INPUT_SCHEMA_REDACTED_VALUE_KEYS = new Set([
  '$anchor', '$comment', '$dynamicAnchor', '$dynamicRef', '$id', '$recursiveRef', '$ref',
  '$schema', '$vocabulary', 'const', 'contentEncoding', 'contentMediaType', 'default',
  'description', 'enum', 'examples', 'exclusiveMaximum', 'exclusiveMinimum', 'format',
  'maximum', 'minimum', 'multipleOf', 'pattern', 'title',
]);

// Deliberately stricter than the app: raw provider keys are refused wherever they appear.
const KNOWN_CREDENTIAL_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\bglpat-[A-Za-z0-9_-]{20}/,
  /\bnpm_[A-Za-z0-9]{36}/,
];

const JWT_PATTERN = /(^|[^A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?=$|[^A-Za-z0-9_-])/;
const SCHEME_CREDENTIAL_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/i;
const CANONICAL_REFERENCE_URL_PREFIX = 'https://mcptest.io/learn/mcp-transport-diagnostics-reference#';

const canonicalKey = (key) => key.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const keyComponents = (key) => key
  .trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

export const isSensitiveKey = (key) => {
  const canonical = canonicalKey(key);
  if (NON_SENSITIVE_COMPOUND_KEYS.has(canonical)) return false;
  const components = keyComponents(key);
  if (components.some((component) => SENSITIVE_KEY_COMPONENTS.has(component))) return true;
  return EXACT_SENSITIVE_KEYS.has(canonical)
    || /(?:tokens?|secrets?|password|passwd|credentials?|authorizationcodes?|oauthcodes?|apikey|privatekey)$/.test(canonical)
    || WRAPPED_CREDENTIAL_KEY.test(canonical)
    || SESSION_CREDENTIAL_KEY.test(canonical)
    || (components.includes('code')
      && components.some((component) => component === 'authorization' || component === 'oauth'));
};

const decodeFormComponent = (value) => decodeURIComponent(value.replace(/\+/g, ' '));

export const isSensitiveQueryKey = (key) => {
  let decoded = key;
  for (let pass = 0; pass <= MAX_URL_COMPONENT_DECODE_PASSES; pass += 1) {
    if (isSensitiveKey(decoded)) return true;
    let next;
    try {
      next = decodeFormComponent(decoded);
    } catch {
      return true;
    }
    if (next === decoded) return false;
    if (pass === MAX_URL_COMPONENT_DECODE_PASSES) return true;
    decoded = next;
  }
  return true;
};

const isRedactedMarker = (value) => value === REDACTED_VALUE || value === ENCODED_REDACTED_VALUE;

const startsWithRedactedMarker = (value) => (
  value.startsWith(REDACTED_VALUE) || value.startsWith(ENCODED_REDACTED_VALUE)
);

const keyPart = String.raw`[A-Za-z](?:[A-Za-z0-9_+.-]|%[A-Fa-f0-9]{2})*`;
const compoundKey = `${keyPart}(?:\\s+${keyPart}){0,2}`;
const ASSIGNMENT_START = new RegExp(
  `(?:(['"])(${compoundKey})\\1|\\b(${compoundKey})\\b)\\s*([:=])\\s*`,
  'g'
);

/** Mirrors the app's assignment scan: a sensitive `key: value` / `key=value` whose value is not redacted. */
const findUnredactedAssignment = (value) => {
  const assignmentStart = new RegExp(ASSIGNMENT_START.source, 'g');
  let match;
  while ((match = assignmentStart.exec(value)) !== null) {
    const key = match[2] || match[3];
    if (!isSensitiveQueryKey(key)) continue;
    let rest = value.slice(match.index + match[0].length);
    if (rest.startsWith('"') || rest.startsWith("'")) rest = rest.slice(1);
    if (!startsWithRedactedMarker(rest)) return `assignment "${key}" is not redacted`;
  }
  return undefined;
};

const decodeComponent = (value) => {
  let decoded = value;
  for (let pass = 0; pass <= MAX_URL_COMPONENT_DECODE_PASSES; pass += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return { ok: false, reason: 'invalid URL encoding' };
    }
    if (next === decoded) return { ok: true, value: decoded };
    if (pass === MAX_URL_COMPONENT_DECODE_PASSES) return { ok: false, reason: 'URL component is encoded too deeply' };
    decoded = next;
  }
  return { ok: false, reason: 'URL component is encoded too deeply' };
};

const findSecretInUrl = (candidate, depth) => {
  if (depth >= MAX_URL_SCAN_DEPTH) return 'URL nested too deeply';
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol)) return undefined;
  if ((url.username && !isRedactedMarker(url.username)) || (url.password && !isRedactedMarker(url.password))) {
    return 'URL carries credentials';
  }
  if (url.hash && url.hash !== `#${REDACTED_VALUE}` && url.hash !== `#${ENCODED_REDACTED_VALUE}`) {
    return 'URL fragment is not redacted';
  }
  for (const component of url.pathname.split('/')) {
    const decoded = decodeComponent(component);
    if (!decoded.ok) return decoded.reason;
    const nested = findSecretInText(decoded.value, depth + 1);
    if (nested) return nested;
  }
  for (const [key, queryValue] of url.searchParams.entries()) {
    if (isSensitiveQueryKey(key)) {
      if (!isRedactedMarker(queryValue)) return `query parameter "${key}" is not redacted`;
      continue;
    }
    const decoded = decodeComponent(queryValue);
    if (!decoded.ok) return decoded.reason;
    const nested = findSecretInText(decoded.value, depth + 1);
    if (nested) return nested;
  }
  return undefined;
};

const isStructuredJsonText = (value) => (
  (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))
);

/** A string that is itself JSON (possibly string-encoded) is scanned as a value. */
const findSecretInJsonShapedText = (value, depth) => {
  let candidate = value.trim();
  for (let pass = 0; pass <= MAX_JSON_STRING_DECODE_PASSES; pass += 1) {
    const structured = isStructuredJsonText(candidate);
    if (!structured && !candidate.startsWith('"')) return undefined;
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return undefined;
    }
    if (typeof parsed === 'string') {
      candidate = parsed.trim();
      continue;
    }
    if (!parsed || typeof parsed !== 'object') return undefined;
    return findSecretInValue(parsed, undefined, [], depth + 1);
  }
  return undefined;
};

const findSecretInText = (value, depth = 0) => {
  if (depth > MAX_URL_SCAN_DEPTH) return undefined;
  if (JWT_PATTERN.test(value)) return 'contains a JWT';
  if (SCHEME_CREDENTIAL_PATTERN.test(value)) return 'contains a Bearer or Basic credential';
  for (const shape of KNOWN_CREDENTIAL_SHAPES) {
    if (shape.test(value)) return 'contains a well-known API key shape';
  }
  const assignment = findUnredactedAssignment(value);
  if (assignment) return assignment;
  const urlPattern = /https?:\/\/[^\s<>]+/gi;
  let match;
  while ((match = urlPattern.exec(value)) !== null) {
    const trailing = match[0].match(/["'),.;!?]+$/)?.[0] || '';
    const url = trailing ? match[0].slice(0, -trailing.length) : match[0];
    const reason = findSecretInUrl(url, depth);
    if (reason) return reason;
  }
  const json = findSecretInJsonShapedText(value, depth);
  return json ? json.reason : undefined;
};

const isAuthorizationPrerequisiteSchemaField = (path) => (
  path[0] === 'outcome' && path[1] === 'authorizationPrerequisite'
  && (path.length === 2 || (path.length === 3 && path[2] === 'state'))
);
const isAuthorizationSetupSchemaField = (path) => path.length > 0 && path[0] === 'authorizationSetup';
const isAuthorizationSetupHeaderTemplateField = (path) => (
  path.length === 2 && path[0] === 'authorizationSetup' && path[1] === 'alternativeHeaderTemplate'
);
const isCapabilityInventoryAuthenticationField = (path) => (
  path.length === 2 && path[0] === 'capabilityInventory' && path[1] === 'authentication'
);
const isJsonRpcErrorCode = (value, key, path) => (
  canonicalKey(key) === 'code'
  && canonicalKey(path[path.length - 2] || '') === 'error'
  && Number.isInteger(value)
);
const isToolInputSchemaRedactedValue = (key, path) => (
  TOOL_INPUT_SCHEMA_REDACTED_VALUE_KEYS.has(key)
  && path.includes('toolDefinitions')
  && path.includes('inputSchema')
);

const formatPath = (path) => (path.length ? path.join('.') : '(root)');

/**
 * Walks a JSON value; returns { path, reason } for the first credential found,
 * or undefined when every sensitive key is redacted and no string carries a secret.
 */
const findSecretInValue = (value, key, path, depth = 0) => {
  if (key !== undefined) {
    const keyReason = findSecretInText(key, depth);
    if (keyReason) return { path: formatPath(path), reason: `object key ${keyReason}` };
    const mustBeRedacted = isToolInputSchemaRedactedValue(key, path)
      || (isSensitiveQueryKey(key)
        && !isAuthorizationPrerequisiteSchemaField(path)
        && !isAuthorizationSetupSchemaField(path)
        && !isCapabilityInventoryAuthenticationField(path)
        && !isJsonRpcErrorCode(value, key, path));
    if (mustBeRedacted && value !== REDACTED_VALUE) {
      return { path: formatPath(path), reason: `sensitive key "${key}" must be redacted` };
    }
  }
  if (typeof value === 'string') {
    if (key === 'referenceUrl' && value.startsWith(CANONICAL_REFERENCE_URL_PREFIX)) return undefined;
    if (isAuthorizationSetupHeaderTemplateField(path)) return undefined;
    const reason = findSecretInText(value, depth);
    return reason ? { path: formatPath(path), reason } : undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretInValue(value[index], undefined, [...path, String(index)], depth);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      const found = findSecretInValue(childValue, childKey, [...path, childKey], depth);
      if (found) return found;
    }
  }
  return undefined;
};

/** Returns { path, reason } when the artifact carries unredacted credential material. */
export const findUnredactedSecret = (artifact) => findSecretInValue(artifact, undefined, []);
