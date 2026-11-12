/**
 * Connector directory preflight: per-directory checklists for the Claude
 * Connectors Directory and the ChatGPT Directory, evaluated from evidence a
 * report (or the /submit endpoint probe) already holds. Nothing here probes the
 * server again. Requirement text and sources live in
 * `src/data/connectorDirectoryRequirements.ts`.
 */
import type { AuthorizationScheme, Known } from '../compatibility';
import {
  CONNECTOR_DIRECTORIES,
  CONNECTOR_DIRECTORY_REQUIREMENTS,
  CONNECTOR_DIRECTORY_REQUIREMENTS_REVIEWED_ON,
  MULTIPLEXED_OPERATIONS_ADVISORY,
  type ConnectorDirectory,
  type ConnectorDirectoryId,
  type ConnectorDirectoryRequirement,
  type ConnectorDirectoryRequirementId,
  type DirectoryRequirementSource,
} from '../data/connectorDirectoryRequirements';
import type {
  ToolAnnotationRecordV1,
  ToolAnnotationSummaryV1,
  ToolDefinitionSnapshotSetV1,
} from '../types/toolSurfaceAnalysis';
import { isPrivateOrReservedHost, type CatalogSubmissionEvidence } from './catalogSubmission';
import { resolveEvaluationOutcome, type EvaluationReport } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import { createObservedServerFacts } from './releaseReadiness';
import {
  assessHttpMethodSelectors,
  findMultiplexedOperationSelectors,
  type MethodSelectorReview,
  type OperationSelectorMatch,
} from './toolOperationMultiplexing';

export const CONNECTOR_DIRECTORY_PREFLIGHT_VERSION = 1 as const;
export const CLAUDE_TOOL_NAME_CHARACTER_LIMIT = 64;
const EVIDENCE_LIMIT = 10;

export type DirectoryPreflightStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable' | 'manual';

/** The observations the preflight needs, independent of where they were collected. */
export interface DirectoryPreflightObservations {
  endpointUrl: string;
  /** Whether the endpoint answered as an MCP server or with its own auth challenge. */
  reachable: Known<boolean>;
  authorization: {
    requirement: Known<'required' | 'optional' | 'none'>;
    schemes: Known<readonly AuthorizationScheme[]>;
    protectedResourceMetadata: Known<boolean>;
    authorizationServerMetadata: Known<boolean>;
    pkceS256: Known<boolean>;
  };
  /** Absent when the tool list was not observed (for example, before authorization). */
  tools?: {
    annotations?: ToolAnnotationSummaryV1;
    definitions?: ToolDefinitionSnapshotSetV1;
  };
}

export interface DirectoryPreflightItem {
  id: ConnectorDirectoryRequirementId;
  check: ConnectorDirectoryRequirement['check'];
  title: string;
  requirement: string;
  status: DirectoryPreflightStatus;
  /** What was observed, or what to do for a manual item. */
  detail: string;
  /** Tool names or arguments behind a failure, capped. */
  evidence: string[];
  source: DirectoryRequirementSource;
}

export interface DirectoryPreflightResult {
  directory: ConnectorDirectory;
  items: DirectoryPreflightItem[];
  counts: Record<DirectoryPreflightStatus, number>;
}

export interface DirectoryPreflightAdvisory {
  id: typeof MULTIPLEXED_OPERATIONS_ADVISORY.id;
  severity: 'advisory';
  title: string;
  explanation: string;
  matches: OperationSelectorMatch[];
  sources: readonly DirectoryRequirementSource[];
}

export interface ConnectorDirectoryPreflightV1 {
  version: typeof CONNECTOR_DIRECTORY_PREFLIGHT_VERSION;
  requirementsReviewedOn: string;
  directories: DirectoryPreflightResult[];
  advisories: DirectoryPreflightAdvisory[];
}

interface Outcome {
  status: DirectoryPreflightStatus;
  detail: string;
  evidence?: string[];
}

type Evaluator = (observations: DirectoryPreflightObservations) => Outcome;

const capped = (values: readonly string[]): string[] => (
  values.length > EVIDENCE_LIMIT
    ? [...values.slice(0, EVIDENCE_LIMIT), `and ${values.length - EVIDENCE_LIMIT} more`]
    : [...values]
);

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const remoteHttps: Evaluator = ({ endpointUrl, reachable }) => {
  let url: URL;
  try {
    url = new URL(endpointUrl);
  } catch {
    return { status: 'fail', detail: 'The endpoint is not a valid URL.' };
  }
  if (url.protocol !== 'https:') {
    return { status: 'fail', detail: `The endpoint uses ${url.protocol.replace(':', '')}; directories require an https:// URL.` };
  }
  // Same public-host rule the mcptest catalog submission applies.
  if (isPrivateOrReservedHost(url.hostname)) {
    return { status: 'fail', detail: `${url.hostname} is a local, private, or IP-literal host; directories need a public remote server with a host name.` };
  }
  if (reachable === 'unknown') return { status: 'unknown', detail: 'Reachability was not established by this run.' };
  return reachable
    ? { status: 'pass', detail: `${url.host} answered over HTTPS.` }
    : { status: 'fail', detail: `${url.host} uses HTTPS but no MCP transport answered in this run.` };
};

/**
 * Applies a per-tool predicate to the recorded annotations. A missing or
 * partial record never passes: unrecorded tools could be the failing ones.
 */
const perTool = (
  missing: (tool: ToolAnnotationRecordV1) => boolean,
  describe: (count: number) => string,
  passDetail: (count: number) => string
): Evaluator => ({ tools }) => {
  const summary = tools?.annotations;
  if (!summary || summary.status === 'unavailable') {
    return {
      status: 'unknown',
      detail: tools
        ? 'Tool metadata was not recorded in this report. Rerun the report to check tools.'
        : 'The tool list was not observed. Authorize the evaluation and rerun it to check tools.',
    };
  }
  const failing = summary.tools.filter(missing).map((tool) => tool.name);
  if (failing.length > 0) return { status: 'fail', detail: describe(failing.length), evidence: capped(failing) };
  if (summary.status === 'partial') {
    return { status: 'unknown', detail: `${plural(summary.tools.length, 'recorded tool')} passed, but not every tool could be recorded.` };
  }
  if (summary.tools.length === 0) return { status: 'not-applicable', detail: 'The server exposes no tools.' };
  return { status: 'pass', detail: passDetail(summary.tools.length) };
};

const METHOD_REVIEW_REASONS: Record<MethodSelectorReview['reason'], string> = {
  'not-plain': 'a method argument whose schema, or the input schema around it, uses keywords other than a plain enum or const',
  nested: 'a method argument that is not declared directly in the input schema',
  'method-values': 'an enum or const listing both safe and unsafe HTTP methods outside a plain method argument',
  'unsupported-keyword': 'patternProperties or an external $ref, either of which could declare a method argument',
  'too-large': 'an input schema larger than the check examines',
};

const methodSelectorScan: Evaluator = ({ tools }) => {
  const definitions = tools?.definitions;
  if (!definitions || definitions.status === 'unavailable') {
    return { status: 'unknown', detail: 'Tool input schemas were not recorded, so tool arguments could not be checked.' };
  }
  const { failures, reviews } = assessHttpMethodSelectors(definitions.tools);
  if (failures.length > 0) {
    return {
      status: 'fail',
      detail: `${plural(failures.length, 'tool argument')} accept both safe and unsafe HTTP methods. Split each into a read-only tool and write tools.`,
      evidence: capped(failures.map((match) => `${match.tool} (${match.argument}: ${match.values.join(', ')})`)),
    };
  }
  // The check only decides plain schemas; anything else is neither passed nor failed.
  if (reviews.length > 0) {
    const reasons = [...new Set(reviews.map((review) => METHOD_REVIEW_REASONS[review.reason]))];
    return {
      status: 'manual',
      detail: `Manual review needed: ${plural(reviews.length, 'tool')} could not be checked automatically (${reasons.join('; ')}). Confirm that no tool accepts both safe and unsafe HTTP methods.`,
      evidence: capped(reviews.map((review) => `${review.tool} (${review.location || 'input schema'})`)),
    };
  }
  if (definitions.status === 'partial') {
    return { status: 'unknown', detail: 'No catch-all method argument was found in the recorded tools, but not every tool schema could be recorded.' };
  }
  if (definitions.tools.length === 0) return { status: 'not-applicable', detail: 'The server exposes no tools.' };
  return { status: 'pass', detail: 'No tool takes a method argument that mixes safe and unsafe HTTP methods.' };
};

type OAuthState = 'confirmed' | 'absent' | 'not-required' | 'unknown';

/**
 * Whether OAuth is the observed authorization method. A bare `Bearer`
 * challenge is ambiguous until discovery metadata confirms OAuth.
 */
const oauthState = ({ authorization }: DirectoryPreflightObservations): OAuthState => {
  if (authorization.requirement === 'none') return 'not-required';
  if (authorization.requirement === 'unknown' || authorization.schemes === 'unknown') return 'unknown';
  if (!authorization.schemes.includes('oauth')) return authorization.schemes.length > 0 ? 'absent' : 'unknown';
  if (authorization.protectedResourceMetadata === true || authorization.authorizationServerMetadata === true) {
    return 'confirmed';
  }
  if (authorization.protectedResourceMetadata === false && authorization.authorizationServerMetadata === false) {
    return authorization.schemes.some((scheme) => scheme !== 'oauth') ? 'absent' : 'unknown';
  }
  return 'unknown';
};

const nonOAuthSchemes = (observations: DirectoryPreflightObservations): string => {
  const schemes = observations.authorization.schemes;
  const labels = schemes === 'unknown' ? [] : schemes.filter((scheme) => scheme !== 'oauth');
  return labels.length > 0 ? labels.join(' or ') : 'a non-OAuth credential';
};

const claudeOAuth: Evaluator = (observations) => {
  switch (oauthState(observations)) {
    case 'confirmed':
      return { status: 'pass', detail: 'The server requires authorization and advertises OAuth through discovery metadata.' };
    case 'not-required':
      return { status: 'pass', detail: 'No authentication was required, which fits public data. If tools act on a user’s account, offer OAuth 2.0 instead of an unauthenticated server.' };
    case 'absent':
      return { status: 'fail', detail: `The server asks for ${nonOAuthSchemes(observations)} without OAuth discovery metadata. Directory connectors that need sign-in use OAuth 2.0; static request-header credentials are a limited beta.` };
    default:
      return { status: 'unknown', detail: 'The authorization method could not be confirmed from this run.' };
  }
};

const oauthApplies = (observations: DirectoryPreflightObservations): Outcome | undefined => {
  const state = oauthState(observations);
  if (state === 'not-required') return { status: 'not-applicable', detail: 'The server did not require authorization.' };
  if (state === 'absent') return { status: 'not-applicable', detail: 'OAuth was not offered; see the OAuth 2.0 item.' };
  if (state === 'unknown' && observations.authorization.requirement === 'unknown') {
    return { status: 'unknown', detail: 'Authorization requirements were not established by this run.' };
  }
  return undefined;
};

const claudeOAuthDiscovery: Evaluator = (observations) => {
  const notApplicable = oauthApplies(observations);
  if (notApplicable) return notApplicable;
  const { protectedResourceMetadata: prm, authorizationServerMetadata: asm } = observations.authorization;
  if (prm === true && asm === true) {
    return { status: 'pass', detail: 'Protected resource metadata and authorization server metadata were both discovered.' };
  }
  if (prm === false || asm === false) {
    return {
      status: 'fail',
      detail: prm === false
        ? 'Protected resource metadata (RFC 9728) was not found, so Claude cannot locate the authorization server.'
        : 'Authorization server metadata (RFC 8414 or OpenID Connect discovery) was not found.',
    };
  }
  return { status: 'unknown', detail: 'OAuth discovery was not completed conclusively in this run.' };
};

const claudePkce: Evaluator = (observations) => {
  const notApplicable = oauthApplies(observations);
  if (notApplicable) return notApplicable;
  const { pkceS256 } = observations.authorization;
  if (pkceS256 === true) return { status: 'pass', detail: 'The authorization server advertises S256 PKCE.' };
  if (pkceS256 === false) return { status: 'fail', detail: 'S256 was not listed in code_challenge_methods_supported.' };
  return { status: 'unknown', detail: 'S256 PKCE support was not checked conclusively.' };
};

const chatgptAuthentication: Evaluator = (observations) => {
  switch (oauthState(observations)) {
    case 'confirmed':
      return { status: 'pass', detail: 'The server uses OAuth, which the portal connection form supports.' };
    case 'not-required':
      return { status: 'pass', detail: 'No authentication was required, which the portal connection form supports.' };
    case 'absent':
      return { status: 'fail', detail: `The server asks for ${nonOAuthSchemes(observations)}; the portal has no API-key or bearer-token connection flow.` };
    default:
      return { status: 'unknown', detail: 'The authorization method could not be confirmed from this run.' };
  }
};

const duplicateNames: Evaluator = ({ tools }) => {
  const summary = tools?.annotations;
  if (!summary || summary.status === 'unavailable') {
    return { status: 'unknown', detail: 'The tool list was not observed, so name uniqueness could not be checked.' };
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of summary.tools) {
    if (seen.has(tool.name)) duplicates.add(tool.name);
    seen.add(tool.name);
  }
  if (duplicates.size > 0) {
    return { status: 'fail', detail: `${plural(duplicates.size, 'tool name')} appear more than once.`, evidence: capped([...duplicates]) };
  }
  if (summary.status === 'partial') return { status: 'unknown', detail: 'No duplicate was found, but not every tool could be recorded.' };
  if (summary.tools.length === 0) return { status: 'not-applicable', detail: 'The server exposes no tools.' };
  return { status: 'pass', detail: `All ${plural(summary.tools.length, 'tool name')} are unique.` };
};

/** Claude asks for the applicable hint set to true; an explicit false classifies nothing. */
const hasAffirmativeSafetyHint = (tool: ToolAnnotationRecordV1): boolean => (
  tool.readOnlyHint === true || tool.destructiveHint === true
);

const missingHints = (tool: ToolAnnotationRecordV1, hints: readonly (keyof ToolAnnotationRecordV1)[]) => (
  hints.filter((hint) => typeof tool[hint] !== 'boolean')
);

const EVALUATORS: Partial<Record<ConnectorDirectoryRequirementId, Evaluator>> = {
  'claude.remote-https': remoteHttps,
  'claude.tool-title': perTool(
    (tool) => !tool.title,
    (count) => `${plural(count, 'tool')} have no title (set the tool's title or annotations.title).`,
    (count) => `All ${plural(count, 'tool')} declare a title.`
  ),
  'claude.tool-safety-hint': perTool(
    (tool) => !hasAffirmativeSafetyHint(tool),
    (count) => `${plural(count, 'tool')} set neither readOnlyHint: true nor destructiveHint: true (a hint set to false does not classify the tool).`,
    (count) => `All ${plural(count, 'tool')} set readOnlyHint: true or destructiveHint: true.`
  ),
  'claude.tool-name-length': perTool(
    (tool) => tool.name.length > CLAUDE_TOOL_NAME_CHARACTER_LIMIT,
    (count) => `${plural(count, 'tool name')} exceed ${CLAUDE_TOOL_NAME_CHARACTER_LIMIT} characters.`,
    (count) => `All ${plural(count, 'tool name')} are ${CLAUDE_TOOL_NAME_CHARACTER_LIMIT} characters or fewer.`
  ),
  'claude.separate-read-write': methodSelectorScan,
  'claude.oauth-for-authenticated-services': claudeOAuth,
  'claude.oauth-discovery': claudeOAuthDiscovery,
  'claude.pkce-s256': claudePkce,
  'chatgpt.remote-https': remoteHttps,
  'chatgpt.tool-annotations': perTool(
    (tool) => missingHints(tool, ['readOnlyHint', 'destructiveHint', 'openWorldHint']).length > 0,
    (count) => `${plural(count, 'tool')} leave readOnlyHint, destructiveHint, or openWorldHint unset.`,
    (count) => `All ${plural(count, 'tool')} set all three hints explicitly.`
  ),
  'chatgpt.tool-description': perTool(
    (tool) => !tool.description,
    (count) => `${plural(count, 'tool')} have an empty or missing description.`,
    (count) => `All ${plural(count, 'tool')} have a description.`
  ),
  'chatgpt.tool-name-unique': duplicateNames,
  'chatgpt.supported-authentication': chatgptAuthentication,
};

/** Evaluator ids, exported so tests can prove every automatic requirement has one. */
export const AUTOMATED_DIRECTORY_CHECK_IDS = Object.keys(EVALUATORS) as ConnectorDirectoryRequirementId[];

const emptyCounts = (): Record<DirectoryPreflightStatus, number> => ({
  pass: 0, fail: 0, unknown: 0, 'not-applicable': 0, manual: 0,
});

const evaluateItem = (
  requirement: ConnectorDirectoryRequirement,
  observations: DirectoryPreflightObservations
): DirectoryPreflightItem => {
  const evaluator = EVALUATORS[requirement.id];
  const outcome: Outcome = requirement.check === 'manual' || !evaluator
    ? { status: 'manual', detail: requirement.requirement }
    : evaluator(observations);
  return {
    id: requirement.id,
    check: requirement.check,
    title: requirement.title,
    requirement: requirement.requirement,
    status: outcome.status,
    detail: outcome.detail,
    evidence: outcome.evidence || [],
    source: requirement.source,
  };
};

export const evaluateConnectorDirectoryPreflight = (
  observations: DirectoryPreflightObservations
): ConnectorDirectoryPreflightV1 => {
  const directories = (Object.keys(CONNECTOR_DIRECTORIES) as ConnectorDirectoryId[]).map((id) => {
    const items = CONNECTOR_DIRECTORY_REQUIREMENTS
      .filter((requirement) => requirement.directory === id)
      .map((requirement) => evaluateItem(requirement, observations));
    const counts = emptyCounts();
    for (const item of items) counts[item.status] += 1;
    return { directory: CONNECTOR_DIRECTORIES[id], items, counts };
  });
  const matches = observations.tools?.definitions
    ? findMultiplexedOperationSelectors(observations.tools.definitions.tools)
    : [];
  return {
    version: CONNECTOR_DIRECTORY_PREFLIGHT_VERSION,
    requirementsReviewedOn: CONNECTOR_DIRECTORY_REQUIREMENTS_REVIEWED_ON,
    directories,
    advisories: matches.length > 0 ? [{
      id: MULTIPLEXED_OPERATIONS_ADVISORY.id,
      severity: 'advisory',
      title: MULTIPLEXED_OPERATIONS_ADVISORY.title,
      explanation: MULTIPLEXED_OPERATIONS_ADVISORY.explanation,
      matches: matches.slice(0, EVIDENCE_LIMIT),
      sources: MULTIPLEXED_OPERATIONS_ADVISORY.sources,
    }] : [],
  };
};

/** Observations from a full evaluation report, reusing its OAuth, discovery, and tool analysis. */
export const directoryPreflightObservationsFromReport = (
  report: EvaluationReport,
  trace?: OAuthTraceV1
): DirectoryPreflightObservations => {
  const facts = createObservedServerFacts(report, trace);
  const outcome = resolveEvaluationOutcome(report);
  const oauth = facts.authorization.oauth;
  const toolSurface = report.toolSurfaceAnalysis;
  return {
    endpointUrl: report.serverUrl,
    reachable: report.authenticationRequirement?.kind === 'proxy'
      ? 'unknown'
      : outcome !== 'failed',
    authorization: {
      requirement: facts.authorization.requirement.value,
      schemes: facts.authorization.schemes.value,
      protectedResourceMetadata: oauth.protectedResourceMetadata.value,
      authorizationServerMetadata: oauth.authorizationServerMetadata.value,
      pkceS256: oauth.pkceS256.value,
    },
    ...(toolSurface ? {
      tools: {
        ...(toolSurface.toolAnnotations ? { annotations: toolSurface.toolAnnotations } : {}),
        definitions: toolSurface.toolDefinitions,
      },
    } : {}),
  };
};

/**
 * Observations from the /submit endpoint probe (`submissionProbe.ts`). The
 * probe records reachability and the auth challenge but not tool metadata, so
 * tool items stay unknown until a full report runs.
 */
export const directoryPreflightObservationsFromSubmissionEvidence = (
  evidence: CatalogSubmissionEvidence
): DirectoryPreflightObservations => {
  const challenged = evidence.outcome === 'auth-challenge';
  const schemes: Known<readonly AuthorizationScheme[]> = !challenged
    ? []
    : evidence.authChallenge === 'oauth'
      ? ['oauth']
      : evidence.authChallenge === 'bearer' ? ['bearer'] : 'unknown';
  return {
    endpointUrl: evidence.validatedUrl || evidence.endpointUrl,
    reachable: evidence.outcome === 'unreachable' ? false : true,
    authorization: {
      requirement: evidence.outcome === 'mcp' ? 'none' : challenged ? 'required' : 'unknown',
      schemes,
      // The probe treats a resource_metadata pointer or RFC 9728 discovery as OAuth evidence.
      protectedResourceMetadata: evidence.authChallenge === 'oauth' ? true : 'unknown',
      authorizationServerMetadata: 'unknown',
      pkceS256: 'unknown',
    },
  };
};

export const createConnectorDirectoryPreflight = (
  report: EvaluationReport,
  trace?: OAuthTraceV1
): ConnectorDirectoryPreflightV1 => evaluateConnectorDirectoryPreflight(
  directoryPreflightObservationsFromReport(report, trace)
);

const STATUS_LABELS: Record<DirectoryPreflightStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  unknown: 'Unknown',
  'not-applicable': 'Not applicable',
  manual: 'Manual review',
};

export const directoryPreflightStatusLabel = (status: DirectoryPreflightStatus): string => STATUS_LABELS[status];

/** One line per directory, for CLI output. */
export const summarizeConnectorDirectoryPreflight = (preflight: ConnectorDirectoryPreflightV1): string[] => [
  ...preflight.directories.map(({ directory, counts }) => (
    `${directory.name}: ${counts.pass} pass, ${counts.fail} fail, ${counts.unknown} unknown, ${counts.manual} manual review`
  )),
  ...preflight.advisories.map((advisory) => `advisory: ${advisory.title} (${advisory.matches.map((match) => match.tool).join(', ')})`),
];

const markdownText = (value: string): string => value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>|])/g, '\\$1');

/**
 * A Markdown section appended to Markdown report downloads and CLI artifacts.
 * `redact` is applied to observed text (details, tool names, values); source
 * URLs are canonical vendor links and are written verbatim.
 */
export const serializeConnectorDirectoryPreflightMarkdown = (
  preflight: ConnectorDirectoryPreflightV1,
  redact: (value: string) => string = (value) => value
): string => {
  const text = (value: string) => markdownText(redact(value));
  const lines = [
    '## Connector directory preflight',
    '',
    `Requirements reviewed ${preflight.requirementsReviewedOn} against official vendor documentation. Manual review items cannot be decided from the endpoint and are never marked passed or failed.`,
    '',
  ];
  for (const { directory, items } of preflight.directories) {
    lines.push(`### ${directory.name}`, '');
    for (const item of items) {
      lines.push(`- [${STATUS_LABELS[item.status]}] ${markdownText(item.title)} ([source](${item.source.url}))`);
      if (item.check === 'automatic') lines.push(`  - ${text(item.detail)}`);
      for (const value of item.evidence) lines.push(`  - ${text(value)}`);
    }
    lines.push('');
  }
  for (const advisory of preflight.advisories) {
    lines.push(`### Advisory: ${markdownText(advisory.title)}`, '', markdownText(advisory.explanation), '');
    for (const match of advisory.matches) {
      lines.push(`- ${text(match.tool)}: ${text(match.argument)} selects ${text(match.values.join(', '))}`);
    }
    lines.push(`- Sources: ${advisory.sources.map((source) => `[${markdownText(source.title)}](${source.url})`).join(', ')}`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};
