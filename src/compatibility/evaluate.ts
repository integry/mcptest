import { HOST_PROFILE_LIST, HOST_PROFILES } from './profiles';
import {
  COMPATIBILITY_SCHEMA_VERSION,
  type CompatibilityConditionV1,
  type CompatibilityEvidenceV1,
  type CompatibilityFactPath,
  type CompatibilityFindingV1,
  type CompatibilityMatrixV1,
  type CompatibilityStatus,
  type HostCompatibilityAssessmentV1,
  type HostId,
  type HostProfileV1,
  type ObservedServerFactsV1,
  type ObservedValueV1,
  type RuleResultDefinitionV1,
} from './types';

type TruthValue = true | false | 'unknown';

const isObservedValue = (value: unknown): value is ObservedValueV1<unknown> => (
  Boolean(value)
  && typeof value === 'object'
  && 'value' in (value as Record<string, unknown>)
  && Array.isArray((value as { evidence?: unknown }).evidence)
);

const getFact = (
  facts: ObservedServerFactsV1,
  path: CompatibilityFactPath
): ObservedValueV1<unknown> => {
  let current: unknown = facts;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') {
      throw new Error(`Compatibility fact path does not exist: ${path}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (!isObservedValue(current)) {
    throw new Error(`Compatibility fact path is not an observed value: ${path}`);
  }
  return current;
};

const scalarEquals = (left: unknown, right: string | boolean): boolean => left === right;

export const evaluateCondition = (
  condition: CompatibilityConditionV1,
  facts: ObservedServerFactsV1
): TruthValue => {
  if ('all' in condition) {
    let sawUnknown = false;
    for (const child of condition.all) {
      const outcome = evaluateCondition(child, facts);
      if (outcome === false) return false;
      if (outcome === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? 'unknown' : true;
  }
  if ('any' in condition) {
    let sawUnknown = false;
    for (const child of condition.any) {
      const outcome = evaluateCondition(child, facts);
      if (outcome === true) return true;
      if (outcome === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? 'unknown' : false;
  }
  if ('not' in condition) {
    const outcome = evaluateCondition(condition.not, facts);
    return outcome === 'unknown' ? outcome : !outcome;
  }

  const observed = getFact(facts, condition.fact);
  if (observed.value === 'unknown') return 'unknown';

  switch (condition.operator) {
    case 'equals':
      return scalarEquals(observed.value, condition.value);
    case 'not-equals':
      return !scalarEquals(observed.value, condition.value);
    case 'one-of':
      return condition.value.some((candidate) => scalarEquals(observed.value, candidate));
    case 'contains-any': {
      const values: readonly unknown[] | undefined = Array.isArray(observed.value)
        ? observed.value
        : undefined;
      return Boolean(values && condition.value.some((candidate) => values.includes(candidate)));
    }
    case 'contains-all': {
      const values: readonly unknown[] | undefined = Array.isArray(observed.value)
        ? observed.value
        : undefined;
      return Boolean(values && condition.value.every((candidate) => values.includes(candidate)));
    }
  }
};

const factPathsInCondition = (condition: CompatibilityConditionV1): CompatibilityFactPath[] => {
  if ('fact' in condition) return [condition.fact];
  if ('not' in condition) return factPathsInCondition(condition.not);
  const children = 'all' in condition ? condition.all : condition.any;
  return children.flatMap(factPathsInCondition);
};

const evidenceKey = (item: CompatibilityEvidenceV1): string => (
  `${item.source}\u0000${item.location || ''}\u0000${item.description}`
);

const collectEvidence = (
  profile: HostProfileV1,
  rule: HostProfileV1['rules'][number],
  facts: ObservedServerFactsV1
): readonly CompatibilityEvidenceV1[] => {
  const paths = new Set<CompatibilityFactPath>([
    ...rule.evidenceFacts,
    ...factPathsInCondition(rule.passWhen),
    ...(rule.appliesWhen ? factPathsInCondition(rule.appliesWhen) : []),
    ...(rule.unknownWhen ? factPathsInCondition(rule.unknownWhen) : []),
  ]);
  const serverEvidence = [...paths].flatMap((path) => getFact(facts, path).evidence);
  const assumptionEvidence: CompatibilityEvidenceV1[] = rule.assumptionSourceIds.flatMap((sourceId) => {
    const assumption = profile.assumptions.find(({ id }) => id === sourceId);
    if (!assumption) return [];
    return [{
      schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
      source: 'host-profile',
      description: `${assumption.title}: ${assumption.notes}`,
      location: assumption.url,
    }];
  });

  return [...new Map(
    [...serverEvidence, ...assumptionEvidence].map((item) => [evidenceKey(item), item])
  ).values()];
};

const findingFrom = (
  profile: HostProfileV1,
  rule: HostProfileV1['rules'][number],
  definition: RuleResultDefinitionV1,
  facts: ObservedServerFactsV1
): CompatibilityFindingV1 => ({
  schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
  ruleId: rule.id,
  scope: rule.scope,
  outcome: definition.outcome,
  severity: definition.severity,
  summary: definition.summary,
  detail: definition.detail,
  evidence: collectEvidence(profile, rule, facts),
  ...(definition.remediation ? { remediation: definition.remediation } : {}),
});

const getStatus = (findings: readonly CompatibilityFindingV1[]): CompatibilityStatus => {
  if (findings.some(({ outcome }) => outcome === 'fail')) return 'incompatible';
  if (findings.some(({ outcome }) => outcome === 'unknown')) return 'unknown';
  if (findings.some(({ outcome }) => outcome === 'caveat')) return 'compatible-with-caveats';
  return 'compatible';
};

const assertSupportedSchema = (
  value: { schemaVersion: string },
  label: string
): void => {
  if (value.schemaVersion !== COMPATIBILITY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported ${label} schema version ${value.schemaVersion}; expected ${COMPATIBILITY_SCHEMA_VERSION}.`
    );
  }
};

/**
 * Pure compatibility evaluation. The evaluator reads only supplied facts and
 * profile rules; it performs no discovery, fetch, storage, or clock access.
 */
export const assessHostCompatibility = (
  facts: ObservedServerFactsV1,
  profileOrId: HostProfileV1 | HostId
): HostCompatibilityAssessmentV1 => {
  const profile = typeof profileOrId === 'string' ? HOST_PROFILES[profileOrId] : profileOrId;
  assertSupportedSchema(facts, 'observed facts');
  assertSupportedSchema(profile, 'host profile');

  const findings: CompatibilityFindingV1[] = [];
  for (const rule of profile.rules) {
    assertSupportedSchema(rule, `rule ${rule.id}`);
    // If applicability itself is unknown, another foundational rule (for
    // example authorization.scheme) owns that uncertainty. Optional branches
    // must not multiply unknowns or fail closed.
    if (rule.appliesWhen && evaluateCondition(rule.appliesWhen, facts) !== true) continue;

    const explicitlyUnknown = rule.unknownWhen
      && evaluateCondition(rule.unknownWhen, facts) === true;
    const outcome = explicitlyUnknown ? 'unknown' : evaluateCondition(rule.passWhen, facts);
    const definition = outcome === true
      ? rule.onPass
      : outcome === false
        ? rule.onFail
        : rule.onUnknown;
    findings.push(findingFrom(profile, rule, definition, facts));
  }

  return {
    schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
    profileId: profile.id,
    profileVersion: profile.profileVersion,
    status: getStatus(findings),
    findings,
  };
};

export const assessCompatibilityMatrix = (
  facts: ObservedServerFactsV1,
  profiles: readonly HostProfileV1[] = HOST_PROFILE_LIST
): CompatibilityMatrixV1 => {
  const entries = profiles.map((profile) => [
    profile.id,
    assessHostCompatibility(facts, profile),
  ] as const);
  return {
    schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
    assessments: Object.fromEntries(entries) as Record<HostId, HostCompatibilityAssessmentV1>,
  };
};
