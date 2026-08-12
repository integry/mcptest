import { z } from 'zod';
import packageJson from '../../package.json';
import type { CompatibilityMatrixV1 } from '../compatibility';
import type { ToolSurfaceAnalysisV1 } from '../types/toolSurfaceAnalysis';
import {
  getEvaluationMaxScore,
  hasLegacyIncompleteEvaluationEvidence,
  isLegacySkippedEvaluationSection,
  resolveEvaluationOutcome,
  type DetailItem,
  type EvaluationReport,
  type EvaluationSection,
} from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import type { ReleaseDecision } from './releaseReadiness';
import { VERSION_INFO } from './versionInfo';

export const REPORT_SCHEMA_VERSION = '2.0.0' as const;
export const REPORT_SCHEMA_URL = 'https://mcptest.io/schemas/report/v2.schema.json' as const;
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

const StructuredJsonSchema = JsonValueSchema.refine((value) => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
), 'Expected a JSON object.');

const ReleaseDecisionSchema = z.object({
  status: z.enum(['ready', 'blocked', 'review', 'authorization-required', 'unknown']),
  answer: z.string().min(1),
  summary: z.string().min(1),
  priorities: z.array(z.object({
    id: z.string().min(1),
    severity: z.enum(['critical', 'high', 'medium', 'unknown']),
    title: z.string().min(1),
    detail: z.string(),
    remediation: z.string().min(1),
    source: z.enum(['Host compatibility', 'Tool surface', 'Evaluation']),
  }).strict()),
}).strict();

const CompatibilityEvidenceArtifactSchema = z.object({
  schemaVersion: z.literal('1.0'),
  source: z.enum([
    'target-server',
    'authorization-server',
    'browser',
    'proxy',
    'configuration',
    'host-profile',
  ]),
  description: z.string(),
  location: z.string().optional(),
}).strict();

const CompatibilityRemediationArtifactSchema = z.object({
  schemaVersion: z.literal('1.0'),
  kind: z.enum([
    'server-change',
    'authorization-server-change',
    'client-configuration',
    'observation-needed',
  ]),
  action: z.string().min(1),
  documentationUrl: z.string().optional(),
}).strict();

const CompatibilityFindingArtifactSchema = z.object({
  schemaVersion: z.literal('1.0'),
  ruleId: z.string().min(1),
  scope: z.enum(['target-server', 'authorization-server', 'client-environment']),
  outcome: z.enum(['pass', 'caveat', 'fail', 'unknown']),
  severity: z.enum(['info', 'warning', 'error']),
  summary: z.string(),
  detail: z.string(),
  evidence: z.array(CompatibilityEvidenceArtifactSchema),
  remediation: CompatibilityRemediationArtifactSchema.optional(),
}).strict();

const CompatibilityArtifactSchema = z.object({
  schemaVersion: z.string().min(1),
  assessments: z.record(z.string(), z.object({
    schemaVersion: z.string().min(1),
    profileId: z.string().min(1),
    profileVersion: z.string().min(1),
    status: z.enum(['compatible', 'compatible-with-caveats', 'incompatible', 'unknown']),
    findings: z.array(CompatibilityFindingArtifactSchema),
  }).passthrough()),
}).passthrough();

const ToolSurfaceEvidenceArtifactSchema = z.object({
  tool: z.string(),
  path: z.string(),
  detail: z.string(),
}).strict();

const ToolSurfaceFindingArtifactSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    'availability',
    'context-cost',
    'ambiguity',
    'description-quality',
    'schema-quality',
    'capability-risk',
    'prompt-like-description',
  ]),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  kind: z.enum(['measurement', 'quality-signal', 'capability-signal', 'review-signal']),
  title: z.string(),
  summary: z.string(),
  evidence: z.array(ToolSurfaceEvidenceArtifactSchema),
  omittedEvidenceCount: z.number().int().nonnegative(),
  remediation: z.string(),
}).strict();

const ToolSurfaceArtifactSchema = z.object({
  version: z.string().min(1),
  metrics: z.object({
    toolCount: z.number().nonnegative(),
    resourceCount: z.number().nonnegative(),
    promptCount: z.number().nonnegative(),
    estimatedContextTokens: z.number().nonnegative(),
  }).passthrough(),
  fingerprint: z.object({
    algorithm: z.string().min(1),
    value: z.string().min(1),
  }).passthrough(),
  toolDefinitions: z.object({
    status: z.enum(['complete', 'partial', 'unavailable']),
    tools: z.array(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      inputSchema: JsonValueSchema,
    }).strict()),
  }).strict().optional(),
  findings: z.object({
    critical: z.array(ToolSurfaceFindingArtifactSchema),
    high: z.array(ToolSurfaceFindingArtifactSchema),
    medium: z.array(ToolSurfaceFindingArtifactSchema),
    low: z.array(ToolSurfaceFindingArtifactSchema),
    info: z.array(ToolSurfaceFindingArtifactSchema),
  }).strict(),
  findingCount: z.number().nonnegative(),
  interpretation: z.string(),
}).passthrough();

const OAuthTraceArtifactSchema = z.object({
  version: z.number().int().positive(),
  traceId: z.string().min(1),
  targetFingerprint: z.string().min(1),
  targetUrl: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }),
  events: z.array(z.object({
    sequence: z.number().int().positive(),
    type: z.enum([
      'target_challenge',
      'protected_resource_metadata',
      'authorization_server_metadata',
      'cimd',
      'dynamic_client_registration',
      'pre_registered_client',
      'pkce',
      'authorization_redirect',
      'callback',
      'token_exchange',
      'refresh',
      'mcp_retry',
      'terminal_outcome',
    ]),
    outcome: z.enum([
      'started',
      'challenged',
      'succeeded',
      'failed',
      'cancelled',
      'required',
      'redirected',
      'skipped',
    ]),
    timestamp: z.string().datetime({ offset: true }),
    provenance: z.enum([
      'direct_target',
      'authenticated_proxy',
      'authorization_server',
      'browser_callback',
      'oauth_client',
    ]),
    route: z.enum(['direct', 'proxy', 'browser', 'client']),
    explanation: z.string(),
    request: z.object({
      method: z.string(),
      url: z.string(),
    }).strict().optional(),
    response: z.object({
      status: z.number().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      metadata: z.record(z.string(), JsonValueSchema).optional(),
    }).strict().optional(),
    timing: z.object({
      startedAt: z.string().datetime({ offset: true }),
      durationMs: z.number().nonnegative().optional(),
    }).strict().optional(),
  }).strict()),
}).passthrough();

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
      state: z.enum(['authorization-required', 'proxy-authentication-required']),
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
  releaseDecision: ReleaseDecisionSchema.optional(),
  compatibility: CompatibilityArtifactSchema.optional(),
  toolSurfaceAnalysis: ToolSurfaceArtifactSchema.optional(),
  oauthTrace: OAuthTraceArtifactSchema.optional(),
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
  releaseDecision?: ReleaseDecision;
  compatibilityMatrix?: CompatibilityMatrixV1;
  toolSurfaceAnalysis?: ToolSurfaceAnalysisV1;
  oauthTrace?: OAuthTraceV1;
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
  'estimatedcontexttokens',
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
      return true;
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

const isToolInputSchemaPropertyDeclaration = (
  key: string,
  path: readonly string[]
): boolean => {
  const propertyIndex = path.length - 2;
  return propertyIndex >= 0
    && path[propertyIndex] === 'properties'
    && path[path.length - 1] === key
    && path.includes('toolDefinitions')
    && path.includes('inputSchema');
};

const sameReportValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameReportValue(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((childKey) => (
      Object.prototype.hasOwnProperty.call(rightRecord, childKey)
      && sameReportValue(leftRecord[childKey], rightRecord[childKey])
    ));
};

const stableReportValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableReportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([childKey, childValue]) => [childKey, stableReportValue(childValue)]));
  }
  return value;
};

const redactedContractFingerprint = (value: unknown): { value: string; canonicalBytes: number } => {
  const canonical = JSON.stringify(stableReportValue(value));
  const bytes = new TextEncoder().encode(canonical);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return {
    value: hash.toString(16).padStart(16, '0'),
    canonicalBytes: bytes.length,
  };
};

const localSchemaReferencePath = (reference: string): string[] | undefined => {
  if (reference === '#') return [];
  if (!reference.startsWith('#/')) return undefined;
  try {
    return decodeURIComponent(reference.slice(2))
      .split('/')
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  } catch {
    return undefined;
  }
};

const localSchemaAnchorName = (reference: string): string | undefined => {
  if (!reference.startsWith('#') || reference === '#' || reference.startsWith('#/')) {
    return undefined;
  }
  try {
    return decodeURIComponent(reference.slice(1));
  } catch {
    return undefined;
  }
};

const localSchemaAnchorPaths = (
  root: unknown,
  anchorName: string,
  path: readonly string[] = [],
  seen: Set<unknown> = new Set()
): string[][] => {
  if (!root || typeof root !== 'object' || seen.has(root)) return [];
  seen.add(root);
  if (Array.isArray(root)) {
    return root.flatMap((item, index) => localSchemaAnchorPaths(
      item,
      anchorName,
      [...path, String(index)],
      seen
    ));
  }
  const record = root as Record<string, unknown>;
  const paths = record.$anchor === anchorName || record.$dynamicAnchor === anchorName
    ? [[...path]]
    : [];
  return Object.entries(record).reduce<string[][]>((matches, [childKey, childValue]) => [
    ...matches,
    ...localSchemaAnchorPaths(childValue, anchorName, [...path, childKey], seen),
  ], paths);
};

const localSchemaReferencePaths = (root: unknown, reference: string): string[][] => {
  const pointerPath = localSchemaReferencePath(reference);
  if (pointerPath) return [pointerPath];
  const anchorName = localSchemaAnchorName(reference);
  return anchorName === undefined ? [] : localSchemaAnchorPaths(root, anchorName);
};

const schemaValueAtPath = (
  root: unknown,
  path: readonly string[]
): { found: boolean; value?: unknown } => {
  let current = root;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment) || Number(segment) >= current.length) return { found: false };
      current = current[Number(segment)];
      continue;
    }
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
};

const collectLocalSchemaReferences = (
  value: unknown,
  references: Set<string>,
  seen: Set<unknown>
): void => {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectLocalSchemaReferences(item, references, seen));
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    if (
      (childKey === '$ref' || childKey === '$dynamicRef')
      && typeof childValue === 'string'
      && childValue.startsWith('#')
    ) {
      references.add(childValue);
    }
    collectLocalSchemaReferences(childValue, references, seen);
  }
};

const redactSchemaValuesAtPaths = (
  value: unknown,
  redactedPaths: ReadonlySet<string>,
  path: readonly string[] = []
): unknown => {
  if (redactedPaths.has(JSON.stringify(path))) return REDACTED_VALUE;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactSchemaValuesAtPaths(
      item,
      redactedPaths,
      [...path, String(index)]
    ));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactSchemaValuesAtPaths(childValue, redactedPaths, [...path, childKey]),
    ]));
  }
  return value;
};

const redactSensitiveSchemaReferences = (schema: unknown): unknown => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const pendingReferences = new Set<string>();
  const seenSchemaNodes = new Set<unknown>();

  const visitProperties = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seenSchemaNodes.has(value)) return;
    seenSchemaNodes.add(value);
    if (Array.isArray(value)) {
      value.forEach(visitProperties);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
      for (const [propertyName, declaration] of Object.entries(record.properties)) {
        if (isSensitiveQueryKey(propertyName)) {
          collectLocalSchemaReferences(declaration, pendingReferences, new Set());
        }
      }
    }
    Object.values(record).forEach(visitProperties);
  };
  visitProperties(schema);

  const redactedPaths = new Set<string>();
  for (const reference of pendingReferences) {
    for (const referencePath of localSchemaReferencePaths(schema, reference)) {
      const pathKey = JSON.stringify(referencePath);
      if (redactedPaths.has(pathKey)) continue;
      const target = schemaValueAtPath(schema, referencePath);
      if (!target.found) continue;
      redactedPaths.add(pathKey);
      collectLocalSchemaReferences(target.value, pendingReferences, new Set());
    }
  }

  return redactedPaths.size > 0
    ? redactSchemaValuesAtPaths(schema, redactedPaths)
    : schema;
};

const redactReportValueAtPath = (
  value: unknown,
  key: string | undefined,
  path: readonly string[],
  schemaReferencesRedacted = false
): unknown => {
  if (key
      && isSensitiveQueryKey(key)
      && isToolInputSchemaPropertyDeclaration(key, path)) {
    return REDACTED_VALUE;
  }
  if (key
    && isSensitiveQueryKey(key)
    && !isAuthorizationPrerequisiteSchemaField(path)
    && !isToolInputSchemaPropertyDeclaration(key, path)
    && !isJsonRpcErrorCode(value, key, path)) {
    return REDACTED_VALUE;
  }
  if (
    key === 'inputSchema'
    && path.includes('toolDefinitions')
    && !schemaReferencesRedacted
  ) {
    const redactedReferences = redactSensitiveSchemaReferences(value);
    if (redactedReferences !== value) {
      return redactReportValueAtPath(redactedReferences, key, path, true);
    }
  }
  if (value === undefined) return undefined;
  if (typeof value === 'string') return redactReportString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactReportValueAtPath(item, undefined, [
      ...path,
      String(index),
    ], schemaReferencesRedacted));
  }
  if (value && typeof value === 'object') {
    const redactedKeys = new Set<string>();
    // Sort the source keys so collision suffixes do not depend on insertion order.
    const redactedObject = Object.fromEntries(Object.entries(value)
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
          redactReportValueAtPath(
            childValue,
            childKey,
            [...path, childKey],
            schemaReferencesRedacted
          ),
        ];
      }));
    if (
      key === 'toolDefinitions'
      && path.includes('toolSurfaceAnalysis')
      && !sameReportValue(value, redactedObject)
    ) {
      return { ...redactedObject, status: 'partial' };
    }
    const redactedDefinitions = redactedObject.toolDefinitions;
    const redactedFingerprint = redactedObject.fingerprint;
    if (
      key === 'toolSurfaceAnalysis'
      && redactedDefinitions
      && typeof redactedDefinitions === 'object'
      && !Array.isArray(redactedDefinitions)
      && (redactedDefinitions as Record<string, unknown>).status === 'partial'
      && redactedFingerprint
      && typeof redactedFingerprint === 'object'
      && !Array.isArray(redactedFingerprint)
    ) {
      return {
        ...redactedObject,
        fingerprint: {
          ...(redactedFingerprint as Record<string, unknown>),
          ...redactedContractFingerprint(redactedDefinitions),
        },
      };
    }
    return redactedObject;
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

const outcomeSummary = (
  outcome: PublicReportOutcome,
  proxyAuthenticationRequired = false
): string => {
  switch (outcome) {
    case 'authorization-required':
      return proxyAuthenticationRequired
        ? 'A valid mcptest login is a prerequisite for proxy access; this run was not scored.'
        : 'Authorization is a prerequisite; this run was not scored.';
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
  const proxyAuthenticationRequired = report.authenticationRequirement?.kind === 'proxy';
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
  const negotiatedEndpoint = outcome === 'failed'
    ? undefined
    : metadataString(negotiationMetadata, 'endpoint');
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
  const toolSurfaceAnalysis = options.toolSurfaceAnalysis ?? report.toolSurfaceAnalysis;

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
      summary: outcomeSummary(outcome, proxyAuthenticationRequired),
      ...(outcome === 'authorization-required' ? {
        authorizationPrerequisite: {
          required: true,
          state: proxyAuthenticationRequired
            ? 'proxy-authentication-required' as const
            : 'authorization-required' as const,
          message: proxyAuthenticationRequired
            ? 'Sign in to mcptest again, then rerun the evaluation. Target OAuth has not started.'
            : 'Authorize access to the MCP server, then run the evaluation again.',
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
    ...(options.releaseDecision ? { releaseDecision: options.releaseDecision } : {}),
    ...(options.compatibilityMatrix ? {
      compatibility: options.compatibilityMatrix as unknown as NonNullable<PublicReport['compatibility']>,
    } : {}),
    ...(toolSurfaceAnalysis ? {
      toolSurfaceAnalysis: toolSurfaceAnalysis as unknown as NonNullable<PublicReport['toolSurfaceAnalysis']>,
    } : {}),
    ...(options.oauthTrace ? {
      oauthTrace: options.oauthTrace as unknown as NonNullable<PublicReport['oauthTrace']>,
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
    const proxyAuthenticationRequired = value.outcome.authorizationPrerequisite.state
      === 'proxy-authentication-required';
    lines.push(
      proxyAuthenticationRequired
        ? '> A valid mcptest login is a proxy prerequisite, not a target authorization failure. This run was not scored.'
        : '> Authorization is a prerequisite, not a failed 0% grade. This run was not scored.',
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

  if (value.releaseDecision) {
    lines.push(
      '## Release readiness',
      '',
      `**${markdownInline(value.releaseDecision.status)}** — ${markdownInline(value.releaseDecision.answer)}`,
      '',
      markdownInline(value.releaseDecision.summary),
      ''
    );
    for (const priority of value.releaseDecision.priorities) {
      lines.push(
        `- [${priority.severity}] ${markdownInline(priority.title)} (${markdownInline(priority.source)})`,
        `  - ${markdownInline(priority.detail)}`,
        `  - Remediation: ${markdownInline(priority.remediation)}`
      );
    }
    if (value.releaseDecision.priorities.length > 0) lines.push('');
  }

  if (value.compatibility) {
    const compatibility = value.compatibility as unknown as CompatibilityMatrixV1;
    lines.push('## Host compatibility', '');
    for (const assessment of Object.values(compatibility.assessments || {})) {
      lines.push(`- ${markdownInline(assessment.profileId)}: ${markdownInline(assessment.status)}`);
      for (const finding of assessment.findings.filter((item) => item.outcome !== 'pass')) {
        lines.push(`  - ${markdownInline(finding.summary)}: ${markdownInline(finding.detail)}`);
        if (finding.remediation) {
          lines.push(`    - Remediation: ${markdownInline(finding.remediation.action)}`);
        }
      }
    }
    lines.push('');
  }

  if (value.toolSurfaceAnalysis) {
    const analysis = value.toolSurfaceAnalysis as unknown as ToolSurfaceAnalysisV1;
    lines.push(
      '## Tool surface analysis',
      '',
      `- Tools: ${analysis.metrics.toolCount}`,
      `- Resources: ${analysis.metrics.resourceCount}`,
      `- Prompts: ${analysis.metrics.promptCount}`,
      `- Estimated context tokens: ${analysis.metrics.estimatedContextTokens}`,
      `- Fingerprint: ${markdownInline(analysis.fingerprint.algorithm)}:${markdownInline(analysis.fingerprint.value)}`,
      ''
    );
    for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
      for (const finding of analysis.findings[severity]) {
        lines.push(
          `- [${severity}] ${markdownInline(finding.title)}`,
          `  - ${markdownInline(finding.summary)}`,
          `  - Remediation: ${markdownInline(finding.remediation)}`
        );
      }
    }
    if (analysis.findingCount > 0) lines.push('');
  }

  if (value.oauthTrace) {
    const trace = value.oauthTrace as unknown as OAuthTraceV1;
    lines.push('## OAuth trace (redacted)', '');
    for (const event of trace.events) {
      lines.push(
        `- ${event.sequence}. ${markdownInline(event.type)} — ${markdownInline(event.outcome)} (${markdownInline(event.provenance)})`,
        `  - ${markdownInline(event.explanation)}`
      );
    }
    if (trace.events.length === 0) lines.push('- No trace events were recorded.');
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
