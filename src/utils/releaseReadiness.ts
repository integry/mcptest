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

const detailsText = (report: EvaluationReport): string => Object.values(report.sections)
  .flatMap((section) => section.details)
  .map((detail) => `${detail.text} ${detail.context || ''}`)
  .join('\n');

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

const protocolEra = (version: string | undefined, label: string | undefined): Known<ProtocolEra> => {
  const year = version?.match(/\b(2024|2025|2026)\b/)?.[1];
  if (year === '2024' || year === '2025' || year === '2026') return year;
  if (label === 'modern') return '2026';
  return 'unknown';
};

const traceHas = (
  trace: OAuthTraceV1 | undefined,
  type: OAuthTraceV1['events'][number]['type'],
  outcomes: readonly string[] = ['succeeded']
): boolean => trace?.events.some((event) => event.type === type && outcomes.includes(event.outcome)) || false;

const inferAuthorizationSchemes = (
  report: EvaluationReport,
  trace: OAuthTraceV1 | undefined
): Known<readonly AuthorizationScheme[]> => {
  const text = detailsText(report);
  if (/api[-_ ]?key/i.test(text)) return ['api-key'];
  if (trace || report.sections.security || /\boauth\b/i.test(text)) return ['oauth'];
  if (/\bbearer\b/i.test(text)) return ['bearer'];
  if (report.outcome === 'authorization-required') return ['oauth'];
  if (resolveEvaluationOutcome(report) === 'scored') return [];
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
  const protocolLabel = firstString(records, 'protocolEra');
  const route = firstString(records, 'route');
  const outcome = resolveEvaluationOutcome(report);
  const schemes = inferAuthorizationSchemes(report, trace);
  const oauthApplies = schemes !== 'unknown' && schemes.includes('oauth');
  const hasProtectedMetadata = report.sections.security?.details.some((detail) => (
    /protected-resource metadata available/i.test(detail.text)
  ));
  const hasAuthorizationMetadata = report.sections.security?.details.some((detail) => (
    /authorization-server metadata available/i.test(detail.text)
  ));
  const pkce = report.sections.security?.details.some((detail) => /PKCE support enabled/i.test(detail.text));
  const registrationModes: OAuthRegistrationMode[] = [];
  if (traceHas(trace, 'cimd')) registrationModes.push('client-id-metadata-document');
  if (traceHas(trace, 'dynamic_client_registration')) registrationModes.push('dynamic-client-registration');
  if (traceHas(trace, 'pre_registered_client')) registrationModes.push('pre-registered');
  if (trace?.outcome?.status === 'manual_client_required') registrationModes.push('manual-client-credentials');
  const protocolKnown = protocolEra(protocolVersion, protocolLabel);
  const direct = route === 'direct';
  const proxy = route === 'authenticated proxy';
  const directBrowserPassed = report.sections.cors?.details.some((detail) => (
    /Direct browser MCP negotiation succeeded/i.test(detail.text)
  ));

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
      sessionBehavior: observed(
        protocolLabel === 'modern' ? 'stateless' : protocolKnown !== 'unknown' ? 'stateful' : 'unknown',
        protocolLabel === 'modern'
          ? 'The 2026 server/discover lifecycle completed without a transport session.'
          : protocolKnown !== 'unknown'
            ? 'The initialize lifecycle used stateful compatibility semantics.'
            : 'Session behavior was not observed.'
      ),
    },
    authorization: {
      requirement: observed(
        outcome === 'authorization-required' || trace
          ? 'required'
          : outcome === 'scored' && oauthApplies
            ? 'optional'
            : outcome === 'scored'
              ? 'none'
              : 'unknown',
        outcome === 'authorization-required'
          ? 'The target returned an authentication challenge before evaluation could continue.'
          : trace
            ? 'An OAuth trace exists for the target and the authenticated retry was evaluated.'
            : outcome === 'scored' && oauthApplies
              ? 'The server completed an unauthenticated evaluation while also advertising OAuth metadata.'
            : outcome === 'scored'
              ? 'The evaluation completed without an authorization prerequisite.'
              : 'Authorization requirements could not be determined.'
      ),
      schemes: observed(schemes, schemes === 'unknown'
        ? 'No authorization scheme was conclusively observed.'
        : schemes.length ? `Observed authorization: ${schemes.join(', ')}.` : 'No authorization challenge was observed.'),
      oauth: {
        protectedResourceMetadata: observed(
          oauthApplies ? Boolean(hasProtectedMetadata || traceHas(trace, 'protected_resource_metadata')) : 'unknown',
          oauthApplies ? 'Protected-resource metadata discovery was checked.' : 'OAuth does not apply to this observation.',
          'authorization-server'
        ),
        authorizationServerMetadata: observed(
          oauthApplies ? Boolean(hasAuthorizationMetadata || traceHas(trace, 'authorization_server_metadata')) : 'unknown',
          oauthApplies ? 'Authorization-server metadata discovery was checked.' : 'OAuth does not apply to this observation.',
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
          oauthApplies ? Boolean(pkce || traceHas(trace, 'pkce')) : 'unknown',
          oauthApplies ? 'S256 PKCE support was checked.' : 'OAuth does not apply to this observation.',
          'authorization-server'
        ),
        refreshTokens: observed(
          oauthApplies && traceHas(trace, 'refresh') ? true : 'unknown',
          'Refresh-token support was not established by this flight.',
          'authorization-server'
        ),
        redirectPolicy: observed<RedirectPolicy>('unknown', 'The authorization server redirect matching policy was not observed.', 'authorization-server'),
        registeredRedirectUris: observed<readonly string[]>('unknown', 'Registered host callback URIs were not observed.', 'authorization-server'),
        dynamicRedirectRegistration: observed(
          traceHas(trace, 'dynamic_client_registration') ? true : 'unknown',
          'Dynamic callback registration was not conclusively observed.',
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
        direct || directBrowserPassed ? 'Direct browser negotiation succeeded.' : proxy ? 'The browser required the authenticated proxy route.' : 'Direct access was not established.', 'browser'),
      cors: observed(directBrowserPassed ? 'allowed' : proxy ? 'blocked' : 'unknown',
        directBrowserPassed ? 'The browser read MCP responses directly.' : proxy ? 'Direct browser access failed and the proxy was used.' : 'Browser CORS behavior was not established.', 'browser'),
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
  toolSurface: ToolSurfaceAnalysisV1 | undefined = report.toolSurfaceAnalysis
): ReleaseDecision => {
  const outcome = resolveEvaluationOutcome(report);
  if (outcome === 'authorization-required') {
    return {
      status: 'authorization-required',
      answer: 'Not yet — authorization is required',
      summary: 'Authorize access, then run the report again before making a release decision.',
      priorities: [{
        id: 'evaluation.authorization',
        severity: 'high',
        title: 'Complete server authorization',
        detail: 'The server challenged the evaluation before its protocol and capabilities could be assessed.',
        remediation: 'Use the guided OAuth flow or configure a registered client, then rerun the report.',
        source: 'Evaluation',
      }],
    };
  }

  const priorities: ReleasePriority[] = [];
  if (outcome === 'failed') {
    priorities.push({
      id: 'evaluation.negotiation-failed',
      severity: 'high',
      title: 'Restore MCP negotiation',
      detail: 'The evaluator could not establish a complete MCP connection.',
      remediation: 'Verify the published endpoint, transport response, protocol lifecycle, and proxy route, then rerun the full report.',
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
  if (outcome === 'partial') {
    return { status: 'unknown', answer: 'Unknown — the report is partial', summary: 'Complete the skipped checks before making a release decision.', priorities: unique };
  }
  if (hasBlocker) {
    return { status: 'blocked', answer: 'No — fix blockers first', summary: 'At least one host incompatibility or high-priority tool risk needs remediation.', priorities: unique };
  }
  if (hasUnknown || unique.length > 0) {
    return { status: 'review', answer: 'Review before shipping', summary: 'No confirmed blocker was found, but caveats or unknowns still need a release-owner decision.', priorities: unique };
  }
  return { status: 'ready', answer: 'Yes — no release blockers found', summary: 'The evaluated protocol, host, and tool-surface checks found no blocking issue.', priorities: [] };
};
