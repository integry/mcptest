// Rejects any published artifact that still carries credential material.
//
// The app redacts before download and before publishing (src/utils/reportArtifact.ts),
// so a correctly produced artifact never changes when scanned here. This guard is
// the detection half of that redaction, sharing its vocabulary and patterns with
// the Worker's port of the transform (cloudflare-worker/src/reportRedaction.js):
// assignment and URL parameter scanning for URLs of any scheme, userinfo in a
// URL or bare in text, Bearer/Basic credentials, JWTs, JSON-shaped strings, JSON
// fragments embedded anywhere in a string, JSON escape sequences, plus a few
// well-known API key shapes. Every rule flags a strict
// subset of what the app's redaction would rewrite (the key-shape rules, the
// unquoted escape decoding and the non-http(s) URL and bare userinfo rules are
// the deliberate additions), so an artifact the app produced is always accepted
// and a hand-built one carrying `Authorization: Bearer …`, `?token=…`,
// `ftp://user:password@…` or a raw key is refused.
//
// The guard is the second line: the route stores every artifact through the
// redaction transform, so even an input that slips past detection is stored
// redacted.
import {
  ASSIGNMENT_START_SOURCE,
  BARE_USERINFO_PATTERN_SOURCE,
  CANONICAL_REFERENCE_URL_PATTERN,
  ENCODED_REDACTED_VALUE,
  JWT_PATTERN_SOURCE,
  MAX_JSON_STRING_DECODE_PASSES,
  MAX_URL_COMPONENT_DECODE_PASSES,
  REDACTED_VALUE,
  SCHEME_CREDENTIAL_PATTERN_SOURCE,
  TOOL_INPUT_SCHEMA_REDACTED_VALUE_KEYS,
  URL_IN_TEXT_PATTERN,
  URL_TRAILING_PUNCTUATION,
  isAuthorizationPrerequisiteSchemaField,
  isAuthorizationSetupHeaderTemplateField,
  isAuthorizationSetupSchemaField,
  isCapabilityInventoryAuthenticationField,
  isJsonRpcErrorCode,
  isRedactedMarkerText,
  isSensitiveKey,
  isSensitiveQueryKey,
} from './reportRedaction.js';

export { REDACTED_VALUE, isSensitiveKey, isSensitiveQueryKey };

const MAX_URL_SCAN_DEPTH = 4;
// Bounds on what a decoded JSON string may expand to before it is scanned. The
// app never produces anything near them; past them the text cannot be inspected
// and is refused rather than accepted unseen.
const MAX_DECODED_JSON_NESTING = 64;
const MAX_DECODED_JSON_NODES = 100000;
// Characters JSON.parse may be handed while trying the JSON-shaped fragments of
// one string, as a multiple of the string's length. Every balanced fragment is
// tried at most once and only when no enclosing fragment parsed, so ordinary
// text stays far below this; text past it cannot be inspected and is refused.
const MAX_EMBEDDED_FRAGMENT_PARSE_RATIO = 16;

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

const JWT_PATTERN = new RegExp(JWT_PATTERN_SOURCE);
const SCHEME_CREDENTIAL_PATTERN = new RegExp(SCHEME_CREDENTIAL_PATTERN_SOURCE, 'i');
const JSON_ESCAPE_PATTERN = /\\(?:u([0-9A-Fa-f]{4})|(["\\/bfnrt]))/g;
const JSON_ESCAPE_CHARACTERS = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

const isRedactedMarker = isRedactedMarkerText;

// What may follow a redaction marker for the assignment value to count as fully
// redacted: nothing, whitespace, a closing quote or bracket, or a delimiter that
// starts the next assignment, URL component or fragment. The app replaces the
// whole value, so a marker followed by value characters is a value the app never
// produced and must be treated as a credential (`api_key=[REDACTED]plain-secret`).
const REDACTED_MARKER_TERMINATOR = /^(?:$|[\s"'`,;&)\]}>#?])/;

const isCompletelyRedactedValue = (value) => {
  const marker = [REDACTED_VALUE, ENCODED_REDACTED_VALUE].find((candidate) => value.startsWith(candidate));
  return marker !== undefined && REDACTED_MARKER_TERMINATOR.test(value.slice(marker.length));
};

/** Mirrors the app's assignment scan: a sensitive `key: value` / `key=value` whose value is not redacted. */
const findUnredactedAssignment = (value) => {
  const assignmentStart = new RegExp(ASSIGNMENT_START_SOURCE, 'g');
  let match;
  while ((match = assignmentStart.exec(value)) !== null) {
    const key = match[2] || match[3];
    if (!isSensitiveQueryKey(key)) continue;
    let rest = value.slice(match.index + match[0].length);
    if (rest.startsWith('"') || rest.startsWith("'")) rest = rest.slice(1);
    if (!isCompletelyRedactedValue(rest)) return `assignment "${key}" is not redacted`;
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

// Every URL component is inspected whatever the scheme: userinfo and the
// fragment must be the marker, path segments and query names and values are
// percent-decoded within the shared bound and scanned as text.
const findSecretInUrl = (candidate, depth) => {
  if (depth >= MAX_URL_SCAN_DEPTH) return 'URL nested too deeply';
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
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
    // The name is scannable text before it is a classification: a credential
    // hidden in it (`?access_token%3Dsecret=[REDACTED]`) is refused even when
    // the value is a complete marker.
    const decodedKey = decodeComponent(key);
    if (!decodedKey.ok) return decodedKey.reason;
    const nameReason = findSecretInText(decodedKey.value, depth + 1);
    if (nameReason) return `query parameter name ${nameReason}`;
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

const findSecretInUrls = (value, depth) => {
  const urlPattern = new RegExp(URL_IN_TEXT_PATTERN.source, 'gi');
  let match;
  while ((match = urlPattern.exec(value)) !== null) {
    const trailing = match[0].match(URL_TRAILING_PUNCTUATION)?.[0] || '';
    const url = trailing ? match[0].slice(0, -trailing.length) : match[0];
    const reason = findSecretInUrl(url, depth);
    if (reason) return reason;
  }
  return undefined;
};

/** The bare `user:password@host` shape outside a URL, mirroring the transform's rule. */
const findBareUserinfoCredential = (value) => {
  const pattern = new RegExp(BARE_USERINFO_PATTERN_SOURCE, 'g');
  let match;
  while ((match = pattern.exec(value)) !== null) {
    if (!isRedactedMarker(match[3])) return 'userinfo carries a password';
  }
  return undefined;
};

const isStructuredJsonText = (value) => (
  (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))
);

/** Iterative size and nesting check so the recursive scan below never runs unbounded. */
const findDecodedJsonBoundsViolation = (root) => {
  const pending = [[root, 1]];
  let nodes = 0;
  while (pending.length > 0) {
    const [node, nesting] = pending.pop();
    nodes += 1;
    if (nodes > MAX_DECODED_JSON_NODES) return 'JSON-encoded text is too large to inspect';
    if (!node || typeof node !== 'object') continue;
    if (nesting > MAX_DECODED_JSON_NESTING) return 'JSON-encoded text is nested too deeply to inspect';
    for (const child of Object.values(node)) pending.push([child, nesting + 1]);
  }
  return undefined;
};

/** Scans a decoded JSON value with the full guard, one decode pass deeper. */
const findSecretInParsedJson = (parsed, depth) => {
  if (depth >= MAX_JSON_STRING_DECODE_PASSES) {
    return { path: formatPath([]), reason: 'JSON-encoded text is nested too deeply to inspect' };
  }
  const violation = findDecodedJsonBoundsViolation(parsed);
  if (violation) return { path: formatPath([]), reason: violation };
  return findSecretInValue(parsed, undefined, [], depth + 1);
};

/**
 * A string that is itself JSON (an object, an array or a string literal, possibly
 * string-encoded several times) is decoded and the result is scanned with the full
 * guard, one decode pass per depth level. A decoded string is scanned as text, so a
 * credential hidden behind a JSON escape (`"Bearer\u0020…"`) is still found. Text
 * that is still encoded once the depth budget is spent cannot be inspected and is
 * refused. Returns undefined for text that is not JSON, otherwise { found } where
 * found is { path, reason } relative to the decoded value, or undefined.
 */
const inspectJsonShapedText = (value, depth) => {
  const candidate = value.trim();
  if (!isStructuredJsonText(candidate) && !candidate.startsWith('"')) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (parsed === null || (typeof parsed !== 'object' && typeof parsed !== 'string')) return undefined;
  return { found: findSecretInParsedJson(parsed, depth) };
};

const describeNestedReason = (found, location) => {
  if (found.reason.endsWith('to inspect')) return found.reason;
  const at = found.path === formatPath([]) ? '' : ` at ${found.path}`;
  return `${found.reason} (inside ${location}${at})`;
};

/**
 * Start → end (exclusive) of every balanced `{…}` / `[…]` span in one pass. With
 * quote tracking, brackets inside JSON string literals are ignored; without it,
 * a stray quote in surrounding prose cannot hide a fragment. A closer that does
 * not match the innermost opener discards the pending openers.
 */
const balancedFragmentSpans = (value, trackQuotes) => {
  const spans = new Map();
  const stack = [];
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '\\') index += 1;
      else if (character === '"') quoted = false;
      continue;
    }
    if (trackQuotes && character === '"') {
      quoted = true;
    } else if (character === '{' || character === '[') {
      stack.push([character, index]);
    } else if (character === '}' || character === ']') {
      const top = stack[stack.length - 1];
      if (top && top[0] === (character === '}' ? '{' : '[')) {
        stack.pop();
        spans.set(top[1], index + 1);
      } else {
        stack.length = 0;
      }
    }
  }
  return spans;
};

/**
 * Finds JSON objects and arrays embedded anywhere in a string (`response: {…}`),
 * decodes each with the bounded JSON scan and applies the full guard to the
 * decoded value. Fragments are tried outermost first; the fragments inside one
 * that parsed are covered by that scan and skipped.
 */
const findSecretInEmbeddedJson = (value, depth) => {
  if (!/[{[]/.test(value)) return undefined;
  const candidates = new Map();
  for (const trackQuotes of [true, false]) {
    for (const [start, end] of balancedFragmentSpans(value, trackQuotes)) candidates.set(`${start}:${end}`, [start, end]);
  }
  const spans = [...candidates.values()]
    .sort(([leftStart, leftEnd], [rightStart, rightEnd]) => leftStart - rightStart || rightEnd - leftEnd);
  let budget = value.length * MAX_EMBEDDED_FRAGMENT_PARSE_RATIO;
  let coveredUntil = 0;
  for (const [start, end] of spans) {
    if (end <= coveredUntil) continue;
    const fragment = value.slice(start, end);
    budget -= fragment.length;
    if (budget < 0) return 'contains too many JSON-shaped fragments to inspect';
    let parsed;
    try {
      parsed = JSON.parse(fragment);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const found = findSecretInParsedJson(parsed, depth);
    if (found) return describeNestedReason(found, 'an embedded JSON fragment');
    coveredUntil = end;
  }
  return undefined;
};

const decodeJsonEscapes = (value) => value.replace(JSON_ESCAPE_PATTERN, (_, hex, character) => (
  hex ? String.fromCharCode(parseInt(hex, 16)) : JSON_ESCAPE_CHARACTERS[character]
));

/**
 * A string carrying JSON escape sequences (`Bearer\u0020…`, `{\"token\":…}`) is
 * decoded one layer at a time, up to the shared decode budget, and each layer is
 * scanned again with the given scan. Text still escaped past the budget cannot be
 * inspected and is refused.
 */
const findSecretBehindJsonEscapes = (value, depth, scan) => {
  const decoded = decodeJsonEscapes(value);
  if (decoded === value) return undefined;
  if (depth >= MAX_JSON_STRING_DECODE_PASSES) return 'JSON escapes are nested too deeply to inspect';
  const reason = scan(decoded, depth + 1);
  if (!reason || reason.endsWith('to inspect')) return reason;
  return `${reason} (after decoding JSON escapes)`;
};

/** Credential shapes that are refused wherever they appear, exemptions included. */
const findCredentialShape = (value) => {
  if (JWT_PATTERN.test(value)) return 'contains a JWT';
  if (SCHEME_CREDENTIAL_PATTERN.test(value)) return 'contains a Bearer or Basic credential';
  for (const shape of KNOWN_CREDENTIAL_SHAPES) {
    if (shape.test(value)) return 'contains a well-known API key shape';
  }
  return undefined;
};

/**
 * Credentials reachable only by decoding. Text that is JSON as a whole is fully
 * decoded by that scan (escapes included), so only text that is not JSON goes on
 * to the embedded fragment search and the escape decoding; `scan` is applied to
 * each decoded escape layer.
 */
const findSecretInEncodedText = (value, depth, scan) => {
  const whole = inspectJsonShapedText(value, depth);
  if (whole) return whole.found ? describeNestedReason(whole.found, 'JSON-encoded text') : undefined;
  return findSecretInEmbeddedJson(value, depth) || findSecretBehindJsonEscapes(value, depth, scan);
};

const findSecretInText = (value, depth = 0) => {
  // Unreachable through the bounded URL and JSON scans above; refuse rather than accept unseen.
  if (depth > Math.max(MAX_URL_SCAN_DEPTH, MAX_JSON_STRING_DECODE_PASSES)) return 'text is nested too deeply to inspect';
  return findCredentialShape(value)
    || findUnredactedAssignment(value)
    || findSecretInUrls(value, depth)
    || findBareUserinfoCredential(value)
    || findSecretInEncodedText(value, depth, findSecretInText);
};

/**
 * The scan for the two exempt locations: a generated reference link keeps its
 * heading anchor, which the URL scan would refuse as an unredacted fragment, and
 * the catalog header template keeps its `token=<PLACEHOLDER>` syntax. Credential
 * shapes are still refused, including ones hidden behind JSON encoding.
 */
const findSecretInExemptText = (value, depth = 0) => (
  findCredentialShape(value) || findSecretInEncodedText(value, depth, findSecretInExemptText)
);

// The artifact locations the app fills with generated reference links
// (src/utils/reportArtifact.ts): release priorities and evidence metadata.
const isReferenceUrlField = (path) => {
  if (path[path.length - 1] !== 'referenceUrl') return false;
  if (path.length === 4 && path[0] === 'releaseDecision' && path[1] === 'priorities') return true;
  if (path[0] !== 'sections' || path[2] !== 'evidence' || path[4] !== 'metadata') return false;
  return path.length === 6 || (path.length === 7 && path[5] === 'transportDiagnostic');
};
const isCanonicalReferenceUrl = (value, path) => (
  isReferenceUrlField(path) && CANONICAL_REFERENCE_URL_PATTERN.test(value)
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
    const reason = isCanonicalReferenceUrl(value, path) || isAuthorizationSetupHeaderTemplateField(path)
      ? findSecretInExemptText(value, depth)
      : findSecretInText(value, depth);
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
