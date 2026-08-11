import { z } from 'zod';
import packageJson from '../../package.json';
import {
  getEvaluationMaxScore,
  hasLegacyIncompleteEvaluationEvidence,
  isLegacySkippedEvaluationSection,
  resolveEvaluationOutcome,
  type DetailItem,
  type EvaluationReport,
  type EvaluationSection,
} from './evaluation';
import { VERSION_INFO } from './versionInfo';

export const REPORT_SCHEMA_VERSION = '1.0.0' as const;
export const REPORT_SCHEMA_URL = 'https://mcptest.io/schemas/report/v1.schema.json' as const;
export const REDACTED_VALUE = '[REDACTED]' as const;

const SCORE_PERCENTAGE_TOLERANCE = 1e-9;
const MAX_REDACTION_PASSES = 8;
const MAX_URL_REDACTION_DEPTH = 4;
const MAX_URL_COMPONENT_DECODE_PASSES = 4;
const MAX_JSON_STRING_DECODE_PASSES = 4;

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

const SectionScoreSchema = z.object({
  earned: z.number().nonnegative().nullable(),
  maximum: z.number().nonnegative(),
}).strict();

const EvidenceSchema = z.object({
  message: z.string(),
  context: z.string().optional(),
  metadata: JsonValueSchema.optional(),
}).strict();

const ReportSectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(['evaluated', 'partial', 'failed', 'skipped', 'prerequisite']),
  score: SectionScoreSchema,
  evidence: z.array(EvidenceSchema),
}).strict();

const PublicReportObjectSchema = z.object({
  $schema: z.literal(REPORT_SCHEMA_URL),
  artifactType: z.literal('mcptest.report'),
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  generator: z.object({
    name: z.literal('mcptest'),
    version: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
  }).strict(),
  target: z.object({
    testedEndpoint: z.string().min(1),
    authenticationEndpoint: z.string().min(1).optional(),
    negotiatedEndpoint: z.string().min(1).optional(),
  }).strict(),
  provenance: z.object({
    route: z.enum(['direct', 'authenticated-proxy', 'unknown']),
    proxyUsed: z.boolean().nullable(),
    attempts: z.array(z.object({
      route: z.enum(['direct', 'authenticated-proxy']),
      result: z.literal('failed'),
    }).strict()).min(1).optional(),
  }).strict(),
  outcome: z.object({
    status: z.enum(['scored', 'authorization-required', 'partial', 'failed']),
    summary: z.string().min(1),
    authorizationPrerequisite: z.object({
      required: z.literal(true),
      state: z.literal('authorization-required'),
      message: z.string().min(1),
    }).strict().optional(),
  }).strict(),
  score: z.object({
    earned: z.number().nonnegative(),
    maximum: z.number().positive(),
    percentage: z.number().min(0).max(100),
  }).strict().nullable(),
  protocol: z.object({
    era: z.string().min(1),
    version: z.string().min(1).optional(),
  }).strict().optional(),
  transport: z.object({
    type: z.string().min(1),
  }).strict().optional(),
  timings: z.object({
    negotiationMs: z.number().nonnegative().optional(),
    connectionSetupMs: z.number().nonnegative().optional(),
    checks: z.array(z.object({
      name: z.string().min(1),
      durationMs: z.number().nonnegative(),
    }).strict()),
  }).strict().optional(),
  sections: z.array(ReportSectionSchema),
}).strict();

export const PublicReportSchema = PublicReportObjectSchema.superRefine((report, context) => {
  const isScored = report.outcome.status === 'scored';
  if (isScored && report.score === null) {
    context.addIssue({
      code: 'custom',
      path: ['score'],
      message: 'A scored report must include an overall score.',
    });
  }
  if (!isScored && report.score !== null) {
    context.addIssue({
      code: 'custom',
      path: ['score'],
      message: 'Authorization-required, partial, and failed reports must not include an overall score.',
    });
  }
  if (report.outcome.status === 'authorization-required'
      && !report.outcome.authorizationPrerequisite) {
    context.addIssue({
      code: 'custom',
      path: ['outcome', 'authorizationPrerequisite'],
      message: 'An authorization-required report must describe its prerequisite.',
    });
  }
  if (report.outcome.status !== 'authorization-required'
      && report.outcome.authorizationPrerequisite) {
    context.addIssue({
      code: 'custom',
      path: ['outcome', 'authorizationPrerequisite'],
      message: 'Only an authorization-required report may describe an authorization prerequisite.',
    });
  }
  const expectedProxyUsed = report.provenance.route === 'direct'
    ? false
    : report.provenance.route === 'authenticated-proxy'
      ? true
      : null;
  if (report.provenance.proxyUsed !== expectedProxyUsed) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'proxyUsed'],
      message: `proxyUsed must be ${String(expectedProxyUsed)} when route is ${report.provenance.route}.`,
    });
  }
  if (report.score && report.score.earned > report.score.maximum) {
    context.addIssue({
      code: 'custom',
      path: ['score', 'earned'],
      message: 'The earned score cannot exceed the maximum score.',
    });
  }
  if (report.score) {
    const expectedPercentage = report.score.earned / report.score.maximum * 100;
    if (Math.abs(report.score.percentage - expectedPercentage) > SCORE_PERCENTAGE_TOLERANCE) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'percentage'],
        message: 'The percentage must equal earned / maximum * 100.',
      });
    }
  }
  if (isScored && report.score) {
    const sectionEarnedTotal = report.sections.reduce(
      (total, section) => total + (section.score.earned ?? 0),
      0
    );
    const sectionMaximumTotal = report.sections.reduce(
      (total, section) => total + section.score.maximum,
      0
    );
    if (Math.abs(report.score.earned - sectionEarnedTotal) > SCORE_PERCENTAGE_TOLERANCE) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'earned'],
        message: 'The overall earned score must equal the sum of the section earned scores.',
      });
    }
    if (Math.abs(report.score.maximum - sectionMaximumTotal) > SCORE_PERCENTAGE_TOLERANCE) {
      context.addIssue({
        code: 'custom',
        path: ['score', 'maximum'],
        message: 'The overall maximum score must equal the sum of the section maximum scores.',
      });
    }
  }
  if (isScored) {
    for (const [index, section] of report.sections.entries()) {
      if (section.status !== 'evaluated' || section.score.earned === null) {
        context.addIssue({
          code: 'custom',
          path: ['sections', index],
          message: 'Every section in a scored report must be evaluated with an earned score.',
        });
      }
    }
  }
  for (const [index, section] of report.sections.entries()) {
    if (section.status === 'evaluated' && section.score.earned === null) {
      context.addIssue({
        code: 'custom',
        path: ['sections', index, 'score', 'earned'],
        message: 'An evaluated section must include an earned score.',
      });
    }
    if ((section.status === 'skipped' || section.status === 'failed' || section.status === 'prerequisite')
        && section.score.earned !== null) {
      context.addIssue({
        code: 'custom',
        path: ['sections', index, 'score', 'earned'],
        message: `A ${section.status} section must not include an earned score.`,
      });
    }
    if (section.score.earned !== null && section.score.earned > section.score.maximum) {
      context.addIssue({
        code: 'custom',
        path: ['sections', index, 'score', 'earned'],
        message: 'The earned section score cannot exceed its maximum score.',
      });
    }
  }
});

export type PublicReport = z.infer<typeof PublicReportSchema>;
export type PublicReportOutcome = PublicReport['outcome']['status'];

export interface CreatePublicReportOptions {
  /** Required for reproducible artifacts. Defaults to the current time. */
  generatedAt?: string | Date;
  toolVersion?: string;
  toolCommit?: string;
}

const EXACT_SENSITIVE_KEYS = new Set([
  'key',
  'accesskey',
  'subscriptionkey',
  'authorization',
  'proxyauthorization',
  'xmcpauthorization',
  'cookie',
  'setcookie',
  'cookies',
  'password',
  'passwd',
  'secret',
  'secrets',
  'clientsecret',
  'credential',
  'credentials',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'jwt',
  'idtokenhint',
  'clientassertion',
  'devicecode',
  'usercode',
  'apikey',
  'xapikey',
  'authorizationcode',
  'authorizationcodes',
  'oauthcode',
  'oauthcodes',
  'code',
  'token',
  'tokens',
  'sid',
  'sessionid',
  'phpsessid',
  'connectsid',
  'signature',
  'sig',
  'privatekey',
  'auth',
  'codeverifier',
  'state',
  'nonce',
  'csrf',
]);

const canonicalKey = (key: string): string => (
  key.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
);

const SENSITIVE_KEY_COMPONENTS = new Set([
  'auth',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'secrets',
  'token',
  'tokens',
  'signature',
]);

const NON_SENSITIVE_COMPOUND_KEYS = new Set([
  'codechallengemethodssupported',
]);

const WRAPPED_CREDENTIAL_KEY = /(?:api|private)key(?:value|header)$/;
const SESSION_CREDENTIAL_KEY = /(?:session|sessionid|sessionkey|sessiontoken)s?$/;

const keyComponents = (key: string): string[] => key
  .trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

const isSensitiveKey = (key: string): boolean => {
  const canonical = canonicalKey(key);
  if (NON_SENSITIVE_COMPOUND_KEYS.has(canonical)) return false;
  const components = keyComponents(key);
  if (components.some((component) => SENSITIVE_KEY_COMPONENTS.has(component))) {
    return true;
  }
  return EXACT_SENSITIVE_KEYS.has(canonical)
    || /(?:tokens?|secrets?|password|passwd|credentials?|authorizationcodes?|oauthcodes?|apikey|privatekey)$/.test(canonical)
    || WRAPPED_CREDENTIAL_KEY.test(canonical)
    || SESSION_CREDENTIAL_KEY.test(canonical)
    || components.includes('code')
      && components.some((component) => component === 'authorization' || component === 'oauth');
};

const decodeFormComponent = (value: string): string => (
  decodeURIComponent(value.replace(/\+/g, ' '))
);

const isSensitiveQueryKey = (key: string): boolean => {
  let decoded = key;

  for (let pass = 0; pass <= MAX_URL_COMPONENT_DECODE_PASSES; pass += 1) {
    if (isSensitiveKey(decoded)) return true;

    let next: string;
    try {
      next = decodeFormComponent(decoded);
    } catch {
      return false;
    }
    if (next === decoded) return false;
    if (pass === MAX_URL_COMPONENT_DECODE_PASSES) return true;
    decoded = next;
  }

  return true;
};

const balancedAssignmentValueEnd = (value: string, start: number): number | undefined => {
  const opening = value[start];
  if (opening !== '{' && opening !== '[') return undefined;

  const stack = [opening];
  let quote: '"' | "'" | undefined;

  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{' || character === '[') {
      stack.push(character);
    } else if (character === '}' || character === ']') {
      const expectedOpening = character === '}' ? '{' : '[';
      if (stack[stack.length - 1] !== expectedOpening) return undefined;
      stack.pop();
      if (stack.length === 0) return index + 1;
    }
  }

  return undefined;
};

const surroundingQuoteAt = (value: string, end: number): '"' | "'" | undefined => {
  let quote: '"' | "'" | undefined;
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

const redactSensitiveAssignments = (value: string): string => {
  const matches: Array<{ start: number; end: number; replacement: string }> = [];
  const keyPart = String.raw`[A-Za-z](?:[A-Za-z0-9_+.-]|%[A-Fa-f0-9]{2})*`;
  const compoundKey = `${keyPart}(?:\\s+${keyPart}){0,2}`;
  const assignmentStart = new RegExp(
    `(?:(['"])(` + compoundKey + `)\\1|\\b(` + compoundKey + `)\\b)\\s*([:=])\\s*`,
    'g'
  );
  const nextAssignment = new RegExp(
    `([,;&]|\\s+)(?:(['"])(` + compoundKey + `)\\2|\\b(` + compoundKey + `)\\b)\\s*[:=]\\s*`,
    'g'
  );
  let match: RegExpExecArray | null;

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
      let boundary: RegExpExecArray | null;
      while ((boundary = nextAssignment.exec(value)) !== null && boundary.index < valueEnd) {
        const delimiter = boundary[1];
        const nextKey = boundary[3] || boundary[4];
        if (/[,;&]/.test(delimiter) || isSensitiveQueryKey(nextKey)) {
          valueEnd = boundary.index;
          break;
        }
      }
    }
    if (!matches.some((assignment) => (
      assignment.start <= assignmentStartIndex && assignment.end >= valueEnd
    ))) {
      matches.push({ start: assignmentStartIndex, end: valueEnd, replacement });
    }
  }

  return matches.reduceRight((redacted, assignment) => (
    `${redacted.slice(0, assignment.start)}${assignment.replacement}${redacted.slice(assignment.end)}`
  ), value);
};

const redactEncodedUrlComponent = (
  value: string,
  depth: number,
  failClosedOnInvalidEncoding = false
): string => {
  let decoded = value;
  let decodedLayers = 0;

  for (let pass = 0; pass <= MAX_URL_COMPONENT_DECODE_PASSES; pass += 1) {
    const redacted = redactReportStringAtDepth(decoded, depth);
    if (redacted !== decoded) {
      let reencoded = redacted;
      for (let layer = 0; layer < decodedLayers; layer += 1) {
        reencoded = encodeURIComponent(reencoded);
      }
      return reencoded;
    }

    try {
      if (/^https?:$/.test(new URL(decoded).protocol)) return value;
    } catch {
      // Continue decoding non-URL component values.
    }

    let next: string;
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

const redactUrl = (value: string, depth = 0): string => {
  if (depth >= MAX_URL_REDACTION_DEPTH) return REDACTED_VALUE;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (!/^https?:$/.test(url.protocol)) return value;
  if (url.username) url.username = REDACTED_VALUE;
  if (url.password) url.password = REDACTED_VALUE;
  url.pathname = url.pathname
    .split('/')
    .map((component) => redactEncodedUrlComponent(component, depth + 1, true))
    .join('/');
  const redactedSearchParams = new URLSearchParams();
  for (const [key, queryValue] of [...url.searchParams.entries()]) {
    if (isSensitiveQueryKey(key)) {
      redactedSearchParams.append(key, REDACTED_VALUE);
    } else {
      const redactedQueryValue = redactEncodedUrlComponent(queryValue, depth + 1);
      redactedSearchParams.append(key, redactedQueryValue);
    }
  }
  url.search = redactedSearchParams.toString();
  if (url.hash) url.hash = `#${REDACTED_VALUE}`;
  return url.toString();
};

const redactUrlsInText = (value: string, depth: number): string => value.replace(
  /https?:\/\/[^\s<>]+/gi,
  (candidate) => {
    const trailing = candidate.match(/["'),.;!?]+$/)?.[0] || '';
    const url = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${redactUrl(url, depth)}${trailing}`;
  }
);

const redactStandaloneJwtValues = (value: string): string => value.replace(
  /(^|[^A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?=$|[^A-Za-z0-9_-])/g,
  `$1${REDACTED_VALUE}`
);

const redactJsonShapedString = (value: string): string => {
  const trimmed = value.trim();
  let candidate = trimmed;
  const encodings: Array<'literal' | 'content'> = [];
  let isStructured = false;

  for (let pass = 0; pass <= MAX_JSON_STRING_DECODE_PASSES; pass += 1) {
    const isObjectOrArray = (candidate.startsWith('{') && candidate.endsWith('}'))
      || (candidate.startsWith('[') && candidate.endsWith(']'));
    if (!isObjectOrArray && !candidate.startsWith('"')) return value;
    isStructured ||= isObjectOrArray;

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate) as unknown;
    } catch {
      if (!isObjectOrArray) return value;
      if (pass === MAX_JSON_STRING_DECODE_PASSES) return REDACTED_VALUE;
      try {
        parsed = JSON.parse(`"${candidate}"`) as unknown;
      } catch {
        return value;
      }
      if (parsed === candidate) return value;
      encodings.push('content');
    }

    if (typeof parsed === 'string') {
      const decoded = parsed.trim();
      const decodedIsStructured = (decoded.startsWith('{') && decoded.endsWith('}'))
        || (decoded.startsWith('[') && decoded.endsWith(']'));
      if (!decodedIsStructured && !decoded.startsWith('"')) return value;
      if (pass === MAX_JSON_STRING_DECODE_PASSES) {
        return isStructured || decodedIsStructured ? REDACTED_VALUE : value;
      }
      candidate = decoded;
      if (encodings.length === 0 || encodings[encodings.length - 1] !== 'content') {
        encodings.push('literal');
      }
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

const redactJsonEncodedStringLiterals = (value: string): string => value.replace(
  /"(?:\\["\\/bfnrt]|\\u[A-Fa-f0-9]{4}|[^"\\\u0000-\u001f])*"/g,
  (literal) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(literal) as unknown;
    } catch {
      return literal;
    }
    if (typeof decoded !== 'string') return literal;
    const redacted = redactJsonShapedString(decoded);
    return redacted === decoded ? literal : JSON.stringify(redacted);
  }
);

const redactEmbeddedJsonFragments = (value: string): string => {
  const matches: Array<{ start: number; end: number; replacement: string }> = [];

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

  return matches.reduceRight((redacted, match) => (
    `${redacted.slice(0, match.start)}${match.replacement}${redacted.slice(match.end)}`
  ), value);
};

const redactReportStringAtDepth = (value: string, urlDepth: number): string => {
  let redacted = redactEmbeddedJsonFragments(
    redactJsonEncodedStringLiterals(redactJsonShapedString(value))
  );
  for (let pass = 0; pass < MAX_REDACTION_PASSES; pass += 1) {
    const redactedAssignments = redactSensitiveAssignments(redacted)
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED_VALUE}`);
    const redactedCredentials = redactStandaloneJwtValues(redactedAssignments);
    const next = redactUrlsInText(redactedCredentials, urlDepth);
    if (next === redacted) break;
    redacted = next;
  }
  return redacted;
};

export const redactReportString = (value: string): string => redactReportStringAtDepth(value, 0);

const isAuthorizationPrerequisiteSchemaField = (path: readonly string[]): boolean => (
  (path.length === 2
    && path[0] === 'outcome'
    && path[1] === 'authorizationPrerequisite')
  || (path.length === 3
    && path[0] === 'outcome'
    && path[1] === 'authorizationPrerequisite'
    && path[2] === 'state')
);

const isJsonRpcErrorCode = (
  value: unknown,
  key: string,
  path: readonly string[]
): boolean => (
  canonicalKey(key) === 'code'
  && canonicalKey(path[path.length - 2] || '') === 'error'
  && typeof value === 'number'
  && Number.isInteger(value)
);

const redactReportValueAtPath = (
  value: unknown,
  key: string | undefined,
  path: readonly string[]
): unknown => {
  if (key
    && isSensitiveQueryKey(key)
    && !isAuthorizationPrerequisiteSchemaField(path)
    && !isJsonRpcErrorCode(value, key, path)) {
    return REDACTED_VALUE;
  }
  if (value === undefined) return undefined;
  if (typeof value === 'string') return redactReportString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactReportValueAtPath(item, undefined, [
      ...path,
      String(index),
    ]));
  }
  if (value && typeof value === 'object') {
    const redactedKeys = new Set<string>();
    // Sort the source keys so collision suffixes do not depend on insertion order.
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .filter(([, childValue]) => childValue !== undefined)
      .map(([childKey, childValue]) => {
        const redactedKey = redactReportString(childKey);
        let uniqueKey = redactedKey;
        for (let collision = 2; redactedKeys.has(uniqueKey); collision += 1) {
          uniqueKey = `${redactedKey}#${collision}`;
        }
        redactedKeys.add(uniqueKey);
        return [
          uniqueKey,
          redactReportValueAtPath(childValue, childKey, [...path, childKey]),
        ];
      }));
  }
  return String(value);
};

/** Recursively redacts sensitive keys and values while retaining JSON-safe evidence. */
export const redactReportValue = (value: unknown, key?: string): unknown => (
  redactReportValueAtPath(value, key, key ? [key] : [])
);

const metadataRecords = (report: EvaluationReport): Record<string, unknown>[] => (
  Object.values(report.sections).flatMap((section) => section.details)
    .map((detail) => detail.metadata)
    .filter((metadata): metadata is Record<string, unknown> => (
      Boolean(metadata) && typeof metadata === 'object' && !Array.isArray(metadata)
    ))
);

const metadataString = (
  records: readonly Record<string, unknown>[],
  key: string
): string | undefined => {
  for (const record of records) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return undefined;
};

const metadataNumber = (
  records: readonly Record<string, unknown>[],
  key: string
): number | undefined => {
  for (const record of records) {
    if (typeof record[key] === 'number' && record[key] >= 0) return record[key] as number;
  }
  return undefined;
};

const publicRoute = (value: unknown): PublicReport['provenance']['route'] => (
  value === 'direct'
    ? 'direct'
    : value === 'proxy' || value === 'authenticated proxy' || value === 'authenticated-proxy'
      ? 'authenticated-proxy'
      : 'unknown'
);

const failedRouteAttempts = (
  records: readonly Record<string, unknown>[]
): NonNullable<PublicReport['provenance']['attempts']> => records.flatMap((record) => (
  Array.isArray(record.routeFailures)
    ? record.routeFailures.flatMap((failure) => {
      if (!failure || typeof failure !== 'object' || Array.isArray(failure)) return [];
      const route = publicRoute((failure as Record<string, unknown>).route);
      return route === 'unknown' ? [] : [{ route, result: 'failed' as const }];
    })
    : []
));

const sectionStatus = (
  id: string,
  section: EvaluationSection,
  outcome: PublicReportOutcome,
  inferLegacyStatus: boolean
): PublicReport['sections'][number]['status'] => {
  if (id === 'auth') return 'prerequisite';
  if (section.status) return section.status;
  if (!inferLegacyStatus && outcome === 'scored') return 'evaluated';
  if (isLegacySkippedEvaluationSection(section)) return outcome === 'failed' && id === 'protocol'
    ? 'failed'
    : 'skipped';
  if (hasLegacyIncompleteEvaluationEvidence(section)) return 'partial';
  return 'evaluated';
};

const redactEvidence = (detail: DetailItem): PublicReport['sections'][number]['evidence'][number] => ({
  message: detail.text,
  ...(detail.context ? { context: detail.context } : {}),
  ...(detail.metadata !== undefined ? { metadata: detail.metadata } : {}),
});

const normalizeGeneratedAt = (generatedAt: string | Date | undefined): string => {
  const value = generatedAt instanceof Date
    ? generatedAt
    : generatedAt === undefined
      ? new Date()
      : new Date(generatedAt);
  if (Number.isNaN(value.getTime())) throw new Error('generatedAt must be a valid date');
  return value.toISOString();
};

const outcomeSummary = (outcome: PublicReportOutcome): string => {
  switch (outcome) {
    case 'authorization-required':
      return 'Authorization is a prerequisite; this run was not scored.';
    case 'partial':
      return 'The run was only partially evaluated and no overall grade was assigned.';
    case 'failed':
      return 'The evaluation did not complete and no overall grade was assigned.';
    default:
      return 'The evaluation completed and was scored.';
  }
};

export const createPublicReport = (
  report: EvaluationReport,
  options: CreatePublicReportOptions = {}
): PublicReport => {
  const outcome = resolveEvaluationOutcome(report);
  const metadata = metadataRecords(report);
  const routeValue = metadataString(metadata, 'route');
  const route = publicRoute(routeValue);
  const routeAttempts = outcome === 'failed' ? failedRouteAttempts(metadata) : [];
  const protocolEra = metadataString(metadata, 'protocolEra');
  const protocolVersion = metadataString(metadata, 'protocolVersion');
  const transportType = metadataString(metadata, 'transportType');
  const negotiationMetadata = ['protocol', 'transport'].flatMap((sectionId) => (
    report.sections[sectionId]?.details || []
  )).map((detail) => detail.metadata)
    .filter((value): value is Record<string, unknown> => (
      Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ));
  const negotiatedEndpoint = metadataString(negotiationMetadata, 'endpoint');
  const negotiationMs = metadataNumber(metadata, 'negotiationMs');
  const connectionSetupMs = report.sections.performance?.details
    .map((detail) => (detail.metadata as { durationMs?: unknown } | undefined)?.durationMs)
    .find((duration): duration is number => typeof duration === 'number' && duration >= 0);
  const checks = Object.values(report.sections).flatMap((section) => section.details)
    .flatMap((detail) => {
      const detailMetadata = detail.metadata as { method?: unknown; durationMs?: unknown } | undefined;
      return typeof detailMetadata?.method === 'string' && typeof detailMetadata.durationMs === 'number'
        ? [{ name: detailMetadata.method, durationMs: detailMetadata.durationMs }]
        : [];
    });
  const maximum = getEvaluationMaxScore(report);
  const generatorVersion = options.toolVersion ?? packageJson.version;
  const generatorCommit = options.toolCommit ?? (
    VERSION_INFO.commitHash && VERSION_INFO.commitHash !== 'unknown' ? VERSION_INFO.commitHash : undefined
  );

  const artifact: PublicReport = {
    $schema: REPORT_SCHEMA_URL,
    artifactType: 'mcptest.report',
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: normalizeGeneratedAt(options.generatedAt),
    generator: {
      name: 'mcptest',
      ...(generatorVersion ? { version: generatorVersion } : {}),
      ...(generatorCommit ? { commit: generatorCommit } : {}),
    },
    target: {
      testedEndpoint: redactReportString(report.serverUrl),
      ...(report.authenticationUrl
        ? { authenticationEndpoint: redactReportString(report.authenticationUrl) }
        : {}),
      ...(negotiatedEndpoint
        ? { negotiatedEndpoint: redactReportString(negotiatedEndpoint) }
        : {}),
    },
    provenance: {
      route,
      proxyUsed: route === 'unknown' ? null : route === 'authenticated-proxy',
      ...(routeAttempts.length > 0 ? { attempts: routeAttempts } : {}),
    },
    outcome: {
      status: outcome,
      summary: outcomeSummary(outcome),
      ...(outcome === 'authorization-required' ? {
        authorizationPrerequisite: {
          required: true,
          state: 'authorization-required',
          message: 'Authorize access to the MCP server, then run the evaluation again.',
        },
      } : {}),
    },
    score: outcome === 'scored' && maximum > 0 ? {
      earned: report.finalScore,
      maximum,
      percentage: report.finalScore / maximum * 100,
    } : null,
    ...(protocolEra ? {
      protocol: {
        era: protocolEra,
        ...(protocolVersion ? { version: protocolVersion } : {}),
      },
    } : {}),
    ...(transportType ? { transport: { type: transportType } } : {}),
    ...(negotiationMs !== undefined || connectionSetupMs !== undefined || checks.length > 0 ? {
      timings: {
        ...(negotiationMs !== undefined ? { negotiationMs } : {}),
        ...(connectionSetupMs !== undefined ? { connectionSetupMs } : {}),
        checks,
      },
    } : {}),
    sections: Object.entries(report.sections).map(([id, section]) => {
      const status = sectionStatus(id, section, outcome, report.outcome === undefined);
      return {
        id,
        name: section.name,
        description: section.description,
        status,
        score: {
          earned: status === 'skipped' || status === 'failed' || status === 'prerequisite'
            ? null
            : section.score,
          maximum: section.maxScore,
        },
        evidence: section.details.map(redactEvidence),
      };
    }),
  };

  return PublicReportSchema.parse(redactReportValue(artifact));
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
};

/** Produces byte-stable JSON for the same report artifact. */
export const serializePublicReportJson = (report: PublicReport): string => {
  const validated = PublicReportSchema.parse(report);
  const redacted = PublicReportSchema.parse(redactReportValue(validated));
  return `${JSON.stringify(stableValue(redacted), null, 2)}\n`;
};

const markdownInline = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/([`*_{}\[\]<>])/g, '\\$1')
  .replace(/[\r\n]+/g, ' ');

const scoreLabel = (section: PublicReport['sections'][number]): string => (
  section.score.earned === null
    ? `Not scored (maximum ${section.score.maximum})`
    : `${section.score.earned} / ${section.score.maximum}`
);

/** Produces deterministic, standalone human-readable Markdown. */
export const serializePublicReportMarkdown = (report: PublicReport): string => {
  const validated = PublicReportSchema.parse(report);
  const value = PublicReportSchema.parse(redactReportValue(validated));
  const lines = [
    '# mcptest Evaluation Report',
    '',
    `- Schema: ${value.schemaVersion}`,
    `- Generated: ${value.generatedAt}`,
    `- Generator: ${value.generator.name}${value.generator.version ? ` ${markdownInline(value.generator.version)}` : ''}${value.generator.commit ? ` (${markdownInline(value.generator.commit)})` : ''}`,
    `- Tested endpoint: ${markdownInline(value.target.testedEndpoint)}`,
    '',
    '## Outcome',
    '',
    `**${markdownInline(value.outcome.status)}** — ${markdownInline(value.outcome.summary)}`,
    '',
  ];

  if (value.outcome.authorizationPrerequisite) {
    lines.push(
      '> Authorization is a prerequisite, not a failed 0% grade. This run was not scored.',
      '',
      markdownInline(value.outcome.authorizationPrerequisite.message),
      ''
    );
  }

  lines.push('## Score', '');
  if (value.score) {
    lines.push(`${value.score.earned} / ${value.score.maximum} (${value.score.percentage.toFixed(2)}%)`, '');
  } else {
    lines.push('Not scored.', '');
  }

  lines.push(
    '## Endpoint and provenance',
    '',
    `- Tested endpoint: ${markdownInline(value.target.testedEndpoint)}`,
    ...(value.target.authenticationEndpoint
      ? [`- Authorization endpoint: ${markdownInline(value.target.authenticationEndpoint)}`]
      : []),
    ...(value.target.negotiatedEndpoint
      ? [`- Negotiated endpoint: ${markdownInline(value.target.negotiatedEndpoint)}`]
      : []),
    `- Route: ${value.provenance.route}`,
    `- Proxy used: ${value.provenance.proxyUsed === null ? 'unknown' : value.provenance.proxyUsed ? 'yes' : 'no'}`,
    ...((value.provenance.attempts || []).map((attempt) => (
      `- Attempt: ${attempt.route} (${attempt.result})`
    ))),
    ''
  );

  if (value.protocol || value.transport) {
    lines.push('## Protocol and transport', '');
    if (value.protocol) {
      lines.push(`- Protocol era: ${markdownInline(value.protocol.era)}`);
      if (value.protocol.version) lines.push(`- Protocol version: ${markdownInline(value.protocol.version)}`);
    }
    if (value.transport) lines.push(`- Transport: ${markdownInline(value.transport.type)}`);
    lines.push('');
  }

  if (value.timings) {
    lines.push('## Timings', '');
    if (value.timings.negotiationMs !== undefined) {
      lines.push(`- Negotiation: ${value.timings.negotiationMs} ms`);
    }
    if (value.timings.connectionSetupMs !== undefined) {
      lines.push(`- Connection setup (endpoint selection through MCP negotiation): ${value.timings.connectionSetupMs} ms`);
    }
    for (const check of value.timings.checks) {
      lines.push(`- ${markdownInline(check.name)}: ${check.durationMs} ms`);
    }
    lines.push('');
  }

  lines.push('## Sections', '');
  for (const section of value.sections) {
    lines.push(
      `### ${markdownInline(section.name)}`,
      '',
      `Status: ${section.status}`,
      '',
      `Score: ${scoreLabel(section)}`,
      '',
      markdownInline(section.description),
      ''
    );
    for (const evidence of section.evidence) {
      lines.push(`- ${markdownInline(evidence.message)}`);
      if (evidence.context) lines.push(`  - Context: ${markdownInline(evidence.context)}`);
      if (evidence.metadata !== undefined) {
        lines.push('  - Metadata:', '', '    ```json');
        for (const metadataLine of JSON.stringify(stableValue(evidence.metadata), null, 2).split('\n')) {
          lines.push(`    ${metadataLine}`);
        }
        lines.push('    ```');
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
};

export const parsePublicReportJson = (json: string): PublicReport => (
  PublicReportSchema.parse(JSON.parse(json))
);

export const validatePublicReport = (value: unknown): PublicReport => (
  PublicReportSchema.parse(value)
);

export const safeParsePublicReport = (value: unknown) => PublicReportSchema.safeParse(value);
