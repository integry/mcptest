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
// Characters the embedded-fragment scan may hand to the JSON-shaped redaction
// per string, as a multiple of the string's length: the guard's budget
// (cloudflare-worker/src/redactionGuard.js), so an input the guard accepted is
// transformed within the same bound. Every balanced fragment is tried at most
// once and only when no enclosing fragment parsed, so ordinary text stays far
// below it; a string past it cannot be inspected and is redacted whole.
export const MAX_EMBEDDED_FRAGMENT_PARSE_RATIO = 16;

// ---------------------------------------------------------------------------
// Inspection budget
//
// Every scan the transform and the guard (cloudflare-worker/src/redactionGuard.js)
// perform is linear in the text it walks, but a request may chain many of them
// (eight redaction passes, URL components decoded and rescanned, JSON fragments
// decoded and traversed, a next-assignment search per sensitive assignment), so
// the total work on an accepted-size body is bounded only by this budget: one
// per publish request, shared by the detector runs and the transform, counting
// the characters walked and the candidates (assignments, URLs, userinfo runs,
// JSON fragments) examined. Past it the artifact cannot be inspected and the
// request is refused rather than served unseen. An artifact the app produced
// stays far below it: the limits are hundreds of times the 512 KiB body limit.
// ---------------------------------------------------------------------------
export const INSPECTION_BUDGET_MAX_SCANNED_CHARACTERS = 512 * 1024 * 256;
export const INSPECTION_BUDGET_MAX_CANDIDATES = 4 * 1024 * 1024;

export class InspectionBudgetExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InspectionBudgetExceededError';
  }
}

export const createInspectionBudget = ({
  maxScannedCharacters = INSPECTION_BUDGET_MAX_SCANNED_CHARACTERS,
  maxCandidates = INSPECTION_BUDGET_MAX_CANDIDATES,
} = {}) => ({ maxScannedCharacters, maxCandidates, scannedCharacters: 0, candidates: 0 });

let activeBudget;

/** Runs `run` with `budget` charged for every scan; nested calls share it. */
export const withInspectionBudget = (budget, run) => {
  const previous = activeBudget;
  activeBudget = budget;
  try {
    return run();
  } finally {
    activeBudget = previous;
  }
};

/** Runs `run` under the active budget, or under a fresh default one when none is active. */
export const underInspectionBudget = (run) => (
  activeBudget ? run() : withInspectionBudget(createInspectionBudget(), run)
);

export const chargeScannedCharacters = (characters) => {
  if (!activeBudget) return;
  activeBudget.scannedCharacters += characters;
  if (activeBudget.scannedCharacters > activeBudget.maxScannedCharacters) {
    throw new InspectionBudgetExceededError('the artifact needs more scanning than one publish request may spend');
  }
};

export const chargeCandidates = (count = 1) => {
  if (!activeBudget) return;
  activeBudget.candidates += count;
  if (activeBudget.candidates > activeBudget.maxCandidates) {
    throw new InspectionBudgetExceededError('the artifact carries more credential-shaped candidates than one publish request may examine');
  }
};

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
  let index = start + 1;
  let end;
  for (; index < value.length && end === undefined; index += 1) {
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
      if (stack[stack.length - 1] !== (character === '}' ? '{' : '[')) break;
      stack.pop();
      if (stack.length === 0) end = index + 1;
    }
  }
  chargeScannedCharacters(index - start);
  return end;
};

/**
 * The quote that is open on the current line at successive positions: the app
 * rescans the line from its start for every sensitive assignment, which is
 * quadratic on a line of many assignments; this scanner keeps the state and
 * advances forward (positions are asked for in increasing order), resetting it
 * at a line break, including one that a backslash would otherwise skip over.
 */
const createSurroundingQuoteScanner = (value) => {
  let cursor = 0;
  let quote;
  return (end) => {
    chargeScannedCharacters(Math.max(0, end - cursor));
    for (; cursor < end; cursor += 1) {
      const character = value[cursor];
      if (character === '\n' || character === '\r') {
        quote = undefined;
      } else if (quote) {
        if (character === '\\') {
          if (value[cursor + 1] === '\n' || value[cursor + 1] === '\r') quote = undefined;
          cursor += 1;
        } else if (character === quote) {
          quote = undefined;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      }
    }
    return quote;
  };
};

// ---------------------------------------------------------------------------
// Assignment tokenizer
//
// The app finds assignment starts with the regular expression
//   (?:(['"])(KEY)\1|\b(KEY)\b)\s*([:=])\s*
// where KEY is one to three whitespace-separated parts, each a letter followed
// by letters, digits, `_+.-` or `%XX`. Because the part characters include the
// hyphen while every letter after a hyphen is a word boundary, that expression
// restarts a suffix scan at each such letter and does quadratic work on a long
// hyphenated run without a separator. The tokenizer below walks the text once:
// at a candidate start it parses the parts forward, and when no separator
// follows, every later start inside the same part run would parse the same run
// to the same end and fail the same way, so the scan resumes after the run. The
// candidates it yields are exactly the expression's matches, in order, with the
// search resuming after each match as the global expression does.
// ---------------------------------------------------------------------------
const isAsciiLetterCode = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isAsciiDigitCode = (code) => code >= 48 && code <= 57;
const isWordCode = (code) => isAsciiLetterCode(code) || isAsciiDigitCode(code) || code === 95;
const isKeyCode = (code) => isWordCode(code) || code === 43 || code === 45 || code === 46;
const isHexCode = (code) => isAsciiDigitCode(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
// `\s` as the app's expressions see it, with a fast path for ASCII: the
// control range and the space, then the Unicode spaces only above Latin-1.
const isWhitespace = (character) => {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  if (code <= 32) return code === 32 || (code >= 9 && code <= 13);
  return code >= 160 && /\s/.test(character);
};
const isQuoteCode = (code) => code === 34 || code === 39;

/** End of the key part starting at `start`, whose first character is a letter. */
const keyPartEnd = (value, start) => {
  let index = start + 1;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (isKeyCode(code)) {
      index += 1;
    } else if (code === 37 && index + 2 < value.length
      && isHexCode(value.charCodeAt(index + 1)) && isHexCode(value.charCodeAt(index + 2))) {
      index += 3;
    } else {
      break;
    }
  }
  return index;
};

/** Ends of the one to three parts of the compound key starting at `start`, shortest first. */
const compoundKeyPartEnds = (value, start) => {
  const ends = [keyPartEnd(value, start)];
  while (ends.length < 3) {
    const partEnd = ends[ends.length - 1];
    let next = partEnd;
    while (next < value.length && isWhitespace(value[next])) next += 1;
    if (next === partEnd || next >= value.length || !isAsciiLetterCode(value.charCodeAt(next))) break;
    ends.push(keyPartEnd(value, next));
  }
  return ends;
};

/** The end of `\s*[:=]\s*` starting at `index`, or -1 when no separator follows. */
const assignmentSeparatorEnd = (value, index) => {
  while (index < value.length && isWhitespace(value[index])) index += 1;
  if (value[index] !== ':' && value[index] !== '=') return -1;
  index += 1;
  while (index < value.length && isWhitespace(value[index])) index += 1;
  return index;
};

/**
 * The assignment start the app's expression matches at exactly `index`, as
 * { index, end, key, keyQuote } where `end` follows the separator and its
 * trailing whitespace, or undefined. Longer compound keys are preferred, as the
 * greedy part repetition is.
 */
const matchAssignmentStartAt = (value, index) => {
  const code = value.charCodeAt(index);
  if (isQuoteCode(code)) {
    const keyQuote = value[index];
    if (!isAsciiLetterCode(value.charCodeAt(index + 1))) return undefined;
    const ends = compoundKeyPartEnds(value, index + 1);
    for (let part = ends.length - 1; part >= 0; part -= 1) {
      const keyEnd = ends[part];
      if (value[keyEnd] !== keyQuote) continue;
      const end = assignmentSeparatorEnd(value, keyEnd + 1);
      if (end !== -1) return { index, end, key: value.slice(index + 1, keyEnd), keyQuote };
    }
    return undefined;
  }
  if (!isAsciiLetterCode(code) || (index > 0 && isWordCode(value.charCodeAt(index - 1)))) return undefined;
  const ends = compoundKeyPartEnds(value, index);
  for (let part = ends.length - 1; part >= 0; part -= 1) {
    const keyEnd = ends[part];
    // The word boundary after the key: its last character must be a word character.
    if (!isWordCode(value.charCodeAt(keyEnd - 1))) continue;
    const end = assignmentSeparatorEnd(value, keyEnd);
    if (end !== -1) return { index, end, key: value.slice(index, keyEnd), keyQuote: undefined };
  }
  return undefined;
};

/** Every assignment start in `value`, in order, as matchAssignmentStartAt describes them. */
export const findAssignmentStarts = (value) => {
  chargeScannedCharacters(value.length);
  const matches = [];
  let index = 0;
  while (index < value.length) {
    const match = matchAssignmentStartAt(value, index);
    if (match) {
      chargeCandidates();
      matches.push(match);
      index = match.end;
      continue;
    }
    const code = value.charCodeAt(index);
    // A failed unquoted start: every later start in this part run fails the same way.
    index = isAsciiLetterCode(code) && (index === 0 || !isWordCode(value.charCodeAt(index - 1)))
      ? keyPartEnd(value, index)
      : index + 1;
  }
  return matches;
};

/**
 * The first assignment start at or after `from` that a delimiter precedes, as
 * the app's next-assignment expression `([,;&]|\s+)(?:…)\s*[:=]\s*` finds it:
 * { index, end, key, delimiter } where `index` is the delimiter's position (the
 * start of a whitespace run), or undefined.
 */
const findDelimitedAssignment = (value, from) => {
  let index = from;
  let found;
  while (index < value.length && !found) {
    const character = value[index];
    if (character === ',' || character === ';' || character === '&') {
      const match = matchAssignmentStartAt(value, index + 1);
      if (match) found = { index, end: match.end, key: match.key, delimiter: character };
      else index += 1;
    } else if (isWhitespace(character)) {
      let keyStart = index + 1;
      while (keyStart < value.length && isWhitespace(value[keyStart])) keyStart += 1;
      const match = matchAssignmentStartAt(value, keyStart);
      if (match) found = { index, end: match.end, key: match.key, delimiter: value.slice(index, keyStart) };
      else index = keyStart;
    } else {
      index += 1;
    }
  }
  chargeScannedCharacters((found ? found.end : value.length) - from);
  if (found) chargeCandidates();
  return found;
};

/**
 * Replaces each matched span with its replacement, as the app does by splicing
 * the spans into the string last to first. That splice costs a copy of the
 * string per span, which is quadratic on a string of many spans, so it is
 * computed here in one pass over the spans, which arrive in start order: the
 * text after the first span is built last span first as a list of segments,
 * and a span that overlaps the one after it drops the overlapped prefix of
 * that text, exactly as the app's slice at the span's end would. The app's
 * splice is kept only for spans out of start order, which no caller produces.
 */
const spliceMatches = (value, matches) => {
  if (matches.length === 0) return value;
  if (matches.some((match, index) => index > 0 && match.start < matches[index - 1].start)) {
    return matches.reduceRight((redacted, match) => (
      `${redacted.slice(0, match.start)}${match.replacement}${redacted.slice(match.end)}`
    ), value);
  }
  // Segments of the text after the first span, in reverse order; `offset` is
  // how much of a segment's front an overlapping earlier span has dropped.
  const reversed = [];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const { end, replacement } = matches[index];
    const gapEnd = index + 1 < matches.length ? matches[index + 1].start : value.length;
    if (end < gapEnd) {
      reversed.push({ text: value.slice(end, gapEnd), offset: 0 });
    } else {
      let drop = end - gapEnd;
      while (drop > 0 && reversed.length > 0) {
        const front = reversed[reversed.length - 1];
        const available = front.text.length - front.offset;
        if (available <= drop) {
          drop -= available;
          reversed.pop();
        } else {
          front.offset += drop;
          drop = 0;
        }
      }
    }
    reversed.push({ text: replacement, offset: 0 });
  }
  const parts = [value.slice(0, matches[0].start)];
  for (let index = reversed.length - 1; index >= 0; index -= 1) {
    const { text, offset } = reversed[index];
    parts.push(offset ? text.slice(offset) : text);
  }
  return parts.join('');
};

const redactSensitiveAssignments = (value) => {
  const matches = [];
  const surroundingQuoteAt = createSurroundingQuoteScanner(value);
  // The end of the line a value starts on, found once per line: positions are
  // asked for in increasing order, so the last line end found stays valid for
  // every position up to it, and many whole-line values on one line (several
  // `Authorization:` headers) cost the line once rather than once each.
  let lineEnd = -1;
  const lineEndFrom = (from) => {
    if (from > lineEnd) {
      lineEnd = from;
      while (lineEnd < value.length && !/[\r\n]/.test(value[lineEnd])) lineEnd += 1;
      chargeScannedCharacters(lineEnd - from);
    }
    return lineEnd;
  };
  let coveredUntil = -1;
  for (const match of findAssignmentStarts(value)) {
    const { keyQuote, key } = match;
    if (!isSensitiveQueryKey(key)) continue;
    const assignmentStartIndex = match.index;
    const valueStart = match.end;
    const matched = value.slice(assignmentStartIndex, valueStart);
    let valueEnd = valueStart;
    const quote = value[valueStart];
    const surroundingQuote = surroundingQuoteAt(assignmentStartIndex);
    const canonical = canonicalKey(key);
    const consumesEntireLine = !keyQuote && (
      ['authorization', 'proxyauthorization', 'xmcpauthorization'].includes(canonical)
      || ['cookie', 'setcookie', 'cookies'].includes(canonical)
    );
    let replacement = `${matched}${REDACTED_VALUE}`;
    if (consumesEntireLine) {
      valueEnd = lineEndFrom(valueStart);
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
      chargeScannedCharacters(valueEnd - valueStart);
      replacement = keyQuote
        ? `${matched}${quote}${REDACTED_VALUE}${quote}`
        : `${matched}${REDACTED_VALUE}`;
    } else if (quote === '{' || quote === '[') {
      valueEnd = balancedAssignmentValueEnd(value, valueStart) ?? lineEndFrom(valueStart);
      if (keyQuote) replacement = `${matched}${keyQuote}${REDACTED_VALUE}${keyQuote}`;
    } else {
      // The value runs to the end of the line or to the surrounding quote, cut
      // short by the first following assignment that a `,`, `;` or `&` or a
      // sensitive key after whitespace introduces. The app walks to the line
      // end and then looks for the cut; finding the cut first bounds the walk
      // by it, so many sensitive assignments on one line cost their own spans.
      let cut = value.length;
      let from = valueStart;
      let boundary;
      while ((boundary = findDelimitedAssignment(value, from)) !== undefined) {
        if (/[,;&]/.test(boundary.delimiter) || isSensitiveQueryKey(boundary.key)) {
          cut = boundary.index;
          break;
        }
        from = boundary.end;
      }
      while (valueEnd < cut && !/[\r\n]/.test(value[valueEnd])) {
        const character = value[valueEnd];
        if (character === '\\') valueEnd = Math.min(valueEnd + 1, value.length);
        else if (character === surroundingQuote) break;
        valueEnd += 1;
      }
      if (valueEnd > cut) valueEnd = cut;
      chargeScannedCharacters(Math.max(valueEnd, valueStart) - valueStart);
    }
    // Matches arrive in start order, so an earlier one contains this assignment
    // exactly when the furthest end reached so far is at or past its end.
    if (valueEnd > coveredUntil) {
      matches.push({ start: assignmentStartIndex, end: valueEnd, replacement });
      coveredUntil = valueEnd;
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
const ABSOLUTE_URL_PATTERN = new RegExp(String.raw`^${URL_SCHEME_SOURCE}://`, 'i');
export const ENCODED_REDACTED_VALUE = encodeURIComponent(REDACTED_VALUE);

// ---------------------------------------------------------------------------
// URL tokenizer
//
// The app discovers URLs in text with `\b[a-z][a-z0-9+.-]*://[^\s<>]+` (case-
// insensitive). Its scheme class accepts hyphens while its prefix needs a word
// boundary, so, like the assignment expression, it restarts a scheme scan at
// every letter after a hyphen and does quadratic work on a long hyphenated run
// without `://`. The tokenizer below finds each `://` once and reads the scheme
// run backwards from it: the match starts at the first letter of that run that
// follows a non-word character, and the body runs to the next whitespace, `<`
// or `>`. It yields exactly the expression's matches, in order.
// ---------------------------------------------------------------------------
const isSchemeCode = (code) => isAsciiLetterCode(code) || isAsciiDigitCode(code) || code === 43 || code === 45 || code === 46;
const isUrlBodyEnd = (character) => character === '<' || character === '>' || isWhitespace(character);
const TRAILING_URL_PUNCTUATION = new Set(['"', "'", ')', ',', '.', ';', '!', '?']);

/** Every `scheme://…` run in `value` as { start, end } spans, in order. */
export const findUrlsInText = (value) => {
  chargeScannedCharacters(value.length);
  const spans = [];
  let from = 0;
  for (;;) {
    const separator = value.indexOf('://', from);
    if (separator === -1) break;
    let runStart = separator;
    while (runStart > from && isSchemeCode(value.charCodeAt(runStart - 1))) runStart -= 1;
    let start = -1;
    for (let index = runStart; index < separator && start === -1; index += 1) {
      if (isAsciiLetterCode(value.charCodeAt(index)) && (index === 0 || !isWordCode(value.charCodeAt(index - 1)))) {
        start = index;
      }
    }
    let end = separator + 3;
    while (end < value.length && !isUrlBodyEnd(value[end])) end += 1;
    if (start === -1 || end === separator + 3) {
      // No match here; the expression goes on to try the positions after the
      // separator, where the body may itself begin a URL (`9a://b://c`).
      from = separator + 3;
      continue;
    }
    chargeCandidates();
    spans.push({ start, end });
    from = end;
  }
  return spans;
};

/**
 * Splits a URL candidate into the URL and the sentence punctuation that trails
 * it (`"'),.;!?`), walking back from the end so a body of punctuation costs
 * only its length.
 */
export const splitTrailingUrlPunctuation = (candidate) => {
  let urlEnd = candidate.length;
  while (urlEnd > 0 && TRAILING_URL_PUNCTUATION.has(candidate[urlEnd - 1])) urlEnd -= 1;
  return { url: candidate.slice(0, urlEnd), trailing: candidate.slice(urlEnd) };
};

const isAbsoluteUrl = (value) => {
  if (!ABSOLUTE_URL_PATTERN.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const redactUrlsInText = (value, depth) => spliceMatches(value, findUrlsInText(value).map(({ start, end }) => {
  const { url, trailing } = splitTrailingUrlPunctuation(value.slice(start, end));
  return { start, end, replacement: `${redactUrl(url, depth)}${trailing}` };
}));

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
// costs nothing more than its length. The host after the `@` starts with any
// character that is not a run boundary: an ASCII label, a bracketed IPv6
// address, a punycode label or an internationalized label (`éxample.com`),
// and the password between the colon and the `@` is likewise any run of
// non-boundary characters, so neither side is restricted to ASCII.
const USERINFO_RUN_BOUNDARY = /[\s/@]/;
const USERINFO_HOST_START = /[^\s/@]/y;

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
  chargeScannedCharacters(value.length);
  const spans = [];
  let runStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!USERINFO_RUN_BOUNDARY.test(character)) continue;
    if (character === '@') {
      const colon = firstUserinfoColon(value, runStart, index);
      USERINFO_HOST_START.lastIndex = index + 1;
      if (colon !== -1 && USERINFO_HOST_START.test(value)) {
        chargeCandidates();
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

const redactStandaloneJwtValues = (value) => {
  chargeScannedCharacters(value.length);
  return value.replace(new RegExp(JWT_PATTERN_SOURCE, 'g'), `$1${REDACTED_VALUE}`);
};
const redactSchemeCredentials = (value) => {
  chargeScannedCharacters(value.length);
  return value.replace(new RegExp(SCHEME_CREDENTIAL_PATTERN_SOURCE, 'gi'), `$1 ${REDACTED_VALUE}`);
};

const isObjectOrArrayText = (candidate) => (
  (candidate.startsWith('{') && candidate.endsWith('}')) || (candidate.startsWith('[') && candidate.endsWith(']'))
);

/**
 * Redacts a string that is JSON (an object, array or string literal, possibly
 * encoded several times). `parsedRaw` reports whether the text itself parsed as
 * an object or array: everything inside such a fragment was traversed, so a
 * fragment it encloses needs no scan of its own.
 */
const redactJsonShapedFragment = (value) => {
  const trimmed = value.trim();
  let candidate = trimmed;
  const encodings = [];
  let isStructured = false;
  let parsedRaw = false;
  for (let pass = 0; pass <= MAX_JSON_STRING_DECODE_PASSES; pass += 1) {
    const isObjectOrArray = isObjectOrArrayText(candidate);
    if (!isObjectOrArray && !candidate.startsWith('"')) return { redacted: value, parsedRaw };
    isStructured ||= isObjectOrArray;
    chargeScannedCharacters(candidate.length);
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      if (!isObjectOrArray) return { redacted: value, parsedRaw };
      if (pass === MAX_JSON_STRING_DECODE_PASSES) return { redacted: REDACTED_VALUE, parsedRaw };
      try {
        parsed = JSON.parse(`"${candidate}"`);
      } catch {
        return { redacted: value, parsedRaw };
      }
      if (parsed === candidate) return { redacted: value, parsedRaw };
      encodings.push('content');
    }
    if (typeof parsed === 'string') {
      const decoded = parsed.trim();
      const decodedIsStructured = isObjectOrArrayText(decoded);
      if (!decodedIsStructured && !decoded.startsWith('"')) return { redacted: value, parsedRaw };
      if (pass === MAX_JSON_STRING_DECODE_PASSES) {
        return { redacted: isStructured || decodedIsStructured ? REDACTED_VALUE : value, parsedRaw };
      }
      candidate = decoded;
      if (encodings.length === 0 || encodings[encodings.length - 1] !== 'content') encodings.push('literal');
      isStructured ||= decodedIsStructured;
      continue;
    }
    if (!parsed || typeof parsed !== 'object') return { redacted: value, parsedRaw };
    parsedRaw = pass === 0;
    const redacted = redactReportValueAtPath(parsed, undefined, []);
    let serialized = JSON.stringify(redacted);
    if (serialized === JSON.stringify(parsed)) return { redacted: value, parsedRaw };
    for (const encoding of [...encodings].reverse()) {
      const encoded = JSON.stringify(serialized);
      serialized = encoding === 'literal' ? encoded : encoded.slice(1, -1);
    }
    const start = value.indexOf(trimmed);
    return { redacted: `${value.slice(0, start)}${serialized}${value.slice(start + trimmed.length)}`, parsedRaw };
  }
  return { redacted: isStructured ? REDACTED_VALUE : value, parsedRaw };
};

const redactJsonShapedString = (value) => redactJsonShapedFragment(value).redacted;

export const JSON_STRING_LITERAL_PATTERN = /"(?:\\["\\/bfnrt]|\\u[A-Fa-f0-9]{4}|[^"\\\u0000-\u001f])*"/g;

const redactJsonEncodedStringLiterals = (value) => value.replace(JSON_STRING_LITERAL_PATTERN, (literal) => {
  chargeScannedCharacters(literal.length);
  chargeCandidates();
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

/**
 * Start → end (exclusive) of every balanced `{…}` / `[…]` span in one pass, the
 * guard's enumeration: with quote tracking, brackets inside JSON string literals
 * are ignored; without it, a stray quote in surrounding prose cannot hide a
 * fragment. A closer that does not match the innermost opener discards the
 * pending openers.
 */
const balancedFragmentSpans = (value, trackQuotes) => {
  chargeScannedCharacters(value.length);
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
 * Redacts JSON objects and arrays embedded anywhere in a string (`response: {…}`).
 * Only balanced fragments are tried, outermost first, and the fragments inside
 * one that parsed are covered by its traversal; the work is bounded by the
 * guard's parse budget, past which the string cannot be inspected and is
 * redacted whole rather than stored unseen.
 */
const redactEmbeddedJsonFragments = (value) => {
  if (!/[{[]/.test(value)) return value;
  const candidates = new Map();
  for (const trackQuotes of [true, false]) {
    for (const [start, end] of balancedFragmentSpans(value, trackQuotes)) candidates.set(`${start}:${end}`, [start, end]);
  }
  const spans = [...candidates.values()]
    .sort(([leftStart, leftEnd], [rightStart, rightEnd]) => leftStart - rightStart || rightEnd - leftEnd);
  const matches = [];
  let budget = value.length * MAX_EMBEDDED_FRAGMENT_PARSE_RATIO;
  let coveredUntil = 0;
  for (const [start, end] of spans) {
    if (start < coveredUntil) continue;
    const fragment = value.slice(start, end);
    budget -= fragment.length;
    if (budget < 0) return REDACTED_VALUE;
    chargeCandidates();
    const { redacted, parsedRaw } = redactJsonShapedFragment(fragment);
    if (redacted !== fragment) {
      matches.push({ start, end, replacement: redacted });
      coveredUntil = end;
    } else if (parsedRaw) {
      coveredUntil = end;
    }
  }
  return spliceMatches(value, matches);
};

const redactReportStringAtDepth = (value, urlDepth) => {
  let redacted = redactEmbeddedJsonFragments(redactJsonEncodedStringLiterals(redactJsonShapedString(value)));
  for (let pass = 0; pass < MAX_REDACTION_PASSES; pass += 1) {
    const redactedAssignments = redactSchemeCredentials(redactSensitiveAssignments(redacted));
    const next = redactBareUserinfo(redactUrlsInText(redactStandaloneJwtValues(redactedAssignments), urlDepth));
    if (next === redacted) break;
    redacted = next;
  }
  return redacted;
};

/**
 * The app's string redaction: assignments, scheme credentials, JWTs, URLs and
 * JSON in text. Charged to the active inspection budget, or to a fresh default
 * one when called on its own, so a standalone call is bounded the same way.
 */
export const redactReportString = (value) => underInspectionBudget(() => redactReportStringAtDepth(value, 0));

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

/**
 * The app's value redaction: sensitive keys become the marker, every string is
 * redacted. Runs under the active inspection budget, or a fresh default one.
 */
export const redactReportValue = (value, key) => underInspectionBudget(() => (
  redactReportValueAtPath(value, key, key ? [key] : [])
));
