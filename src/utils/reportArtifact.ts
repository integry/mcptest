import { z } from 'zod';
import packageJson from '../../package.json';
import {
  getEvaluationMaxScore,
  isAuthenticationRequired,
  type DetailItem,
  type EvaluationReport,
  type EvaluationSection,
} from './evaluation';
import { VERSION_INFO } from './versionInfo';

export const REPORT_SCHEMA_VERSION = '1.0.0' as const;
export const REPORT_SCHEMA_URL = 'https://mcptest.io/schemas/report/v1.schema.json' as const;
export const REDACTED_VALUE = '[REDACTED]' as const;

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
  if (report.score && report.score.earned > report.score.maximum) {
    context.addIssue({
      code: 'custom',
      path: ['score', 'earned'],
      message: 'The earned score cannot exceed the maximum score.',
    });
  }
  for (const [index, section] of report.sections.entries()) {
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

const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:token|secret|password|passwd|credential|authorization|auth|code|cookie|session|signature|sig|api[_-]?key)(?:$|[_-])/i;

const EXACT_SENSITIVE_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'xmcpauthorization',
  'cookie',
  'setcookie',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'credential',
  'credentials',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'xapikey',
  'authorizationcode',
  'oauthcode',
  'code',
  'token',
  'sessionid',
  'signature',
  'sig',
  'privatekey',
]);

const isSensitiveKey = (key: string): boolean => {
  const canonical = key.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return EXACT_SENSITIVE_KEYS.has(canonical)
    || /(?:token|secret|password|passwd|credential|authorizationcode|oauthcode|apikey|privatekey)$/.test(canonical);
};

const redactUrl = (value: string, depth = 0): string => {
  if (depth > 3) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (!/^https?:$/.test(url.protocol)) return value;
  if (url.username) url.username = REDACTED_VALUE;
  if (url.password) url.password = REDACTED_VALUE;
  for (const [key, queryValue] of [...url.searchParams.entries()]) {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      url.searchParams.set(key, REDACTED_VALUE);
    } else if (/^https?:\/\//i.test(queryValue)) {
      url.searchParams.set(key, redactUrl(queryValue, depth + 1));
    }
  }
  if (url.hash) url.hash = `#${REDACTED_VALUE}`;
  return url.toString();
};

const redactUrlsInText = (value: string): string => value.replace(
  /https?:\/\/[^\s<>"']+/gi,
  (candidate) => {
    const trailing = candidate.match(/[),.;!?]+$/)?.[0] || '';
    const url = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${redactUrl(url)}${trailing}`;
  }
);

export const redactReportString = (value: string): string => {
  const redactedUrls = redactUrlsInText(value);
  return redactedUrls
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED_VALUE}`)
    .replace(/\b(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|authorization[_-]?code|password|cookie)\b\s*[:=]\s*([^\s,;&]+)/gi, `$1=${REDACTED_VALUE}`);
};

/** Recursively redacts sensitive keys and values while retaining JSON-safe evidence. */
export const redactReportValue = (value: unknown, key?: string): unknown => {
  if (key && isSensitiveKey(key)) return REDACTED_VALUE;
  if (typeof value === 'string') return redactReportString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => redactReportValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactReportValue(childValue, childKey),
    ]));
  }
  return String(value);
};

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

const resolveOutcome = (report: EvaluationReport): PublicReportOutcome => {
  if (isAuthenticationRequired(report)) return 'authorization-required';
  if (report.outcome === 'failed' || report.outcome === 'partial') return report.outcome;

  const sections = Object.values(report.sections);
  const explicitlyIncomplete = sections.some((section) => (
    section.status === 'partial' || section.status === 'failed' || section.status === 'skipped'
  ));
  const negotiationFailed = report.sections.protocol?.details.some((detail) => (
    /negotiation failed|no MCP connection/i.test(`${detail.text} ${detail.context || ''}`)
  ));
  if (negotiationFailed) return 'failed';
  if (explicitlyIncomplete) return 'partial';
  return 'scored';
};

const isLegacySkippedSection = (section: EvaluationSection): boolean => (
  section.details.length > 0
  && section.details.every((detail) => /^⚠/.test(detail.text))
  && section.details.some((detail) => /skipped|not scored|no standard MCP transport|could not be isolated|negotiation failed/i.test(
    `${detail.text} ${detail.context || ''}`
  ))
);

const sectionStatus = (
  id: string,
  section: EvaluationSection,
  outcome: PublicReportOutcome
): PublicReport['sections'][number]['status'] => {
  if (id === 'auth') return 'prerequisite';
  if (section.status) return section.status;
  if (isLegacySkippedSection(section)) return outcome === 'failed' && id === 'protocol'
    ? 'failed'
    : 'skipped';
  return 'evaluated';
};

const redactEvidence = (detail: DetailItem): PublicReport['sections'][number]['evidence'][number] => ({
  message: redactReportString(detail.text),
  ...(detail.context ? { context: redactReportString(detail.context) } : {}),
  ...(detail.metadata !== undefined ? { metadata: redactReportValue(detail.metadata) } : {}),
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
  const outcome = resolveOutcome(report);
  const metadata = metadataRecords(report);
  const routeValue = metadataString(metadata, 'route');
  const route = routeValue === 'direct'
    ? 'direct'
    : routeValue === 'proxy' || routeValue === 'authenticated proxy'
      ? 'authenticated-proxy'
      : 'unknown';
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
  const negotiationMs = report.sections.performance?.details
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
    ...(negotiationMs !== undefined || checks.length > 0 ? {
      timings: {
        ...(negotiationMs !== undefined ? { negotiationMs } : {}),
        checks,
      },
    } : {}),
    sections: Object.entries(report.sections).map(([id, section]) => {
      const status = sectionStatus(id, section, outcome);
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

  return PublicReportSchema.parse(artifact);
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
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
    `- Generator: ${value.generator.name}${value.generator.version ? ` ${value.generator.version}` : ''}${value.generator.commit ? ` (${value.generator.commit})` : ''}`,
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
