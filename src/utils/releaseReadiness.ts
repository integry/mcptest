import {
  COMPATIBILITY_SCHEMA_VERSION,
  assessCompatibilityMatrix,
  type AuthorizationScheme,
  type CapabilityAvailability,
  type CompatibilityEvidenceV1,
  type CompatibilityMatrixV1,
  type Known,
  type ObservedServerFactsV1,
  type ObservedValueV1,
  type OAuthRegistrationMode,
  type ProtocolEra,
  type RedirectPolicy,
} from '../compatibility';
import type { ToolSurfaceAnalysisV1, ToolSurfaceFindingV1 } from '../types/toolSurfaceAnalysis';
import type { EvaluationReport } from './evaluation';
import { resolveEvaluationOutcome } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';

const observed = <T>(
  value: Known<T>,
  description: string,
  source: CompatibilityEvidenceV1['source'] = 'target-server'
): ObservedValueV1<T> => ({
  value,
  evidence: [{ schemaVersion: COMPATIBILITY_SCHEMA_VERSION, source, description }],
});

const metadataRecords = (report: EvaluationReport): Record<string, unknown>[] => (
  Object.values(report.sections).flatMap((section) => section.details)
    .map((detail) => detail.metadata)
    .filter((value): value is Record<string, unknown> => (
      Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ))
);

const firstString = (records: Record<string, unknown>[], key: string): string | undefined => (
  records.map((record) => record[key]).find((value): value is string => typeof value === 'string')
);

const canonicalKey = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const containsSessionIdHeader = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return false;
  seen.add(value as object);
  if (Array.isArray(value)) return value.some((item) => containsSessionIdHeader(item, seen));

  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    canonicalKey(key) === 'mcpsessionid' || containsSessionIdHeader(child, seen)
  ));
};

const sessionBehaviorFact = (
  records: Record<string, unknown>[]
): ObservedValueV1<'stateful' | 'stateless'> => {
  const explicitBehavior = firstString(records, 'sessionBehavior');
  if (explicitBehavior === 'stateful' || explicitBehavior === 'stateless') {
    return observed(
      explicitBehavior,
      `The evaluation observed ${explicitBehavior} MCP session behavior.`
    );
  }
  if (records.some((record) => containsSessionIdHeader(record))) {
    return observed(
      'stateful',
      'The evaluation observed MCP-Session-Id issuance or use during the transport lifecycle.'
    );
  }
  return observed<'stateful' | 'stateless'>(
    'unknown',
    'Session behavior was not established from transport or session-lifecycle evidence.'
  );
};

const capabilityFact = (
  report: EvaluationReport,
  method: string
): ObservedValueV1<'present' | 'absent'> => {
  const detail = report.sections.capabilities?.details.find((item) => (
    (item.metadata as { method?: unknown } | undefined)?.method === method
  ));
  if (!detail || report.sections.capabilities?.status === 'skipped') {
    return observed<'present' | 'absent'>('unknown', `${method} was not evaluated.`);
  }
  if (detail.text.startsWith('✓')) {
    return observed('present', `${method} completed successfully, including a valid empty list.`);
  }
  if (/not supported|method.not.found/i.test(`${detail.text} ${detail.context || ''}`)) {
    return observed('absent', `${method} returned method-not-found.`);
  }
  return observed<'present' | 'absent'>('unknown', `${method} did not produce conclusive availability evidence.`);
};

const protocolEra = (version: string | undefined): Known<ProtocolEra> => {
  const year = version?.match(/\b(2024|2025|2026)\b/)?.[1];
  if (year === '2024' || year === '2025' || year === '2026') return year;
  return 'unknown';
};

const traceHas = (
  trace: OAuthTraceV1 | undefined,
  type: OAuthTraceV1['events'][number]['type'],
  outcomes: readonly string[] = ['succeeded']
): boolean => trace?.events.some((event) => (
  event.provenance !== 'authenticated_proxy'
  && event.type === type
  && outcomes.includes(event.outcome)
)) || false;

const targetChallengeEvents = (trace: OAuthTraceV1 | undefined) => (
  trace?.events.filter((event) => (
    event.type === 'target_challenge' && event.provenance === 'direct_target'
  )) || []
);

const challengeSchemes = (value: string): AuthorizationScheme[] => {
  const schemes: AuthorizationScheme[] = [];
  for (const challenge of value.split(/,(?=\s*[A-Za-z][A-Za-z0-9_-]*(?:\s|,|$))/)) {
    const scheme = challenge.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)/)?.[1]?.toLowerCase();
    if (!scheme) continue;
    if (scheme === 'apikey' || scheme === 'api-key' || scheme === 'x-api-key') {
      schemes.push('api-key');
    } else if (scheme === 'bearer') {
      if (/\bresource_metadata\s*=/i.test(challenge)) {
        schemes.push('oauth');
      } else {
        // A legacy OAuth resource may advertise only Bearer, without RFC 9728
        // resource metadata. Preserve both interpretations until one is proven.
        schemes.push('bearer', 'oauth');
      }
    } else if (scheme === 'oauth' || scheme === 'oauth2') {
      schemes.push('oauth');
    }
  }
  return schemes;
};

const configuredSchemes = (report: EvaluationReport): AuthorizationScheme[] => {
  const records = metadataRecords(report);
  const values = records.flatMap((record) => {
    const configured = record.authorizationSchemes ?? record.authorizationScheme;
    return Array.isArray(configured) ? configured : [configured];
  });
  const schemes = values.filter((value): value is AuthorizationScheme => (
    value === 'oauth' || value === 'bearer' || value === 'api-key'
  ));
  for (const record of records) {
    if (record.authenticationSource === 'proxy') continue;
    const responseHeaders = record.responseHeaders;
    if (!responseHeaders || typeof responseHeaders !== 'object' || Array.isArray(responseHeaders)) continue;
    const authenticate = Object.entries(responseHeaders).find(
      ([key, value]) => key.toLowerCase() === 'www-authenticate' && typeof value === 'string'
    )?.[1];
    if (typeof authenticate === 'string') schemes.push(...challengeSchemes(authenticate));
  }
  const authText = report.sections.auth?.details
    .map((detail) => `${detail.text} ${detail.context || ''}`)
    .join('\n') || '';
  if (/\bOAuth\b/i.test(authText)) schemes.push('oauth');
  if (/\bBearer\b/i.test(authText)) schemes.push('bearer');
  if (/\bAPI[-_ ]?key\b/i.test(authText)) schemes.push('api-key');
  return schemes;
};

const traceOAuthEvidence = (trace: OAuthTraceV1 | undefined): boolean => (
  trace?.events.some((event) => (
    event.provenance !== 'authenticated_proxy'
    && event.type !== 'target_challenge'
    && event.type !== 'terminal_outcome'
  )) || false
);

const inferAuthorizationSchemes = (
  report: EvaluationReport,
  trace: OAuthTraceV1 | undefined
): Known<readonly AuthorizationScheme[]> => {
  const records = metadataRecords(report);
  const unauthenticatedTargetRequestSucceeded = records.some(
    (record) => record.unauthenticatedTargetRequestSucceeded === true
  );
  const schemes = [
    ...configuredSchemes(report),
    ...targetChallengeEvents(unauthenticatedTargetRequestSucceeded ? undefined : trace).flatMap((event) => {
      const authenticate = Object.entries(event.response?.headers || {}).find(
        ([key]) => key.toLowerCase() === 'www-authenticate'
      )?.[1];
      return authenticate ? challengeSchemes(authenticate) : [];
    }),
  ];
  if (report.sections.security || traceOAuthEvidence(trace)) schemes.push('oauth');
  if (schemes.length > 0) return [...new Set(schemes)];
  if (unauthenticatedTargetRequestSucceeded) return [];
  return 'unknown';
};

const oauthBooleanObservation = (
  report: EvaluationReport,
  trace: OAuthTraceV1 | undefined,
  type: OAuthTraceV1['events'][number]['type'],
  successPattern: RegExp,
  failurePattern: RegExp
): Known<boolean> => {
  const securityDetails = report.sections.security?.details || [];
  if (securityDetails.some((detail) => successPattern.test(`${detail.text} ${detail.context || ''}`))
      || traceHas(trace, type, ['succeeded'])) return true;
  if (securityDetails.some((detail) => failurePattern.test(`${detail.text} ${detail.context || ''}`))) {
    return false;
  }
  const conclusiveTraceNegative = trace?.events.some((event) => (
    event.provenance !== 'authenticated_proxy'
    && event.type === type
    && (event.outcome === 'failed' || event.outcome === 'skipped')
    && (event.response?.status === 404 || event.response?.status === 410)
  ));
  if (conclusiveTraceNegative) return false;
  return 'unknown';
};

/** Converts the report's observed protocol evidence into the compatibility engine contract. */
export const createObservedServerFacts = (
  report: EvaluationReport,
  trace?: OAuthTraceV1
): ObservedServerFactsV1 => {
  const records = metadataRecords(report);
  const transportType = firstString(records, 'transportType');
  const protocolVersion = firstString(records, 'protocolVersion');
  const route = firstString(records, 'route');
  const evaluationRuntime = firstString(records, 'evaluationRuntime');
  const outcome = resolveEvaluationOutcome(report);
  const schemes = inferAuthorizationSchemes(report, trace);
  const oauthApplies = schemes !== 'unknown' && schemes.includes('oauth');
  const unauthenticatedTargetRequestSucceeded = records.some(
    (record) => record.unauthenticatedTargetRequestSucceeded === true
  );
  const hasCarriedTargetChallenge = records.some((record) => {
    const challenge = record.authorizationChallenge;
    return Boolean(challenge)
      && typeof challenge === 'object'
      && !Array.isArray(challenge)
      && (challenge as Record<string, unknown>).outcome === 'challenged'
      && (challenge as Record<string, unknown>).provenance === 'direct_target';
  });
  // Explicit current unauthenticated success takes precedence over a target
  // challenge from unrelated session history.
  const hasTargetChallenge = !unauthenticatedTargetRequestSucceeded && (
    hasCarriedTargetChallenge || targetChallengeEvents(trace).length > 0
  );
  const protectedResourceMetadata = oauthBooleanObservation(
    report,
    trace,
    'protected_resource_metadata',
    /protected-resource metadata available/i,
    /protected-resource metadata not available/i
  );
  const authorizationServerMetadata = oauthBooleanObservation(
    report,
    trace,
    'authorization_server_metadata',
    /authorization-server metadata available/i,
    /authorization-server metadata not available/i
  );
  const pkceS256 = oauthBooleanObservation(
    report,
    trace,
    'pkce',
    /PKCE support enabled/i,
    /PKCE S256 support not advertised/i
  );
  const registrationModes: OAuthRegistrationMode[] = [];
  if (traceHas(trace, 'cimd')) registrationModes.push('client-id-metadata-document');
  if (traceHas(trace, 'dynamic_client_registration')) registrationModes.push('dynamic-client-registration');
  if (traceHas(trace, 'pre_registered_client')) registrationModes.push('pre-registered');
  if (trace?.outcome?.status === 'manual_client_required') registrationModes.push('manual-client-credentials');
  const refreshTokens = oauthApplies && traceHas(trace, 'refresh') ? true : 'unknown';
  const dynamicRedirectRegistration = oauthApplies
    && traceHas(trace, 'dynamic_client_registration') ? true : 'unknown';
  const protocolKnown = protocolEra(protocolVersion);
  const direct = route === 'direct';
  const proxy = route === 'authenticated proxy';
  const directBrowserPassed = report.sections.cors?.details.some((detail) => (
    /Direct browser MCP negotiation succeeded/i.test(detail.text)
  ));
  const isHeadless = evaluationRuntime === 'headless';
  const directAccessDescription = directBrowserPassed
    ? 'Direct browser negotiation succeeded.'
    : direct
      ? isHeadless
        ? 'Direct MCP negotiation succeeded from the headless evaluator.'
        : 'Direct MCP negotiation succeeded.'
      : proxy
        ? isHeadless
          ? 'The direct route failed and the configured proxy completed negotiation.'
          : 'The browser required the authenticated proxy route.'
        : 'Direct access was not established.';

  return {
    schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
    serverUrl: report.serverUrl,
    transport: {
      kind: observed(
        transportType === 'streamable-http' || transportType === 'legacy-sse'
          ? transportType
          : 'unknown',
        transportType ? `Negotiated ${transportType}.` : 'No transport was conclusively negotiated.'
      ),
    },
    protocol: {
      era: observed(protocolKnown, protocolKnown === 'unknown'
        ? 'The protocol era is unknown.'
        : `Negotiated the ${protocolKnown} protocol era.`),
      version: observed(protocolVersion || 'unknown', protocolVersion
        ? `The server selected MCP ${protocolVersion}.`
        : 'The server did not expose a protocol version.'),
      sessionBehavior: sessionBehaviorFact(records),
    },
    authorization: {
      requirement: observed(
        outcome === 'authorization-required' || hasTargetChallenge
          ? 'required'
          : unauthenticatedTargetRequestSucceeded && oauthApplies
            ? 'optional'
            : unauthenticatedTargetRequestSucceeded
              ? 'none'
              : 'unknown',
        outcome === 'authorization-required'
          ? 'The target returned an authentication challenge before evaluation could continue.'
          : hasTargetChallenge
            ? 'A direct target authentication challenge was observed and the authenticated retry was evaluated.'
            : unauthenticatedTargetRequestSucceeded && oauthApplies
              ? 'The server completed an unauthenticated evaluation while also advertising OAuth metadata.'
            : unauthenticatedTargetRequestSucceeded
              ? 'The target completed evaluation without a target credential.'
              : 'Authorization requirements could not be determined.'
      ),
      schemes: observed(schemes, schemes === 'unknown'
        ? 'No authorization scheme was conclusively observed.'
        : schemes.length ? `Observed authorization: ${schemes.join(', ')}.` : 'No authorization challenge was observed.'),
      oauth: {
        protectedResourceMetadata: observed(
          oauthApplies ? protectedResourceMetadata : 'unknown',
          !oauthApplies
            ? 'OAuth does not apply to this observation.'
            : protectedResourceMetadata === 'unknown'
              ? 'Protected-resource metadata discovery was not completed conclusively.'
              : 'Protected-resource metadata discovery completed.',
          'authorization-server'
        ),
        authorizationServerMetadata: observed(
          oauthApplies ? authorizationServerMetadata : 'unknown',
          !oauthApplies
            ? 'OAuth does not apply to this observation.'
            : authorizationServerMetadata === 'unknown'
              ? 'Authorization-server metadata discovery was not completed conclusively.'
              : 'Authorization-server metadata discovery completed.',
          'authorization-server'
        ),
        registrationModes: observed(
          oauthApplies && registrationModes.length ? registrationModes : 'unknown',
          registrationModes.length
            ? `Observed OAuth client registration modes: ${registrationModes.join(', ')}.`
            : 'OAuth client registration behavior was not established.',
          'authorization-server'
        ),
        pkceS256: observed(
          oauthApplies ? pkceS256 : 'unknown',
          !oauthApplies
            ? 'OAuth does not apply to this observation.'
            : pkceS256 === 'unknown'
              ? 'S256 PKCE support was not checked conclusively.'
              : 'S256 PKCE support was checked.',
          'authorization-server'
        ),
        refreshTokens: observed(
          refreshTokens,
          refreshTokens === true
            ? 'A refresh-token grant succeeded during this OAuth flight.'
            : 'Refresh-token support was not established by this flight.',
          'authorization-server'
        ),
        redirectPolicy: observed<RedirectPolicy>('unknown', 'The authorization server redirect matching policy was not observed.', 'authorization-server'),
        registeredRedirectUris: observed<readonly string[]>('unknown', 'Registered host callback URIs were not observed.', 'authorization-server'),
        dynamicRedirectRegistration: observed(
          dynamicRedirectRegistration,
          dynamicRedirectRegistration === true
            ? 'Dynamic client registration succeeded during this OAuth flight.'
            : 'Dynamic callback registration was not conclusively observed.',
          'authorization-server'
        ),
      },
    },
    capabilities: {
      tools: capabilityFact(report, 'tools/list'),
      resources: capabilityFact(report, 'resources/list'),
      prompts: capabilityFact(report, 'prompts/list'),
      resourceSubscriptions: observed<CapabilityAvailability>('unknown', 'Resource subscription behavior was not exercised.'),
      sampling: observed<CapabilityAvailability>('unknown', 'Sampling behavior was not exercised.'),
      elicitation: observed<CapabilityAvailability>('unknown', 'Elicitation behavior was not exercised.'),
      tasks: observed<CapabilityAvailability>('unknown', 'Task behavior was not exercised.'),
    },
    environment: {
      directAccess: observed(direct || directBrowserPassed ? 'reachable' : proxy ? 'blocked' : 'unknown',
        directAccessDescription, isHeadless ? 'target-server' : 'browser'),
      cors: observed(directBrowserPassed ? 'allowed' : proxy ? 'blocked' : 'unknown',
        directBrowserPassed
          ? 'The browser read MCP responses directly.'
          : isHeadless
            ? 'Browser CORS behavior is not observable from the headless runtime.'
            : proxy
              ? 'Direct browser access failed and the proxy was used.'
              : 'Browser CORS behavior was not established.', 'browser'),
      proxyRoute: observed(direct ? 'not-used' : proxy ? 'used' : 'unknown',
        direct ? 'No proxy was used.' : proxy ? 'The authenticated proxy completed negotiation.' : 'Proxy use was not established.', 'configuration'),
    },
  };
};

export const createCompatibilityMatrix = (
  report: EvaluationReport,
  trace?: OAuthTraceV1
): CompatibilityMatrixV1 => assessCompatibilityMatrix(createObservedServerFacts(report, trace));

export type ReleaseReadinessStatus = 'ready' | 'blocked' | 'review' | 'authorization-required' | 'unknown';

export interface ReleasePriority {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'unknown';
  title: string;
  detail: string;
  remediation: string;
  source: 'Host compatibility' | 'Tool surface' | 'Evaluation';
}

export interface ReleaseDecision {
  status: ReleaseReadinessStatus;
  answer: string;
  summary: string;
  priorities: ReleasePriority[];
}

const severityOrder: Record<ReleasePriority['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  unknown: 3,
};

/** Builds one prioritized decision from protocol, host, and tool-surface evidence. */
export const createReleaseDecision = (
  report: EvaluationReport,
  matrix: CompatibilityMatrixV1,
  toolSurface: ToolSurfaceAnalysisV1 | undefined = report.toolSurfaceAnalysis,
  trace?: OAuthTraceV1
): ReleaseDecision => {
  const outcome = resolveEvaluationOutcome(report);
  if (outcome === 'authorization-required') {
    const schemes = inferAuthorizationSchemes(report, trace);
    const advertisedSchemes = schemes === 'unknown' ? [] : schemes;
    const authorizationLabels = [
      advertisedSchemes.includes('oauth') ? 'OAuth' : undefined,
      advertisedSchemes.includes('bearer') ? 'bearer token' : undefined,
      advertisedSchemes.includes('api-key') ? 'API key' : undefined,
    ].filter((label): label is string => Boolean(label));
    const remediationOptions = [
      advertisedSchemes.includes('oauth')
        ? 'complete the guided OAuth flow or configure a registered OAuth client'
        : undefined,
      advertisedSchemes.includes('bearer')
        ? 'supply a valid bearer token for the MCP target'
        : undefined,
      advertisedSchemes.includes('api-key')
        ? 'configure the API key required by the MCP target'
        : undefined,
    ].filter((option): option is string => Boolean(option));
    const remediation = remediationOptions.length > 0
      ? `Choose an advertised authorization method: ${remediationOptions.join('; ')}, then rerun the report.`
      : 'Inspect the target WWW-Authenticate challenge or authorization configuration, provide the required credential, then rerun the report.';
    return {
      status: 'authorization-required',
      answer: 'Not yet — authorization is required',
      summary: `${authorizationLabels.length > 0 ? authorizationLabels.join(' or ') : 'Target'} authorization must complete before a release decision can be made.`,
      priorities: [{
        id: 'evaluation.authorization',
        severity: 'high',
        title: 'Complete server authorization',
        detail: 'The server challenged the evaluation before its protocol and capabilities could be assessed.',
        remediation,
        source: 'Evaluation',
      }],
    };
  }

  const priorities: ReleasePriority[] = [];
  if (outcome === 'failed') {
    const proxyAuthenticationFailed = metadataRecords(report).some((record) => (
      record.authenticationSource === 'proxy'
      || Array.isArray(record.routeFailures) && record.routeFailures.some((failure) => (
        Boolean(failure) && typeof failure === 'object'
        && (failure as Record<string, unknown>).authenticationSource === 'proxy'
      ))
    ));
    priorities.push({
      id: 'evaluation.negotiation-failed',
      severity: 'high',
      title: proxyAuthenticationFailed ? 'Restore authenticated proxy access' : 'Restore MCP negotiation',
      detail: proxyAuthenticationFailed
        ? 'The mcptest proxy rejected or could not validate its own authentication before the target could be evaluated.'
        : 'The evaluator could not establish a complete MCP connection.',
      remediation: proxyAuthenticationFailed
        ? 'Refresh the mcptest session or proxy credential, confirm proxy access, and rerun without treating the proxy challenge as target OAuth.'
        : 'Verify the published endpoint, transport response, protocol lifecycle, and proxy route, then rerun the full report.',
      source: 'Evaluation',
    });
  } else if (outcome === 'partial') {
    priorities.push({
      id: 'evaluation.partial',
      severity: 'unknown',
      title: 'Complete skipped report checks',
      detail: 'At least one required release-readiness observation is missing.',
      remediation: 'Resolve the skipped check shown in protocol evidence and rerun until the report completes.',
      source: 'Evaluation',
    });
  }
  for (const assessment of Object.values(matrix.assessments)) {
    for (const finding of assessment.findings) {
      if (finding.outcome !== 'fail' && finding.outcome !== 'unknown') continue;
      priorities.push({
        id: `${assessment.profileId}.${finding.ruleId}`,
        severity: finding.outcome === 'fail' ? 'high' : 'unknown',
        title: `${finding.summary} (${assessment.profileId})`,
        detail: finding.detail,
        remediation: finding.remediation?.action || 'Collect the missing observation and rerun the report.',
        source: 'Host compatibility',
      });
    }
  }
  const findingSeverities = ['critical', 'high', 'medium'] as const;
  for (const severity of findingSeverities) {
    for (const finding of toolSurface?.findings[severity] || []) {
      const item = finding as ToolSurfaceFindingV1;
      priorities.push({
        id: `tool.${item.id}`,
        severity,
        title: item.title,
        detail: item.summary,
        remediation: item.remediation,
        source: 'Tool surface',
      });
    }
  }
  const unique = [...new Map(priorities.map((item) => [
    `${item.source}:${item.title}:${item.remediation}`,
    item,
  ])).values()].sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
  const hasBlocker = unique.some((item) => item.severity === 'critical' || item.severity === 'high');
  const hasUnknown = unique.some((item) => item.severity === 'unknown');

  if (outcome === 'failed') {
    return { status: 'blocked', answer: 'No — evaluation failed', summary: 'A complete MCP connection is required before release.', priorities: unique };
  }
  if (hasBlocker) {
    return { status: 'blocked', answer: 'No — fix blockers first', summary: 'At least one host incompatibility or high-priority tool risk needs remediation.', priorities: unique };
  }
  if (outcome === 'partial') {
    return { status: 'unknown', answer: 'Unknown — the report is partial', summary: 'Complete the skipped checks before making a release decision.', priorities: unique };
  }
  if (hasUnknown || unique.length > 0) {
    return { status: 'review', answer: 'Review before shipping', summary: 'No confirmed blocker was found, but caveats or unknowns still need a release-owner decision.', priorities: unique };
  }
  return { status: 'ready', answer: 'Yes — no release blockers found', summary: 'The evaluated protocol, host, and tool-surface checks found no blocking issue.', priorities: [] };
};
