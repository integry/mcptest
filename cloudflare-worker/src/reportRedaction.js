// Dependency-free port of the app's report redaction (src/utils/reportArtifact.ts:
// redactReportString and redactReportValue), the same transform the browser runs
// before download and before publishing. The Worker applies it to every artifact
// it stores, so an input that slips past the detection guard
// (cloudflare-worker/src/redactionGuard.js) is still stored redacted.
//
// Kept in step with the app: the sensitive-key vocabulary, assignment and URL
// parameter redaction, Bearer/Basic credentials, JWTs, JSON-shaped strings,
// JSON-encoded string literals and JSON fragments embedded in surrounding text,
// the closed keyword vocabulary for stored tool input schemas, and the partial
// status and fingerprint recomputation when tool definitions change. The app's
// extra pass that follows `$ref` chains from sensitive schema properties is not
// ported: the guard already refuses a sensitive property declaration that is
// not a redaction marker, and the keyword sanitizer below strips every
// free-form value from the schemas it would reach.
//
// URLs are discovered for any scheme (`ftp://`, `wss://`, a custom scheme) and
// the bare `user:password@host` shape outside a URL is redacted too; the app
// discovers only http(s) URLs. A password in either place is credential material
// whatever the scheme, so the port is stricter than the app here and the guard
// refuses the app's form as unredacted.
//
// On an artifact the app produced the transform is the identity, so published
// content hashes, permalinks and diffs are unchanged by it.

export const REDACTED_VALUE = '[REDACTED]';
export const MAX_REDACTION_PASSES = 8;
export const MAX_URL_REDACTION_DEPTH = 4;
export const MAX_URL_COMPONENT_DECODE_PASSES = 4;
export const MAX_JSON_STRING_DECODE_PASSES = 4;

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

export const canonicalKey = (key) => key.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

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

const balancedAssignmentValueEnd = (value, start) => {
  const opening = value[start];
  if (opening !== '{' && opening !== '[') return undefined;
  const stack = [opening];
  let quote;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{' || character === '[') {
      stack.push(character);
    } else if (character === '}' || character === ']') {
      if (stack[stack.length - 1] !== (character === '}' ? '{' : '[')) return undefined;
      stack.pop();
      if (stack.length === 0) return index + 1;
    }
  }
  return undefined;
};

const surroundingQuoteAt = (value, end) => {
  let quote;
  const lineStart = Math.max(value.lastIndexOf('\n', end - 1), value.lastIndexOf('\r', end - 1)) + 1;
  for (let index = lineStart; index < end; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    }
  }
  return quote;
};

const keyPart = String.raw`[A-Za-z](?:[A-Za-z0-9_+.-]|%[A-Fa-f0-9]{2})*`;
const compoundKey = `${keyPart}(?:\\s+${keyPart}){0,2}`;
export const ASSIGNMENT_START_SOURCE = `(?:(['"])(${compoundKey})\\1|\\b(${compoundKey})\\b)\\s*([:=])\\s*`;
const NEXT_ASSIGNMENT_SOURCE = `([,;&]|\\s+)(?:(['"])(${compoundKey})\\2|\\b(${compoundKey})\\b)\\s*[:=]\\s*`;

const spliceMatches = (value, matches) => matches.reduceRight((redacted, match) => (
  `${redacted.slice(0, match.start)}${match.replacement}${redacted.slice(match.end)}`
), value);

const redactSensitiveAssignments = (value) => {
  const matches = [];
  const assignmentStart = new RegExp(ASSIGNMENT_START_SOURCE, 'g');
  const nextAssignment = new RegExp(NEXT_ASSIGNMENT_SOURCE, 'g');
  let match;
  while ((match = assignmentStart.exec(value)) !== null) {
    const keyQuote = match[1];
    const key = match[2] || match[3];
    if (!isSensitiveQueryKey(key)) continue;
    const assignmentStartIndex = match.index;
    const valueStart = assignmentStartIndex + match[0].length;
    let valueEnd = valueStart;
    const quote = value[valueStart];
    const surroundingQuote = surroundingQuoteAt(value, assignmentStartIndex);
    const canonical = canonicalKey(key);
    const consumesEntireLine = !keyQuote && (
      ['authorization', 'proxyauthorization', 'xmcpauthorization'].includes(canonical)
      || ['cookie', 'setcookie', 'cookies'].includes(canonical)
    );
    let replacement = `${match[0]}${REDACTED_VALUE}`;
    if (consumesEntireLine) {
      while (valueEnd < value.length && !/[\r\n]/.test(value[valueEnd])) valueEnd += 1;
    } else if (quote === '"' || quote === "'") {
      valueEnd += 1;
      while (valueEnd < value.length) {
        if (value[valueEnd] === '\\') {
          valueEnd = Math.min(valueEnd + 2, value.length);
        } else if (value[valueEnd] === quote) {
          valueEnd += 1;
          break;
        } else {
          valueEnd += 1;
        }
      }
      replacement = keyQuote
        ? `${match[0]}${quote}${REDACTED_VALUE}${quote}`
        : `${match[0]}${REDACTED_VALUE}`;
    } else if (quote === '{' || quote === '[') {
      valueEnd = balancedAssignmentValueEnd(value, valueStart) ?? valueStart;
      if (valueEnd === valueStart) {
        while (valueEnd < value.length && !/[\r\n]/.test(value[valueEnd])) valueEnd += 1;
      }
      if (keyQuote) replacement = `${match[0]}${keyQuote}${REDACTED_VALUE}${keyQuote}`;
    } else {
      while (valueEnd < value.length && !/[\r\n]/.test(value[valueEnd])) {
        const character = value[valueEnd];
        if (character === '\\') valueEnd = Math.min(valueEnd + 1, value.length);
        else if (character === surroundingQuote) break;
        valueEnd += 1;
      }
      nextAssignment.lastIndex = valueStart;
      let boundary;
      while ((boundary = nextAssignment.exec(value)) !== null && boundary.index < valueEnd) {
        const delimiter = boundary[1];
        const nextKey = boundary[3] || boundary[4];
        if (/[,;&]/.test(delimiter) || isSensitiveQueryKey(nextKey)) {
          valueEnd = boundary.index;
          break;
        }
      }
    }
    if (!matches.some((assignment) => assignment.start <= assignmentStartIndex && assignment.end >= valueEnd)) {
      matches.push({ start: assignmentStartIndex, end: valueEnd, replacement });
    }
  }
  return spliceMatches(value, matches);
};

const redactEncodedUrlComponent = (value, depth, failClosedOnInvalidEncoding = false) => {
  let decoded = value;
  let decodedLayers = 0;
  for (let pass = 0; pass <= MAX_URL_COMPONENT_DECODE_PASSES; pass += 1) {
    const redacted = redactReportStringAtDepth(decoded, depth);
    if (redacted !== decoded) {
      let reencoded = redacted;
      for (let layer = 0; layer < decodedLayers; layer += 1) reencoded = encodeURIComponent(reencoded);
      return reencoded;
    }
    if (isAbsoluteUrl(decoded)) return value;
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return failClosedOnInvalidEncoding ? REDACTED_VALUE : value;
    }
    if (next === decoded) return value;
    if (pass === MAX_URL_COMPONENT_DECODE_PASSES) return REDACTED_VALUE;
    decoded = next;
    decodedLayers += 1;
  }
  return REDACTED_VALUE;
};

// A query name is scannable text like any other URL component: percent-decoded
// within the shared bound and run through the string redaction, so a credential
// hidden in the name (`?access_token%3Dsecret=[REDACTED]`, `?Bearer%20secret=1`)
// is found. Such a name becomes the marker rather than being preserved, and so
// does a name that cannot be decoded within the bound, as path segments and
// query values already do. This is the one place the port is stricter than the
// app, which preserves the name; the guard refuses the app's form as unredacted.
const queryNameCarriesCredential = (name, depth) => redactEncodedUrlComponent(name, depth, true) !== name;

const redactUrl = (value, depth = 0) => {
  if (depth >= MAX_URL_REDACTION_DEPTH) return REDACTED_VALUE;
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.username) url.username = REDACTED_VALUE;
  if (url.password) url.password = REDACTED_VALUE;
  url.pathname = url.pathname
    .split('/')
    .map((component) => redactEncodedUrlComponent(component, depth + 1, true))
    .join('/');
  const redactedSearchParams = new URLSearchParams();
  for (const [key, queryValue] of [...url.searchParams.entries()]) {
    if (queryNameCarriesCredential(key, depth + 1)) {
      redactedSearchParams.append(REDACTED_VALUE, REDACTED_VALUE);
      continue;
    }
    redactedSearchParams.append(
      key,
      isSensitiveQueryKey(key) ? REDACTED_VALUE : redactEncodedUrlComponent(queryValue, depth + 1)
    );
  }
  url.search = redactedSearchParams.toString();
  if (url.hash) url.hash = `#${REDACTED_VALUE}`;
  return url.toString();
};

// Any scheme with an authority (`https://`, `ftp://`, `wss://`, a custom
// scheme) is a URL whose userinfo, path, query and fragment are inspected.
export const URL_SCHEME_SOURCE = String.raw`[a-z][a-z0-9+.-]*`;
export const URL_IN_TEXT_PATTERN = new RegExp(String.raw`\b${URL_SCHEME_SOURCE}://[^\s<>]+`, 'gi');
export const URL_TRAILING_PUNCTUATION = /["'),.;!?]+$/;
const ABSOLUTE_URL_PATTERN = new RegExp(String.raw`^${URL_SCHEME_SOURCE}://`, 'i');
export const ENCODED_REDACTED_VALUE = encodeURIComponent(REDACTED_VALUE);

const isAbsoluteUrl = (value) => {
  if (!ABSOLUTE_URL_PATTERN.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const redactUrlsInText = (value, depth) => value.replace(URL_IN_TEXT_PATTERN, (candidate) => {
  const trailing = candidate.match(URL_TRAILING_PUNCTUATION)?.[0] || '';
  const url = trailing ? candidate.slice(0, -trailing.length) : candidate;
  return `${redactUrl(url, depth)}${trailing}`;
});

// The `user:password@host` shape anywhere in text, whatever precedes it: a
// scheme without `//` (`https:alice:secret@host`, `mailto:alice:secret@host`),
// prose, quotes or nothing at all. Each `@` ends a run, which reaches back to
// the previous whitespace, slash or `@`; the run's first colon splits a
// non-empty user from a non-empty password, so, as in URL userinfo, a password
// may itself contain colons and everything between that colon and the `@` is
// redacted. The user is kept and the password becomes the marker; a password
// that is already the marker, plain or percent-encoded as the URL serializer
// writes it, is left alone. The one colon that never splits a run is the JSON
// pair separator `":"`, so `{"email":"alice@example.com"}` is not a userinfo
// match while a credential inside a JSON string (`{"url":"alice:secret@host"}`)
// still is. The scan visits every character once, so a long run without an `@`
// costs nothing more than its length.
const USERINFO_RUN_BOUNDARY = /[\s/@]/;
const USERINFO_HOST_START = /[A-Za-z0-9]|\[[0-9A-Fa-f:.]+\]/y;

const firstUserinfoColon = (value, runStart, at) => {
  for (let index = runStart + 1; index < at - 1; index += 1) {
    if (value[index] !== ':') continue;
    if (value[index - 1] === '"' && value[index + 1] === '"') continue;
    return index;
  }
  return -1;
};

/** Every `user:password@host` password in `value` as `{ start, end, password }` spans, in order. */
export const findUserinfoPasswords = (value) => {
  const spans = [];
  let runStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!USERINFO_RUN_BOUNDARY.test(character)) continue;
    if (character === '@') {
      const colon = firstUserinfoColon(value, runStart, index);
      USERINFO_HOST_START.lastIndex = index + 1;
      if (colon !== -1 && USERINFO_HOST_START.test(value)) {
        spans.push({ start: colon + 1, end: index, password: value.slice(colon + 1, index) });
      }
    }
    runStart = index + 1;
  }
  return spans;
};
export const isRedactedMarkerText = (value) => value === REDACTED_VALUE || value === ENCODED_REDACTED_VALUE;

const redactBareUserinfo = (value) => spliceMatches(value, findUserinfoPasswords(value)
  .filter(({ password }) => !isRedactedMarkerText(password))
  .map(({ start, end }) => ({ start, end, replacement: REDACTED_VALUE })));

export const JWT_PATTERN_SOURCE = String.raw`(^|[^A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?=$|[^A-Za-z0-9_-])`;
export const SCHEME_CREDENTIAL_PATTERN_SOURCE = String.raw`\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+`;

const redactStandaloneJwtValues = (value) => value.replace(new RegExp(JWT_PATTERN_SOURCE, 'g'), `$1${REDACTED_VALUE}`);

const isObjectOrArrayText = (candidate) => (
  (candidate.startsWith('{') && candidate.endsWith('}')) || (candidate.startsWith('[') && candidate.endsWith(']'))
);

const redactJsonShapedString = (value) => {
  const trimmed = value.trim();
  let candidate = trimmed;
  const encodings = [];
  let isStructured = false;
  for (let pass = 0; pass <= MAX_JSON_STRING_DECODE_PASSES; pass += 1) {
    const isObjectOrArray = isObjectOrArrayText(candidate);
    if (!isObjectOrArray && !candidate.startsWith('"')) return value;
    isStructured ||= isObjectOrArray;
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      if (!isObjectOrArray) return value;
      if (pass === MAX_JSON_STRING_DECODE_PASSES) return REDACTED_VALUE;
      try {
        parsed = JSON.parse(`"${candidate}"`);
      } catch {
        return value;
      }
      if (parsed === candidate) return value;
      encodings.push('content');
    }
    if (typeof parsed === 'string') {
      const decoded = parsed.trim();
      const decodedIsStructured = isObjectOrArrayText(decoded);
      if (!decodedIsStructured && !decoded.startsWith('"')) return value;
      if (pass === MAX_JSON_STRING_DECODE_PASSES) {
        return isStructured || decodedIsStructured ? REDACTED_VALUE : value;
      }
      candidate = decoded;
      if (encodings.length === 0 || encodings[encodings.length - 1] !== 'content') encodings.push('literal');
      isStructured ||= decodedIsStructured;
      continue;
    }
    if (!parsed || typeof parsed !== 'object') return value;
    const redacted = redactReportValueAtPath(parsed, undefined, []);
    let serialized = JSON.stringify(redacted);
    if (serialized === JSON.stringify(parsed)) return value;
    for (const encoding of [...encodings].reverse()) {
      const encoded = JSON.stringify(serialized);
      serialized = encoding === 'literal' ? encoded : encoded.slice(1, -1);
    }
    const start = value.indexOf(trimmed);
    return `${value.slice(0, start)}${serialized}${value.slice(start + trimmed.length)}`;
  }
  return isStructured ? REDACTED_VALUE : value;
};

export const JSON_STRING_LITERAL_PATTERN = /"(?:\\["\\/bfnrt]|\\u[A-Fa-f0-9]{4}|[^"\\\u0000-\u001f])*"/g;

const redactJsonEncodedStringLiterals = (value) => value.replace(JSON_STRING_LITERAL_PATTERN, (literal) => {
  let decoded;
  try {
    decoded = JSON.parse(literal);
  } catch {
    return literal;
  }
  if (typeof decoded !== 'string') return literal;
  const redacted = redactJsonShapedString(decoded);
  return redacted === decoded ? literal : JSON.stringify(redacted);
});

const redactEmbeddedJsonFragments = (value) => {
  const matches = [];
  for (let start = 0; start < value.length; start += 1) {
    const opening = value[start];
    const closing = opening === '{' ? '}' : opening === '[' ? ']' : undefined;
    if (!closing) continue;
    for (let end = start + 1; end < value.length; end += 1) {
      if (value[end] !== closing) continue;
      const fragment = value.slice(start, end + 1);
      const redacted = redactJsonShapedString(fragment);
      if (redacted === fragment) continue;
      matches.push({ start, end: end + 1, replacement: redacted });
      start = end;
      break;
    }
  }
  return spliceMatches(value, matches);
};

const redactReportStringAtDepth = (value, urlDepth) => {
  let redacted = redactEmbeddedJsonFragments(redactJsonEncodedStringLiterals(redactJsonShapedString(value)));
  for (let pass = 0; pass < MAX_REDACTION_PASSES; pass += 1) {
    const redactedAssignments = redactSensitiveAssignments(redacted)
      .replace(new RegExp(SCHEME_CREDENTIAL_PATTERN_SOURCE, 'gi'), `$1 ${REDACTED_VALUE}`);
    const next = redactBareUserinfo(redactUrlsInText(redactStandaloneJwtValues(redactedAssignments), urlDepth));
    if (next === redacted) break;
    redacted = next;
  }
  return redacted;
};

/** The app's string redaction: assignments, scheme credentials, JWTs, URLs and JSON in text. */
export const redactReportString = (value) => redactReportStringAtDepth(value, 0);

// Artifact locations the schema fills with values that look sensitive but are
// not credentials (src/utils/reportArtifact.ts keeps the same exemptions).
export const isAuthorizationPrerequisiteSchemaField = (path) => (
  path[0] === 'outcome' && path[1] === 'authorizationPrerequisite'
  && (path.length === 2 || (path.length === 3 && path[2] === 'state'))
);
export const isAuthorizationSetupSchemaField = (path) => path.length > 0 && path[0] === 'authorizationSetup';
export const isAuthorizationSetupHeaderTemplateField = (path) => (
  path.length === 2 && path[0] === 'authorizationSetup' && path[1] === 'alternativeHeaderTemplate'
);
export const isCapabilityInventoryAuthenticationField = (path) => (
  path.length === 2 && path[0] === 'capabilityInventory' && path[1] === 'authentication'
);
export const isJsonRpcErrorCode = (value, key, path) => (
  canonicalKey(key) === 'code'
  && canonicalKey(path[path.length - 2] || '') === 'error'
  && typeof value === 'number' && Number.isInteger(value)
);
const isToolInputSchemaPropertyDeclaration = (key, path) => {
  const propertyIndex = path.length - 2;
  return propertyIndex >= 0
    && path[propertyIndex] === 'properties'
    && path[path.length - 1] === key
    && path.includes('toolDefinitions')
    && path.includes('inputSchema');
};

// Generated reference links keep their heading anchor: the canonical article plus
// one anchor of id characters (src/utils/referenceLinks.ts).
export const CANONICAL_REFERENCE_URL_PATTERN = /^https:\/\/mcptest\.io\/learn\/mcp-transport-diagnostics-reference#[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Stored schemas use a closed keyword vocabulary (src/utils/reportArtifact.ts).
export const TOOL_INPUT_SCHEMA_REDACTED_VALUE_KEYS = new Set([
  '$anchor', '$comment', '$dynamicAnchor', '$dynamicRef', '$id', '$recursiveRef', '$ref',
  '$schema', '$vocabulary', 'const', 'contentEncoding', 'contentMediaType', 'default',
  'description', 'enum', 'examples', 'exclusiveMaximum', 'exclusiveMinimum', 'format',
  'maximum', 'minimum', 'multipleOf', 'pattern', 'title',
]);
const TOOL_INPUT_SCHEMA_MAP_KEYS = new Set(['$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties']);
const TOOL_INPUT_SCHEMA_SINGLE_SCHEMA_KEYS = new Set([
  'additionalItems', 'additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'items',
  'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties',
]);
const TOOL_INPUT_SCHEMA_ARRAY_SCHEMA_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const TOOL_INPUT_SCHEMA_NONNEGATIVE_INTEGER_KEYS = new Set([
  'maxContains', 'maxItems', 'maxLength', 'maxProperties', 'minContains', 'minItems', 'minLength', 'minProperties',
]);
const TOOL_INPUT_SCHEMA_BOOLEAN_KEYS = new Set(['$recursiveAnchor', 'deprecated', 'readOnly', 'uniqueItems', 'writeOnly']);
const TOOL_INPUT_SCHEMA_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);

const isSchemaObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isUniqueStringArray = (value) => (
  Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length
);
const isValidSchemaType = (value) => (
  typeof value === 'string'
    ? TOOL_INPUT_SCHEMA_TYPES.has(value)
    : Array.isArray(value) && value.length > 0 && isUniqueStringArray(value)
      && value.every((type) => TOOL_INPUT_SCHEMA_TYPES.has(type))
);
const sanitizeStoredSchemaValue = (value) => (
  typeof value === 'boolean' || isSchemaObject(value) ? sanitizeStoredInputSchema(value) : REDACTED_VALUE
);
const sanitizeSchemaMap = (value, sanitizeEntry) => (
  isSchemaObject(value)
    ? Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, sanitizeEntry(entry)]))
    : REDACTED_VALUE
);

export const sanitizeStoredInputSchema = (value) => {
  if (typeof value === 'boolean') return value;
  if (!isSchemaObject(value)) return REDACTED_VALUE;
  const sanitized = {};
  for (const [keyword, keywordValue] of Object.entries(value)) {
    if (TOOL_INPUT_SCHEMA_REDACTED_VALUE_KEYS.has(keyword)) {
      sanitized[keyword] = REDACTED_VALUE;
    } else if (TOOL_INPUT_SCHEMA_MAP_KEYS.has(keyword)) {
      sanitized[keyword] = sanitizeSchemaMap(keywordValue, sanitizeStoredSchemaValue);
    } else if (TOOL_INPUT_SCHEMA_SINGLE_SCHEMA_KEYS.has(keyword)) {
      sanitized[keyword] = sanitizeStoredSchemaValue(keywordValue);
    } else if (TOOL_INPUT_SCHEMA_ARRAY_SCHEMA_KEYS.has(keyword)) {
      sanitized[keyword] = Array.isArray(keywordValue) && keywordValue.length > 0
        ? keywordValue.map(sanitizeStoredSchemaValue)
        : REDACTED_VALUE;
    } else if (keyword === 'required') {
      sanitized[keyword] = isUniqueStringArray(keywordValue) ? keywordValue : REDACTED_VALUE;
    } else if (keyword === 'dependentRequired') {
      sanitized[keyword] = sanitizeSchemaMap(keywordValue, (dependency) => (
        isUniqueStringArray(dependency) ? dependency : REDACTED_VALUE
      ));
    } else if (keyword === 'dependencies') {
      sanitized[keyword] = sanitizeSchemaMap(keywordValue, (dependency) => (
        isUniqueStringArray(dependency) ? dependency : sanitizeStoredSchemaValue(dependency)
      ));
    } else if (keyword === 'type') {
      sanitized[keyword] = isValidSchemaType(keywordValue) ? keywordValue : REDACTED_VALUE;
    } else if (TOOL_INPUT_SCHEMA_NONNEGATIVE_INTEGER_KEYS.has(keyword)) {
      sanitized[keyword] = Number.isInteger(keywordValue) && keywordValue >= 0 ? keywordValue : REDACTED_VALUE;
    } else if (TOOL_INPUT_SCHEMA_BOOLEAN_KEYS.has(keyword)) {
      sanitized[keyword] = typeof keywordValue === 'boolean' ? keywordValue : REDACTED_VALUE;
    }
  }
  return sanitized;
};

const isToolInputSchemaRedactedValue = (key, path) => (
  TOOL_INPUT_SCHEMA_REDACTED_VALUE_KEYS.has(key) && path.includes('toolDefinitions') && path.includes('inputSchema')
);

const sameReportValue = (left, right) => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameReportValue(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every((childKey) => (
      Object.prototype.hasOwnProperty.call(right, childKey) && sameReportValue(left[childKey], right[childKey])
    ));
};

const retainedToolNamesAreComplete = (original, redacted) => {
  if (original.status !== 'complete' && original.namesComplete !== true) return false;
  if (!Array.isArray(original.tools) || !Array.isArray(redacted.tools)) return false;
  return original.tools.length === redacted.tools.length
    && original.tools.every((tool, index) => {
      const redactedTool = redacted.tools[index];
      return isSchemaObject(tool) && isSchemaObject(redactedTool)
        && typeof tool.name === 'string' && tool.name === redactedTool.name;
    });
};

const stableReportValue = (value) => {
  if (Array.isArray(value)) return value.map(stableReportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([childKey, childValue]) => [childKey, stableReportValue(childValue)]));
  }
  return value;
};

/** FNV-1a over the canonical JSON of the retained definitions, as the app computes it. */
export const redactedContractFingerprint = (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(stableReportValue(value)));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return { value: hash.toString(16).padStart(16, '0'), canonicalBytes: bytes.length };
};

const redactObjectEntries = (value, path, inputSchemaSanitized) => {
  const redactedKeys = new Set();
  // Sort the source keys so collision suffixes do not depend on insertion order.
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .filter(([, childValue]) => childValue !== undefined)
    .map(([childKey, childValue]) => {
      const redactedKey = redactReportString(childKey);
      let uniqueKey = redactedKey;
      for (let collision = 2; redactedKeys.has(uniqueKey); collision += 1) uniqueKey = `${redactedKey}#${collision}`;
      redactedKeys.add(uniqueKey);
      return [uniqueKey, redactReportValueAtPath(childValue, childKey, [...path, childKey], inputSchemaSanitized)];
    }));
};

const redactReportValueAtPath = (value, key, path, inputSchemaSanitized = false) => {
  if (key && isToolInputSchemaRedactedValue(key, path)) return REDACTED_VALUE;
  if (key && isSensitiveQueryKey(key) && isToolInputSchemaPropertyDeclaration(key, path)) return REDACTED_VALUE;
  if (key
    && isSensitiveQueryKey(key)
    && !isAuthorizationPrerequisiteSchemaField(path)
    && !isAuthorizationSetupSchemaField(path)
    && !isCapabilityInventoryAuthenticationField(path)
    && !isJsonRpcErrorCode(value, key, path)) {
    return REDACTED_VALUE;
  }
  if (key === 'inputSchema' && path.includes('toolDefinitions') && !inputSchemaSanitized) {
    const sanitizedSchema = sanitizeStoredInputSchema(value);
    if (!sameReportValue(sanitizedSchema, value)) return redactReportValueAtPath(sanitizedSchema, key, path, true);
    inputSchemaSanitized = true;
  }
  if (value === undefined) return undefined;
  if (key === 'referenceUrl' && typeof value === 'string' && CANONICAL_REFERENCE_URL_PATTERN.test(value)) return value;
  if (typeof value === 'string') {
    return isAuthorizationSetupHeaderTemplateField(path) ? value : redactReportString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactReportValueAtPath(item, undefined, [...path, String(index)], inputSchemaSanitized));
  }
  if (typeof value === 'object') {
    const redactedObject = redactObjectEntries(value, path, inputSchemaSanitized);
    if (key === 'toolDefinitions' && path.includes('toolSurfaceAnalysis') && !sameReportValue(value, redactedObject)) {
      return { ...redactedObject, status: 'partial', namesComplete: retainedToolNamesAreComplete(value, redactedObject) };
    }
    const { toolDefinitions, fingerprint } = redactedObject;
    if (key === 'toolSurfaceAnalysis' && isSchemaObject(toolDefinitions) && toolDefinitions.status === 'partial'
      && isSchemaObject(fingerprint)) {
      return { ...redactedObject, fingerprint: { ...fingerprint, ...redactedContractFingerprint(toolDefinitions) } };
    }
    return redactedObject;
  }
  return String(value);
};

/** The app's value redaction: sensitive keys become the marker, every string is redacted. */
export const redactReportValue = (value, key) => redactReportValueAtPath(value, key, key ? [key] : []);
