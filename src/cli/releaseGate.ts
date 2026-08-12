import { createHash } from 'node:crypto';
import type { EvaluationReport } from '../utils/evaluation';
import { evaluateServer } from '../utils/evaluation';
import {
  createPublicReport,
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

export const credentialedEndpointConfigurationError = (
  endpoints: readonly string[],
  headers: HeadersInit | undefined
): string | undefined => {
  if (credentialValues(headers).length === 0) return undefined;

  const parsedEndpoints = endpoints.map((endpoint) => new URL(endpoint));
  if (parsedEndpoints.some((endpoint) => endpoint.protocol !== 'https:')) {
    return 'Credentialed endpoints must use HTTPS.';
  }
  if (new Set(parsedEndpoints.map((endpoint) => endpoint.origin)).size > 1) {
    return 'Credentialed runs require all endpoints to share one origin.';
  }
  return undefined;
};

const redactKnownCredentialString = (value: string, credentials: readonly string[]): string => (
  redactReportString(credentials.reduce(
    (redacted, credential) => redacted.split(credential).join(REDACTED_VALUE),
    value
  ))
);

const pathMatches = (pattern: readonly string[], path: readonly string[]): boolean => (
  pattern.length === path.length
  && pattern.every((part, index) => part === '*' || part === path[index])
);

const LOCAL_METADATA_KEYS = new Set([
  'authenticationSource', 'authorizationChallenge', 'authorizationScheme',
  'authorizationSchemes', 'durationMs', 'endpoint', 'evaluationRuntime', 'method',
  'outcome', 'protocolEra', 'protocolVersion', 'provenance', 'responseHeaders',
  'result', 'route', 'routeFailures', 'transportType',
  'unauthenticatedTargetRequestSucceeded',
]);

const LOCAL_METADATA_VALUE_KEYS = new Set([
  'authenticationSource', 'authorizationScheme', 'authorizationSchemes',
  'evaluationRuntime', 'method', 'outcome', 'protocolEra', 'provenance', 'result',
  'route', 'transportType',
]);

const isLocalToolAnalysisString = (path: readonly string[]): boolean => (
  pathMatches(['version'], path)
  || pathMatches(['fingerprint', 'algorithm'], path)
  || pathMatches(['fingerprint', 'value'], path)
  || pathMatches(['findings', '*', '*', 'id'], path)
  || pathMatches(['findings', '*', '*', 'category'], path)
  || pathMatches(['findings', '*', '*', 'severity'], path)
  || pathMatches(['findings', '*', '*', 'kind'], path)
);

const redactStructuredCredentials = (
  value: unknown,
  credentials: readonly string[],
  options: {
    localKeys?: ReadonlySet<string>;
    localString?: (path: readonly string[]) => boolean;
    localStringKeys?: ReadonlySet<string>;
    preserveKeys?: boolean;
    trustedStrings?: ReadonlySet<string>;
  } = {},
  path: readonly string[] = [],
  sourceKey?: string
): unknown => {
  if (typeof value === 'string') {
    return options.trustedStrings?.has(value)
      || (sourceKey !== undefined && options.localStringKeys?.has(sourceKey))
      || options.localString?.(path)
      ? value
      : redactKnownCredentialString(value, credentials);
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactStructuredCredentials(
      item,
      credentials,
      options,
      [...path, String(index)],
      sourceKey
    ));
  }
  const usedKeys = new Set<string>();
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => {
      const redactedKey = options.preserveKeys || options.localKeys?.has(key)
        ? key
        : redactKnownCredentialString(key, credentials);
      let uniqueKey = redactedKey;
      for (let collision = 2; usedKeys.has(uniqueKey); collision += 1) {
        uniqueKey = `${redactedKey}#${collision}`;
      }
      usedKeys.add(uniqueKey);
      return [
        uniqueKey,
        redactStructuredCredentials(child, credentials, options, [...path, key], key),
      ];
    }));
};

const redactEvaluationCredentials = (
  evaluation: EvaluationReport,
  endpoint: string,
  credentials: readonly string[]
): EvaluationReport => {
  // serverUrl and matching negotiation endpoints are derived from the validated CLI target, not
  // from the credential. Preserve those configuration-owned strings while scrubbing target
  // evidence before it can influence compatibility or release-decision construction.
  const trustedEndpoint = new Set([endpoint, evaluation.serverUrl]);
  return {
    serverUrl: evaluation.serverUrl,
    ...(evaluation.authenticationUrl ? {
      authenticationUrl: redactStructuredCredentials(
        evaluation.authenticationUrl,
        credentials,
        { trustedStrings: trustedEndpoint }
      ) as string,
    } : {}),
    ...(evaluation.resourceMetadataUrl ? {
      resourceMetadataUrl: redactStructuredCredentials(
        evaluation.resourceMetadataUrl,
        credentials,
        { trustedStrings: trustedEndpoint }
      ) as string,
    } : {}),
    ...(evaluation.scope ? {
      scope: redactKnownCredentialString(evaluation.scope, credentials),
    } : {}),
    ...(evaluation.outcome ? { outcome: evaluation.outcome } : {}),
    finalScore: evaluation.finalScore,
    sections: Object.fromEntries(Object.entries(evaluation.sections).map(([id, section]) => [
      id,
      {
        ...section,
        name: redactKnownCredentialString(section.name, credentials),
        description: redactKnownCredentialString(section.description, credentials),
        details: section.details.map((detail) => ({
          ...detail,
          text: redactKnownCredentialString(detail.text, credentials),
          ...(detail.context ? {
            context: redactKnownCredentialString(detail.context, credentials),
          } : {}),
          ...(detail.metadata !== undefined ? {
            metadata: redactStructuredCredentials(detail.metadata, credentials, {
              localKeys: LOCAL_METADATA_KEYS,
              localStringKeys: LOCAL_METADATA_VALUE_KEYS,
              trustedStrings: trustedEndpoint,
            }),
          } : {}),
        })),
      },
    ])),
    ...(evaluation.toolSurfaceAnalysis ? {
      toolSurfaceAnalysis: redactStructuredCredentials(
        evaluation.toolSurfaceAnalysis,
        credentials,
        { preserveKeys: true, localString: isLocalToolAnalysisString }
      ) as EvaluationReport['toolSurfaceAnalysis'],
    } : {}),
  };
};

const safeFilenameHost = (endpoint: string): string => {
  try {
    const hostname = new URL(endpoint).hostname
      .replace(/[^a-z0-9.-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'mcp-server';
    const maxLength = 180;
    if (hostname.length <= maxLength) return hostname;

    const hash = createHash('sha256').update(hostname).digest('hex').slice(0, 12);
    const prefix = hostname.slice(0, maxLength - hash.length - 1).replace(/[-.]+$/g, '');
    return `${prefix}-${hash}`;
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
  endpoint: string,
  generatedAt: string | Date | undefined,
  credentials: readonly string[]
): { decision: ReleaseDecision; report: PublicReport } => {
  const publicEvaluation = redactEvaluationCredentials(evaluation, endpoint, credentials);
  const compatibilityMatrix = createCompatibilityMatrix(publicEvaluation);
  const decision = createReleaseDecision(
    publicEvaluation,
    compatibilityMatrix,
    publicEvaluation.toolSurfaceAnalysis
  );
  const report = createPublicReport(publicEvaluation, {
    generatedAt,
    compatibilityMatrix,
    releaseDecision: decision,
    toolSurfaceAnalysis: publicEvaluation.toolSurfaceAnalysis,
  });
  return { decision, report };
};

/** Runs the web evaluator in headless mode, then uses the shared release and report pipeline. */
export const runReleaseGate = async (
  options: RunReleaseGateOptions,
  dependencies: ReleaseGateDependencies = {}
): Promise<ReleaseGateRunResult> => {
  const configurationError = credentialedEndpointConfigurationError(
    options.endpoints,
    options.headers
  );
  if (configurationError) throw new TypeError(configurationError);

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
        endpoint,
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
