import type { PublicReport } from './reportArtifact';

export type ReportDiffClassification =
  | 'breaking'
  | 'removal'
  | 'risk'
  | 'unknown'
  | 'addition'
  | 'change';

export type ReportDiffCategory =
  | 'tools'
  | 'authentication'
  | 'transport'
  | 'protocol'
  | 'capabilities'
  | 'findings'
  | 'latency'
  | 'score';

export interface ReportDiffChange {
  classification: ReportDiffClassification;
  category: ReportDiffCategory;
  path: string;
  title: string;
  detail: string;
  breaking: boolean;
}

export interface ReportDiff {
  beforeGeneratedAt: string;
  afterGeneratedAt: string;
  changes: ReportDiffChange[];
  counts: Record<ReportDiffClassification, number>;
  hasBreakingChanges: boolean;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
};

const stableString = (value: unknown): string => JSON.stringify(stableValue(value));
const same = (left: unknown, right: unknown): boolean => stableString(left) === stableString(right);
const display = (value: unknown): string => {
  if (value === undefined) return 'unavailable';
  if (typeof value === 'string') return value;
  return stableString(value);
};

const classificationRank: Record<ReportDiffClassification, number> = {
  breaking: 0,
  risk: 1,
  unknown: 2,
  removal: 3,
  addition: 4,
  change: 5,
};

const categoryRank: Record<ReportDiffCategory, number> = {
  authentication: 0,
  transport: 1,
  tools: 2,
  protocol: 3,
  capabilities: 4,
  findings: 5,
  latency: 6,
  score: 7,
};

const makeChange = (
  classification: ReportDiffClassification,
  category: ReportDiffCategory,
  path: string,
  title: string,
  detail: string,
  breaking = classification === 'breaking'
): ReportDiffChange => ({ classification, category, path, title, detail, breaking });

const schemaType = (schema: JsonRecord): string[] | undefined => {
  const value = schema.type;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return [...value].sort();
  }
  return undefined;
};

const stringSet = (value: unknown): Set<string> => new Set(
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
);

const schemaChanges = (
  before: unknown,
  after: unknown,
  toolName: string,
  path = `tools.${toolName}.inputSchema`
): ReportDiffChange[] => {
  if (same(before, after)) return [];
  if (!isRecord(before) || !isRecord(after)) {
    return [makeChange(
      'unknown', 'tools', path, `Could not compare ${toolName} input schema`,
      'At least one schema is not a comparable JSON Schema object.'
    )];
  }

  const changes: ReportDiffChange[] = [];
  const reportedHandledKeys = new Set<string>();
  const beforeType = schemaType(before);
  const afterType = schemaType(after);
  const typeChangeStart = changes.length;
  if (!same(beforeType, afterType)) {
    changes.push(makeChange(
      'breaking', 'tools', `${path}.type`, `${toolName} input type changed`,
      `Type changed from ${display(beforeType)} to ${display(afterType)}.`
    ));
  }
  if (changes.length > typeChangeStart) reportedHandledKeys.add('type');

  const beforeRequired = stringSet(before.required);
  const afterRequired = stringSet(after.required);
  const requiredChangeStart = changes.length;
  for (const name of [...afterRequired].filter((name) => !beforeRequired.has(name)).sort()) {
    changes.push(makeChange(
      'breaking', 'tools', `${path}.required.${name}`, `${toolName}.${name} became required`,
      'Existing callers that omit this input will no longer satisfy the schema.'
    ));
  }
  for (const name of [...beforeRequired].filter((name) => !afterRequired.has(name)).sort()) {
    changes.push(makeChange(
      'change', 'tools', `${path}.required.${name}`, `${toolName}.${name} is now optional`,
      'The input contract was relaxed.'
    ));
  }
  if (changes.length > requiredChangeStart) reportedHandledKeys.add('required');

  const beforeProperties = isRecord(before.properties) ? before.properties : {};
  const afterProperties = isRecord(after.properties) ? after.properties : {};
  const propertiesChangeStart = changes.length;
  let addedRequiredProperty = false;
  for (const name of Object.keys(afterProperties).filter((name) => !(name in beforeProperties)).sort()) {
    if (afterRequired.has(name)) {
      addedRequiredProperty = true;
      continue;
    }
    changes.push(makeChange(
      'addition', 'tools', `${path}.properties.${name}`, `${toolName} added optional input ${name}`,
      'This additive optional field is compatible with existing callers.'
    ));
  }
  for (const name of Object.keys(beforeProperties).filter((name) => !(name in afterProperties)).sort()) {
    changes.push(makeChange(
      'removal', 'tools', `${path}.properties.${name}`, `${toolName} removed input ${name}`,
      'Callers that still send this input may fail validation.', true
    ));
  }
  for (const name of Object.keys(beforeProperties).filter((name) => name in afterProperties).sort()) {
    changes.push(...schemaChanges(
      beforeProperties[name], afterProperties[name], toolName, `${path}.properties.${name}`
    ));
  }
  if (changes.length > propertiesChangeStart || addedRequiredProperty) {
    reportedHandledKeys.add('properties');
  }

  const beforeEnum = Array.isArray(before.enum) ? before.enum : undefined;
  const afterEnum = Array.isArray(after.enum) ? after.enum : undefined;
  const enumChangeStart = changes.length;
  if (beforeEnum && afterEnum && !same(beforeEnum, afterEnum)) {
    const removed = beforeEnum.filter((value) => !afterEnum.some((candidate) => same(candidate, value)));
    const added = afterEnum.filter((value) => !beforeEnum.some((candidate) => same(candidate, value)));
    if (removed.length) {
      changes.push(makeChange(
        'breaking', 'tools', `${path}.enum`, `${toolName} no longer accepts some values`,
        `Removed allowed values: ${removed.map(display).join(', ')}.`
      ));
    }
    if (added.length) {
      changes.push(makeChange(
        'addition', 'tools', `${path}.enum`, `${toolName} accepts additional values`,
        `Added allowed values: ${added.map(display).join(', ')}.`
      ));
    }
    if (removed.length === 0 && added.length === 0) {
      changes.push(makeChange(
        'unknown', 'tools', `${path}.enum`, `${toolName} enum representation changed`,
        'The enum changed without an identifiable addition or removal.'
      ));
    }
  } else if (!beforeEnum && afterEnum) {
    changes.push(makeChange(
      'breaking', 'tools', `${path}.enum`, `${toolName} now restricts accepted values`,
      `The previously unrestricted input now accepts only: ${afterEnum.map(display).join(', ') || 'no values'}.`
    ));
  } else if (beforeEnum && !afterEnum && !('enum' in after)) {
    changes.push(makeChange(
      'change', 'tools', `${path}.enum`, `${toolName} no longer restricts accepted values`,
      'The input contract was relaxed from an explicit enum to unrestricted values.'
    ));
  } else if (!same(before.enum, after.enum)) {
    changes.push(makeChange(
      'unknown', 'tools', `${path}.enum`, `${toolName} enum could not be compared`,
      'At least one enum declaration is not an array of literal values.'
    ));
  }
  if (changes.length > enumChangeStart) reportedHandledKeys.add('enum');

  const additionalPropertiesChangeStart = changes.length;
  if (before.additionalProperties !== false && after.additionalProperties === false) {
    changes.push(makeChange(
      'breaking', 'tools', `${path}.additionalProperties`, `${toolName} stopped accepting extra inputs`,
      'Callers sending undeclared inputs may now fail validation.'
    ));
  } else if (before.additionalProperties === false && after.additionalProperties !== false) {
    changes.push(makeChange(
      'change', 'tools', `${path}.additionalProperties`, `${toolName} now accepts extra inputs`,
      'The input contract was relaxed.'
    ));
  }
  if (changes.length > additionalPropertiesChangeStart) {
    reportedHandledKeys.add('additionalProperties');
  }

  const itemsChangeStart = changes.length;
  if ('items' in before || 'items' in after) {
    changes.push(...schemaChanges(before.items, after.items, toolName, `${path}.items`));
  }
  if (changes.length > itemsChangeStart) reportedHandledKeys.add('items');

  const handledKeys = new Set(['type', 'required', 'properties', 'enum', 'additionalProperties', 'items']);
  for (const key of handledKeys) {
    if (same(before[key], after[key]) || reportedHandledKeys.has(key)) continue;
    changes.push(makeChange(
      'unknown', 'tools', `${path}.${key}`, `${toolName} schema constraint changed`,
      `${key} changed, but the values could not be compared reliably.`
    ));
  }
  const remainingKeys = new Set([
    ...Object.keys(before).filter((key) => !handledKeys.has(key)),
    ...Object.keys(after).filter((key) => !handledKeys.has(key)),
  ]);
  for (const key of [...remainingKeys].sort()) {
    if (same(before[key], after[key])) continue;
    const cosmetic = key === 'title' || key === 'description' || key === 'examples' || key === 'default';
    changes.push(makeChange(
      cosmetic ? 'change' : 'unknown', 'tools', `${path}.${key}`,
      cosmetic ? `${toolName} input guidance changed` : `${toolName} schema constraint changed`,
      cosmetic
        ? `${key} changed without altering a known structural compatibility rule.`
        : `${key} changed; compatibility cannot be classified deterministically.`
    ));
  }

  return changes;
};

const compareTools = (before: PublicReport, after: PublicReport): ReportDiffChange[] => {
  const beforeSet = before.toolSurfaceAnalysis?.toolDefinitions;
  const afterSet = after.toolSurfaceAnalysis?.toolDefinitions;
  if (beforeSet?.status !== 'complete' || afterSet?.status !== 'complete') {
    const fingerprintsMatch = before.toolSurfaceAnalysis?.fingerprint.value
      && before.toolSurfaceAnalysis.fingerprint.value === after.toolSurfaceAnalysis?.fingerprint.value;
    return fingerprintsMatch ? [] : [makeChange(
      'unknown', 'tools', 'toolSurfaceAnalysis.toolDefinitions',
      'Tool contracts could not be compared completely',
      'One or both snapshots contain unavailable or bounded tool definitions.'
    )];
  }

  const beforeTools = new Map(beforeSet.tools.map((tool) => [tool.name, tool]));
  const afterTools = new Map(afterSet.tools.map((tool) => [tool.name, tool]));
  const changes: ReportDiffChange[] = [];
  for (const name of [...afterTools.keys()].filter((name) => !beforeTools.has(name)).sort()) {
    changes.push(makeChange('addition', 'tools', `tools.${name}`, `Tool added: ${name}`, 'A new tool is available.'));
  }
  for (const name of [...beforeTools.keys()].filter((name) => !afterTools.has(name)).sort()) {
    changes.push(makeChange(
      'removal', 'tools', `tools.${name}`, `Tool removed: ${name}`,
      'Clients that call this tool will break.', true
    ));
  }
  for (const name of [...beforeTools.keys()].filter((name) => afterTools.has(name)).sort()) {
    const left = beforeTools.get(name)!;
    const right = afterTools.get(name)!;
    if (left.description !== right.description) {
      changes.push(makeChange(
        'change', 'tools', `tools.${name}.description`, `${name} description changed`,
        'Tool guidance changed without a structural schema change.'
      ));
    }
    changes.push(...schemaChanges(left.inputSchema, right.inputSchema, name));
  }
  return changes;
};

const compareScalar = (
  changes: ReportDiffChange[],
  before: unknown,
  after: unknown,
  options: Omit<ReportDiffChange, 'detail' | 'classification' | 'breaking'> & {
    classification: ReportDiffClassification;
    detail?: string;
    breaking?: boolean;
  }
): void => {
  if (same(before, after)) return;
  changes.push(makeChange(
    options.classification, options.category, options.path, options.title,
    options.detail || `Changed from ${display(before)} to ${display(after)}.`,
    options.breaking
  ));
};

const metadataByOAuthStep = (report: PublicReport): Map<string, unknown> => new Map(
  (report.oauthTrace?.events || [])
    .filter((event) => [
      'protected_resource_metadata',
      'authorization_server_metadata',
      'cimd',
      'dynamic_client_registration',
      'pkce',
    ].includes(event.type))
    .map((event) => [event.type, {
      outcome: event.outcome,
      metadata: event.response?.metadata,
    }])
);

const OAUTH_METADATA_KEYS = new Set([
  'authorizationSchemes',
  'authorizationServer',
  'authorizationServers',
  'authorizationEndpoint',
  'issuer',
  'requiredMethod',
  'resource',
  'scopesSupported',
  'supportedGrantTypes',
  'supportedMethods',
  'tokenEndpoint',
]);

const securityMetadata = (report: PublicReport): Map<string, unknown> => {
  const metadata = new Map<string, unknown>();
  for (const section of report.sections) {
    for (const evidence of section.evidence) {
      if (!isRecord(evidence.metadata)) continue;
      for (const [key, value] of Object.entries(evidence.metadata)) {
        if (OAUTH_METADATA_KEYS.has(key)) metadata.set(key, value);
      }
    }
  }
  return metadata;
};

const compareOAuth = (before: PublicReport, after: PublicReport): ReportDiffChange[] => {
  const changes: ReportDiffChange[] = [];
  if (before.outcome.status !== 'authorization-required' && after.outcome.status === 'authorization-required') {
    changes.push(makeChange(
      'breaking', 'authentication', 'outcome.status', 'Server now requires authorization',
      'A previously usable evaluation is now blocked by an authorization prerequisite.'
    ));
  } else if (before.outcome.status === 'authorization-required' && after.outcome.status !== 'authorization-required') {
    changes.push(makeChange(
      'change', 'authentication', 'outcome.status', 'Authorization prerequisite cleared',
      'The latest run progressed beyond the prior authorization gate.'
    ));
  }

  const beforeSteps = metadataByOAuthStep(before);
  const afterSteps = metadataByOAuthStep(after);
  for (const type of [...new Set([...beforeSteps.keys(), ...afterSteps.keys()])].sort()) {
    const left = beforeSteps.get(type);
    const right = afterSteps.get(type);
    if (same(left, right)) continue;
    if (left === undefined || right === undefined) {
      changes.push(makeChange(
        left === undefined ? 'addition' : 'risk', 'authentication', `oauth.${type}`,
        left === undefined ? `OAuth observation added: ${type}` : `OAuth observation missing: ${type}`,
        left === undefined
          ? 'The latest snapshot includes additional OAuth evidence.'
          : 'Previously observed OAuth metadata was not available in the latest snapshot.',
        left !== undefined
      ));
    } else {
      changes.push(makeChange(
        'risk', 'authentication', `oauth.${type}`, `OAuth metadata changed: ${type}`,
        'The discovery outcome or redacted metadata differs from the previous snapshot.'
      ));
    }
  }
  const beforeMetadata = securityMetadata(before);
  const afterMetadata = securityMetadata(after);
  for (const key of [...new Set([...beforeMetadata.keys(), ...afterMetadata.keys()])].sort()) {
    const left = beforeMetadata.get(key);
    const right = afterMetadata.get(key);
    if (same(left, right)) continue;
    const removed = beforeMetadata.has(key) && !afterMetadata.has(key);
    changes.push(makeChange(
      removed ? 'risk' : !beforeMetadata.has(key) ? 'addition' : 'risk',
      'authentication', `oauth.metadata.${key}`,
      removed ? `OAuth metadata removed: ${key}`
        : !beforeMetadata.has(key) ? `OAuth metadata added: ${key}` : `OAuth metadata changed: ${key}`,
      removed
        ? 'Previously published authentication metadata was not observed in the latest report.'
        : `Changed from ${display(left)} to ${display(right)}.`,
      removed
    ));
  }
  return changes;
};

const capabilityMap = (report: PublicReport): Map<string, unknown> => {
  const map = new Map<string, unknown>();
  const section = report.sections.find((candidate) => candidate.id === 'capabilities');
  for (const evidence of section?.evidence || []) {
    if (!isRecord(evidence.metadata) || typeof evidence.metadata.method !== 'string') continue;
    map.set(evidence.metadata.method, {
      status: section?.status,
      itemCount: evidence.metadata.itemCount,
      outcome: evidence.metadata.outcome,
    });
  }
  return map;
};

const compareCapabilities = (before: PublicReport, after: PublicReport): ReportDiffChange[] => {
  const changes: ReportDiffChange[] = [];
  const left = capabilityMap(before);
  const right = capabilityMap(after);
  for (const method of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (same(left.get(method), right.get(method))) continue;
    const removed = left.has(method) && !right.has(method);
    changes.push(makeChange(
      removed ? 'removal' : !left.has(method) ? 'addition' : 'change',
      'capabilities', `capabilities.${method}`,
      removed ? `Capability no longer observed: ${method}`
        : !left.has(method) ? `Capability observed: ${method}` : `Capability result changed: ${method}`,
      removed ? 'A previously observed discovery capability is absent.' : 'The observed capability evidence changed.',
      removed
    ));
  }
  return changes;
};

const severityRank: Record<string, number> = {
  info: 0, low: 1, medium: 2, warning: 2, unknown: 2, high: 3, error: 3, critical: 4,
};

const findingMap = (report: PublicReport): Map<string, { severity: string; title: string }> => {
  const findings = new Map<string, { severity: string; title: string }>();
  for (const priority of report.releaseDecision?.priorities || []) {
    findings.set(`release:${priority.id}`, { severity: priority.severity, title: priority.title });
  }
  const buckets = report.toolSurfaceAnalysis?.findings;
  if (buckets) {
    for (const [severity, values] of Object.entries(buckets)) {
      for (const finding of values) {
        findings.set(`tool:${finding.id}`, { severity, title: finding.title });
      }
    }
  }
  for (const assessment of Object.values(report.compatibility?.assessments || {})) {
    for (const finding of assessment.findings || []) {
      if (finding.outcome === 'pass') continue;
      findings.set(`compatibility:${assessment.profileId}:${finding.ruleId}`, {
        severity: finding.severity,
        title: finding.summary,
      });
    }
  }
  return findings;
};

const compareFindings = (before: PublicReport, after: PublicReport): ReportDiffChange[] => {
  const changes: ReportDiffChange[] = [];
  const decisionRank: Record<string, number> = {
    ready: 0, review: 1, unknown: 2, 'authorization-required': 3, blocked: 4,
  };
  const oldDecision = before.releaseDecision?.status;
  const newDecision = after.releaseDecision?.status;
  if (oldDecision && newDecision && oldDecision !== newDecision) {
    const worsened = decisionRank[newDecision] > decisionRank[oldDecision];
    changes.push(makeChange(
      worsened ? 'risk' : 'change', 'findings', 'releaseDecision.status',
      `Release decision changed from ${oldDecision} to ${newDecision}`,
      worsened
        ? 'The aggregate release-readiness result regressed.'
        : 'The aggregate release-readiness result improved.'
    ));
  } else if (oldDecision !== newDecision) {
    changes.push(makeChange(
      'unknown', 'findings', 'releaseDecision.status', 'Release decisions are not comparable',
      'One snapshot does not include a release-readiness decision.'
    ));
  }
  const left = findingMap(before);
  const right = findingMap(after);
  for (const id of [...right.keys()].filter((key) => !left.has(key)).sort()) {
    const finding = right.get(id)!;
    changes.push(makeChange(
      'risk', 'findings', `findings.${id}`, `New finding: ${finding.title}`,
      `The latest report added a ${finding.severity} finding.`
    ));
  }
  for (const id of [...left.keys()].filter((key) => !right.has(key)).sort()) {
    changes.push(makeChange(
      'removal', 'findings', `findings.${id}`, `Finding resolved: ${left.get(id)!.title}`,
      'This finding is absent from the latest report.'
    ));
  }
  for (const id of [...left.keys()].filter((key) => right.has(key)).sort()) {
    const oldFinding = left.get(id)!;
    const newFinding = right.get(id)!;
    if (oldFinding.severity === newFinding.severity) continue;
    const worsened = (severityRank[newFinding.severity] || 0) > (severityRank[oldFinding.severity] || 0);
    changes.push(makeChange(
      worsened ? 'risk' : 'change', 'findings', `findings.${id}.severity`,
      `${newFinding.title} severity ${worsened ? 'increased' : 'decreased'}`,
      `Severity changed from ${oldFinding.severity} to ${newFinding.severity}.`
    ));
  }
  return changes;
};

const totalLatency = (report: PublicReport): number | undefined => (
  report.timings?.connectionSetupMs ?? report.timings?.negotiationMs
);

const checkLatencies = (report: PublicReport): Map<string, number> => new Map(
  (report.timings?.checks || []).map((check) => [check.name, check.durationMs])
);

export const diffPublicReports = (before: PublicReport, after: PublicReport): ReportDiff => {
  const changes: ReportDiffChange[] = [
    ...compareOAuth(before, after),
    ...compareTools(before, after),
    ...compareCapabilities(before, after),
    ...compareFindings(before, after),
  ];

  const beforeTransport = before.transport?.type;
  const afterTransport = after.transport?.type;
  const transportRegressed = beforeTransport === 'streamable-http'
    && afterTransport === 'legacy-sse';
  const transportUpgraded = beforeTransport === 'legacy-sse'
    && afterTransport === 'streamable-http';
  compareScalar(changes, before.transport?.type, after.transport?.type, {
    classification: transportRegressed ? 'breaking' : transportUpgraded ? 'change' : 'unknown',
    category: 'transport', path: 'transport.type',
    title: 'Transport changed',
    detail: transportRegressed
      ? 'Streamable HTTP was replaced by the legacy SSE transport.'
      : transportUpgraded
        ? 'Legacy SSE was replaced by Streamable HTTP.'
        : 'One or both snapshots do not contain a recognized, comparable transport.',
    breaking: transportRegressed,
  });

  const protocolRegressed = before.protocol?.era === 'modern' && after.protocol?.era === 'legacy';
  compareScalar(changes, before.protocol?.era, after.protocol?.era, {
    classification: protocolRegressed ? 'breaking' : 'change', category: 'protocol',
    path: 'protocol.era', title: 'Protocol lifecycle changed', breaking: protocolRegressed,
  });
  compareScalar(changes, before.protocol?.version, after.protocol?.version, {
    classification: 'change', category: 'protocol', path: 'protocol.version',
    title: 'Protocol version changed', breaking: false,
  });
  if (before.provenance.route === 'direct' && after.provenance.route === 'authenticated-proxy') {
    changes.push(makeChange(
      'breaking', 'transport', 'provenance.route', 'Direct browser access regressed',
      'The latest run required the authenticated proxy after the previous run connected directly.'
    ));
  } else {
    compareScalar(changes, before.provenance.route, after.provenance.route, {
      classification: 'change', category: 'transport', path: 'provenance.route',
      title: 'Connection route changed', breaking: false,
    });
  }

  const beforeLatency = totalLatency(before);
  const afterLatency = totalLatency(after);
  if (beforeLatency !== undefined && afterLatency !== undefined && beforeLatency !== afterLatency) {
    const regression = afterLatency > beforeLatency + 100 && afterLatency > beforeLatency * 1.25;
    changes.push(makeChange(
      regression ? 'risk' : 'change', 'latency', 'timings.connection',
      regression ? 'Connection latency regressed' : 'Connection latency changed',
      `Changed from ${beforeLatency} ms to ${afterLatency} ms.`
    ));
  } else if (beforeLatency !== afterLatency) {
    changes.push(makeChange(
      'unknown', 'latency', 'timings.connection', 'Latency could not be compared',
      'One snapshot does not contain a comparable connection timing.'
    ));
  }

  const beforeChecks = checkLatencies(before);
  const afterChecks = checkLatencies(after);
  for (const name of [...new Set([...beforeChecks.keys(), ...afterChecks.keys()])].sort()) {
    const oldDuration = beforeChecks.get(name);
    const newDuration = afterChecks.get(name);
    if (oldDuration === newDuration) continue;
    if (oldDuration === undefined || newDuration === undefined) {
      changes.push(makeChange(
        'unknown', 'latency', `timings.checks.${name}`, `${name} latency is not comparable`,
        'One snapshot does not contain this check timing.'
      ));
      continue;
    }
    const regression = newDuration > oldDuration + 100 && newDuration > oldDuration * 1.25;
    changes.push(makeChange(
      regression ? 'risk' : 'change', 'latency', `timings.checks.${name}`,
      regression ? `${name} latency regressed` : `${name} latency changed`,
      `Changed from ${oldDuration} ms to ${newDuration} ms.`
    ));
  }

  if (before.score && after.score && before.score.percentage !== after.score.percentage) {
    changes.push(makeChange(
      'change', 'score', 'score.percentage', 'Evaluation score changed',
      `Changed from ${Math.round(before.score.percentage)}% to ${Math.round(after.score.percentage)}%.`
    ));
  } else if (Boolean(before.score) !== Boolean(after.score)) {
    changes.push(makeChange(
      'unknown', 'score', 'score', 'Scores are not comparable',
      'One run was scored and the other was not.'
    ));
  }

  changes.sort((left, right) => (
    Number(right.breaking) - Number(left.breaking)
    || classificationRank[left.classification] - classificationRank[right.classification]
    || categoryRank[left.category] - categoryRank[right.category]
    || left.path.localeCompare(right.path)
    || left.title.localeCompare(right.title)
  ));

  const counts: ReportDiff['counts'] = {
    breaking: 0, removal: 0, risk: 0, unknown: 0, addition: 0, change: 0,
  };
  changes.forEach((change) => { counts[change.classification] += 1; });
  return {
    beforeGeneratedAt: before.generatedAt,
    afterGeneratedAt: after.generatedAt,
    changes,
    counts,
    hasBreakingChanges: changes.some((change) => change.breaking),
  };
};
