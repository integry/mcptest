import type { EvaluationReport } from '../utils/evaluation';
import { evaluateServer } from '../utils/evaluation';
import {
  createPublicReport,
  PublicReportSchema,
  REDACTED_VALUE,
  redactReportString,
  serializePublicReportJson,
  serializePublicReportMarkdown,
  type PublicReport,
} from '../utils/reportArtifact';
import {
  createCompatibilityMatrix,
  createReleaseDecision,
  type ReleaseDecision,
  type ReleaseReadinessStatus,
} from '../utils/releaseReadiness';

export const RELEASE_GATE_EXIT_CODES = {
  pass: 0,
  thresholdFailure: 1,
  authorizationRequired: 2,
  invalidConfiguration: 3,
  infrastructureFailure: 4,
} as const;

export type ReleaseGateExitCode = typeof RELEASE_GATE_EXIT_CODES[keyof typeof RELEASE_GATE_EXIT_CODES];
export type ReleaseGateSeverityThreshold = 'critical' | 'high' | 'medium' | 'unknown' | 'none';

export interface ReleaseGatePolicy {
  failOnResults: ReadonlySet<ReleaseReadinessStatus>;
  failOnSeverity: ReleaseGateSeverityThreshold;
}

export const DEFAULT_RELEASE_GATE_POLICY: ReleaseGatePolicy = {
  failOnResults: new Set(['blocked', 'unknown']),
  failOnSeverity: 'high',
};

export interface ReleaseGateProgress {
  index: number;
  total: number;
  endpoint: string;
  message: string;
}

export interface ReleaseGateTargetResult {
  index: number;
  endpoint: string;
  filenameBase: string;
  status: 'evaluated' | 'authorization-required' | 'infrastructure-failure';
  thresholdReasons: string[];
  releaseDecision?: ReleaseDecision;
  report?: PublicReport;
  json?: string;
  markdown?: string;
  error?: string;
}

export interface ReleaseGateRunResult {
  exitCode: ReleaseGateExitCode;
  targets: ReleaseGateTargetResult[];
}

export interface RunReleaseGateOptions {
  endpoints: readonly string[];
  headers?: HeadersInit;
  policy?: ReleaseGatePolicy;
  generatedAt?: string | Date;
  onProgress?: (progress: ReleaseGateProgress) => void;
}

export interface ReleaseGateDependencies {
  evaluate?: typeof evaluateServer;
}

const severityRank: Record<Exclude<ReleaseGateSeverityThreshold, 'none'>, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  unknown: 1,
};

const credentialValues = (headers: HeadersInit | undefined): string[] => {
  const values = new Set<string>();
  for (const [name, value] of new Headers(headers).entries()) {
    if (!['authorization', 'x-api-key', 'api-key'].includes(name.toLowerCase())) continue;
    if (value) values.add(value);
    const bearer = value.match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer) values.add(bearer);
  }
  return [...values].sort((left, right) => right.length - left.length);
};

const redactKnownCredentialString = (value: string, credentials: readonly string[]): string => (
  redactReportString(credentials.reduce(
    (redacted, credential) => redacted.split(credential).join(REDACTED_VALUE),
    value
  ))
);

interface SchemaConstant {
  path: readonly string[];
  values: ReadonlySet<string>;
}

const schemaConstant = (path: string, values: readonly string[]): SchemaConstant => ({
  path: path.split('.'),
  values: new Set(values),
});

// These values are generated locally and must remain unchanged for PublicReportSchema validity.
// Every open-ended or server-influenced string, including metadata, identifiers, protocol data,
// and tool names, is intentionally excluded.
const LOCAL_SCHEMA_CONSTANTS: readonly SchemaConstant[] = [
  schemaConstant('$schema', ['https://mcptest.io/schemas/report/v2.schema.json']),
  schemaConstant('artifactType', ['mcptest.report']),
  schemaConstant('schemaVersion', ['2.0.0']),
  schemaConstant('generator.name', ['mcptest']),
  schemaConstant('provenance.route', ['direct', 'authenticated-proxy', 'unknown']),
  schemaConstant('provenance.attempts.*.route', ['direct', 'authenticated-proxy']),
  schemaConstant('provenance.attempts.*.result', ['failed']),
  schemaConstant('outcome.status', ['scored', 'authorization-required', 'partial', 'failed']),
  schemaConstant('outcome.authorizationPrerequisite.state', ['authorization-required']),
  schemaConstant('releaseDecision.status', [
    'ready', 'blocked', 'review', 'authorization-required', 'unknown',
  ]),
  schemaConstant('releaseDecision.priorities.*.severity', [
    'critical', 'high', 'medium', 'unknown',
  ]),
  schemaConstant('releaseDecision.priorities.*.source', [
    'Host compatibility', 'Tool surface', 'Evaluation',
  ]),
  schemaConstant('compatibility.assessments.*.status', [
    'compatible', 'compatible-with-caveats', 'incompatible', 'unknown',
  ]),
  schemaConstant('compatibility.assessments.*.findings.*.schemaVersion', ['1.0']),
  schemaConstant('compatibility.assessments.*.findings.*.scope', [
    'target-server', 'authorization-server', 'client-environment',
  ]),
  schemaConstant('compatibility.assessments.*.findings.*.outcome', [
    'pass', 'caveat', 'fail', 'unknown',
  ]),
  schemaConstant('compatibility.assessments.*.findings.*.severity', [
    'info', 'warning', 'error',
  ]),
  schemaConstant('compatibility.assessments.*.findings.*.evidence.*.schemaVersion', ['1.0']),
  schemaConstant('compatibility.assessments.*.findings.*.evidence.*.source', [
    'target-server', 'authorization-server', 'browser', 'proxy', 'configuration', 'host-profile',
  ]),
  schemaConstant('compatibility.assessments.*.findings.*.remediation.schemaVersion', ['1.0']),
  schemaConstant('compatibility.assessments.*.findings.*.remediation.kind', [
    'server-change', 'authorization-server-change', 'client-configuration', 'observation-needed',
  ]),
  schemaConstant('toolSurfaceAnalysis.findings.*.*.category', [
    'availability', 'context-cost', 'ambiguity', 'description-quality', 'schema-quality',
    'capability-risk', 'prompt-like-description',
  ]),
  schemaConstant('toolSurfaceAnalysis.findings.*.*.severity', [
    'critical', 'high', 'medium', 'low', 'info',
  ]),
  schemaConstant('toolSurfaceAnalysis.findings.*.*.kind', [
    'measurement', 'quality-signal', 'capability-signal', 'review-signal',
  ]),
  schemaConstant('oauthTrace.events.*.type', [
    'target_challenge', 'protected_resource_metadata', 'authorization_server_metadata', 'cimd',
    'dynamic_client_registration', 'pre_registered_client', 'pkce', 'authorization_redirect',
    'callback', 'token_exchange', 'refresh', 'mcp_retry', 'terminal_outcome',
  ]),
  schemaConstant('oauthTrace.events.*.outcome', [
    'started', 'challenged', 'succeeded', 'failed', 'cancelled', 'required', 'redirected', 'skipped',
  ]),
  schemaConstant('oauthTrace.events.*.provenance', [
    'direct_target', 'authenticated_proxy', 'authorization_server', 'browser_callback', 'oauth_client',
  ]),
  schemaConstant('oauthTrace.events.*.route', ['direct', 'proxy', 'browser', 'client']),
  schemaConstant('sections.*.status', [
    'evaluated', 'partial', 'failed', 'skipped', 'prerequisite',
  ]),
];

const isLocalSchemaConstant = (path: readonly string[], value: string): boolean => (
  LOCAL_SCHEMA_CONSTANTS.some((constant) => (
    constant.path.length === path.length
    && constant.path.every((part, index) => part === '*' || part === path[index])
    && constant.values.has(value)
  ))
);

const redactPublicArtifactCredentials = (
  value: unknown,
  credentials: readonly string[],
  path: readonly string[] = []
): unknown => {
  if (typeof value === 'string') {
    return isLocalSchemaConstant(path, value)
      ? value
      : redactKnownCredentialString(value, credentials);
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactPublicArtifactCredentials(
      item,
      credentials,
      [...path, String(index)]
    ));
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    redactPublicArtifactCredentials(child, credentials, [...path, key]),
  ]));
};

const safeFilenameHost = (endpoint: string): string => {
  try {
    return new URL(endpoint).hostname.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '')
      || 'mcp-server';
  } catch {
    return 'mcp-server';
  }
};

export const releaseGateFilenameBase = (
  endpoint: string,
  index: number,
  total: number
): string => {
  const prefix = total > 1 ? `${String(index + 1).padStart(3, '0')}-` : '';
  return `${prefix}mcptest-${safeFilenameHost(endpoint)}-report`;
};

export const getReleaseGateThresholdReasons = (
  decision: ReleaseDecision,
  policy: ReleaseGatePolicy
): string[] => {
  const reasons: string[] = [];
  if (policy.failOnResults.has(decision.status)) {
    reasons.push(`overall result is ${decision.status}`);
  }

  if (policy.failOnSeverity !== 'none') {
    const threshold = severityRank[policy.failOnSeverity];
    for (const priority of decision.priorities) {
      if (severityRank[priority.severity] >= threshold) {
        reasons.push(redactReportString(`${priority.severity} finding: ${priority.title}`));
      }
    }
  }

  return [...new Set(reasons)];
};

const createReleaseArtifact = (
  evaluation: EvaluationReport,
  generatedAt: string | Date | undefined,
  credentials: readonly string[]
): { decision: ReleaseDecision; report: PublicReport } => {
  const compatibilityMatrix = createCompatibilityMatrix(evaluation);
  const decision = createReleaseDecision(
    evaluation,
    compatibilityMatrix,
    evaluation.toolSurfaceAnalysis
  );
  const artifact = createPublicReport(evaluation, {
    generatedAt,
    compatibilityMatrix,
    releaseDecision: decision,
    toolSurfaceAnalysis: evaluation.toolSurfaceAnalysis,
  });
  const report = PublicReportSchema.parse(redactPublicArtifactCredentials(artifact, credentials));
  return { decision, report };
};

/** Runs the web evaluator in headless mode, then uses the shared release and report pipeline. */
export const runReleaseGate = async (
  options: RunReleaseGateOptions,
  dependencies: ReleaseGateDependencies = {}
): Promise<ReleaseGateRunResult> => {
  const evaluator = dependencies.evaluate ?? evaluateServer;
  const policy = options.policy ?? DEFAULT_RELEASE_GATE_POLICY;
  const credentials = credentialValues(options.headers);
  const targets: ReleaseGateTargetResult[] = [];

  for (const [index, endpoint] of options.endpoints.entries()) {
    const filenameBase = releaseGateFilenameBase(endpoint, index, options.endpoints.length);
    const progress = (message: string) => options.onProgress?.({
      index,
      total: options.endpoints.length,
      endpoint: redactKnownCredentialString(endpoint, credentials),
      message: redactKnownCredentialString(message, credentials),
    });

    try {
      const evaluation = await evaluator(
        endpoint,
        '',
        progress,
        null,
        options.headers,
        undefined,
        { runtime: 'headless' }
      );
      const { decision, report } = createReleaseArtifact(
        evaluation,
        options.generatedAt,
        credentials
      );
      const authorizationRequired = decision.status === 'authorization-required';
      targets.push({
        index,
        endpoint: report.target.testedEndpoint,
        filenameBase,
        status: authorizationRequired ? 'authorization-required' : 'evaluated',
        thresholdReasons: authorizationRequired
          ? []
          : getReleaseGateThresholdReasons(decision, policy)
            .map((reason) => redactKnownCredentialString(reason, credentials)),
        releaseDecision: report.releaseDecision || decision,
        report,
        json: serializePublicReportJson(report),
        markdown: serializePublicReportMarkdown(report),
      });
    } catch (error) {
      const message = redactKnownCredentialString(
        error instanceof Error ? error.message : String(error),
        credentials
      );
      targets.push({
        index,
        endpoint: redactKnownCredentialString(endpoint, credentials),
        filenameBase,
        status: 'infrastructure-failure',
        thresholdReasons: [],
        error: message,
      });
    }
  }

  const exitCode = targets.some(({ status }) => status === 'infrastructure-failure')
    ? RELEASE_GATE_EXIT_CODES.infrastructureFailure
    : targets.some(({ status }) => status === 'authorization-required')
      ? RELEASE_GATE_EXIT_CODES.authorizationRequired
      : targets.some(({ thresholdReasons }) => thresholdReasons.length > 0)
        ? RELEASE_GATE_EXIT_CODES.thresholdFailure
        : RELEASE_GATE_EXIT_CODES.pass;

  return { exitCode, targets };
};
