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

const JSON_SCHEMA_TYPES = new Set([
  'array', 'boolean', 'integer', 'null', 'number', 'object', 'string',
]);

type NormalizedSchemaType =
  | { status: 'unconstrained' }
  | { status: 'valid'; values: Set<string> }
  | { status: 'malformed' };

const schemaType = (schema: JsonRecord): NormalizedSchemaType => {
  if (!Object.prototype.hasOwnProperty.call(schema, 'type')) return { status: 'unconstrained' };
  const value = schema.type;
  if (typeof value === 'string' && JSON_SCHEMA_TYPES.has(value)) {
    return { status: 'valid', values: new Set([value]) };
  }
  if (Array.isArray(value)
      && value.length > 0
      && value.every((item) => typeof item === 'string' && JSON_SCHEMA_TYPES.has(item))
      && new Set(value).size === value.length) {
    return { status: 'valid', values: new Set(value) };
  }
  return { status: 'malformed' };
};

const sameSet = <T>(left: Set<T>, right: Set<T>): boolean => (
  left.size === right.size && [...left].every((value) => right.has(value))
);

type NormalizedSchemaKeyword<T> =
  | { status: 'absent' }
  | { status: 'valid'; value: T }
  | { status: 'malformed' };

const requiredKeyword = (
  schema: JsonRecord
): NormalizedSchemaKeyword<Set<string>> => {
  if (!Object.prototype.hasOwnProperty.call(schema, 'required')) return { status: 'absent' };
  const value = schema.required;
  if (!Array.isArray(value)
      || !value.every((item) => typeof item === 'string')
      || new Set(value).size !== value.length) {
    return { status: 'malformed' };
  }
  return { status: 'valid', value: new Set(value) };
};

const propertiesKeyword = (
  schema: JsonRecord
): NormalizedSchemaKeyword<JsonRecord> => {
  if (!Object.prototype.hasOwnProperty.call(schema, 'properties')) return { status: 'absent' };
  return isRecord(schema.properties)
    ? { status: 'valid', value: schema.properties }
    : { status: 'malformed' };
};

const keywordSet = (keyword: NormalizedSchemaKeyword<Set<string>>): Set<string> => (
  keyword.status === 'valid' ? keyword.value : new Set()
);

const keywordRecord = (keyword: NormalizedSchemaKeyword<JsonRecord>): JsonRecord => (
  keyword.status === 'valid' ? keyword.value : {}
);

const hasOwn = (value: JsonRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const sameTypeKeyword = (
  leftSchema: JsonRecord,
  rightSchema: JsonRecord,
  left = schemaType(leftSchema),
  right = schemaType(rightSchema)
): boolean => {
  if (left.status !== right.status) return false;
  if (left.status === 'valid' && right.status === 'valid') {
    return sameSet(left.values, right.values);
  }
  if (left.status === 'malformed') return same(leftSchema.type, rightSchema.type);
  return true;
};

const displaySchemaType = (type: NormalizedSchemaType): string => (
  type.status === 'unconstrained'
    ? 'unconstrained'
    : type.status === 'malformed'
      ? 'malformed'
      : display([...type.values].sort())
);

const sameRequiredKeyword = (leftSchema: JsonRecord, rightSchema: JsonRecord): boolean => {
  const left = requiredKeyword(leftSchema);
  const right = requiredKeyword(rightSchema);
  if (left.status === 'malformed' || right.status === 'malformed') {
    return left.status === right.status && same(leftSchema.required, rightSchema.required);
  }
  return sameSet(keywordSet(left), keywordSet(right));
};

const samePropertiesKeyword = (leftSchema: JsonRecord, rightSchema: JsonRecord): boolean => {
  const left = propertiesKeyword(leftSchema);
  const right = propertiesKeyword(rightSchema);
  if (left.status === 'malformed' || right.status === 'malformed') {
    return left.status === right.status && same(leftSchema.properties, rightSchema.properties);
  }
  return same(keywordRecord(left), keywordRecord(right));
};

const acceptedTypeCoveredBy = (before: string, after: Set<string>): boolean => (
  after.has(before) || (before === 'integer' && after.has('number'))
);

const sameEnumKeyword = (left: unknown, right: unknown): boolean => {
  if (!Array.isArray(left) || !Array.isArray(right)) return same(left, right);
  const normalizedLeft = left.map(stableString).sort();
  const normalizedRight = right.map(stableString).sort();
  return same(normalizedLeft, normalizedRight);
};

const sameAdditionalPropertiesKeyword = (left: unknown, right: unknown): boolean => same(
  left === undefined ? true : left,
  right === undefined ? true : right
);

type SchemaAcceptance =
  | { status: 'reject' }
  | { status: 'schema'; schema: JsonRecord }
  | { status: 'malformed' };

type SchemaAcceptanceRelation = 'equal' | 'narrowed' | 'widened' | 'unknown';

const schemaAcceptance = (value: unknown): SchemaAcceptance => {
  if (value === false) return { status: 'reject' };
  if (value === true) return { status: 'schema', schema: {} };
  if (isRecord(value)) return { status: 'schema', schema: value };
  return { status: 'malformed' };
};

const additionalPropertiesAcceptance = (schema: JsonRecord): SchemaAcceptance => (
  schemaAcceptance(hasOwn(schema, 'additionalProperties') ? schema.additionalProperties : true)
);

function compareSchemaAcceptance(beforeValue: unknown, afterValue: unknown): SchemaAcceptanceRelation {
  const before = schemaAcceptance(beforeValue);
  const after = schemaAcceptance(afterValue);
  if (before.status === 'malformed' || after.status === 'malformed') return 'unknown';
  if (before.status === 'reject') return after.status === 'reject' ? 'equal' : 'widened';
  if (after.status === 'reject') return 'narrowed';
  if (same(before.schema, after.schema)) return 'equal';

  const changes = schemaChanges(before.schema, after.schema, 'input', 'input');
  if (changes.some((change) => change.breaking)) return 'narrowed';
  if (changes.some((change) => change.classification === 'unknown')) return 'unknown';
  return 'widened';
}

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
  if (!sameTypeKeyword(before, after, beforeType, afterType)) {
    const malformed = beforeType.status === 'malformed' || afterType.status === 'malformed';
    const removedTypes = beforeType.status === 'valid' && afterType.status === 'valid'
      ? [...beforeType.values]
        .filter((value) => !acceptedTypeCoveredBy(value, afterType.values))
        .sort()
      : [];
    const breaking = !malformed && (
      (beforeType.status === 'unconstrained' && afterType.status === 'valid')
      || removedTypes.length > 0
    );
    changes.push(makeChange(
      malformed ? 'unknown' : breaking ? 'breaking' : 'change',
      'tools', `${path}.type`,
      malformed ? `${toolName} input type could not be compared` : `${toolName} input type changed`,
      malformed
        ? 'At least one type declaration is malformed.'
        : `Accepted types changed from ${displaySchemaType(beforeType)} to ${displaySchemaType(afterType)}.`
    ));
  }
  if (changes.length > typeChangeStart) reportedHandledKeys.add('type');

  const beforeRequiredKeyword = requiredKeyword(before);
  const afterRequiredKeyword = requiredKeyword(after);
  const beforeRequired = keywordSet(beforeRequiredKeyword);
  const afterRequired = keywordSet(afterRequiredKeyword);
  if (!sameRequiredKeyword(before, after)) {
    if (beforeRequiredKeyword.status === 'malformed'
        || afterRequiredKeyword.status === 'malformed') {
      changes.push(makeChange(
        'unknown', 'tools', `${path}.required`, `${toolName} required inputs could not be compared`,
        'At least one required declaration is malformed.'
      ));
    } else {
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
    }
  }
  reportedHandledKeys.add('required');

  const beforePropertiesKeyword = propertiesKeyword(before);
  const afterPropertiesKeyword = propertiesKeyword(after);
  const beforeProperties = keywordRecord(beforePropertiesKeyword);
  const afterProperties = keywordRecord(afterPropertiesKeyword);
  const beforeAdditionalProperties = additionalPropertiesAcceptance(before);
  const afterAdditionalProperties = additionalPropertiesAcceptance(after);
  if (!samePropertiesKeyword(before, after)) {
    if (beforePropertiesKeyword.status === 'malformed'
        || afterPropertiesKeyword.status === 'malformed') {
      changes.push(makeChange(
        'unknown', 'tools', `${path}.properties`, `${toolName} input properties could not be compared`,
        'At least one properties declaration is malformed.'
      ));
    } else {
      for (const name of Object.keys(afterProperties).filter((name) => !hasOwn(beforeProperties, name)).sort()) {
        if (afterRequiredKeyword.status === 'malformed' || afterRequired.has(name)) continue;
        const relation = beforeAdditionalProperties.status === 'reject'
          ? 'widened'
          : compareSchemaAcceptance(
            beforeAdditionalProperties.status === 'schema'
              ? beforeAdditionalProperties.schema
              : undefined,
            afterProperties[name]
          );
        changes.push(makeChange(
          relation === 'narrowed' ? 'breaking' : relation === 'unknown' ? 'unknown' : 'addition',
          'tools', `${path}.properties.${name}`,
          relation === 'narrowed'
            ? `${toolName} constrained optional input ${name}`
            : relation === 'unknown'
              ? `${toolName} optional input ${name} could not be compared`
              : `${toolName} added optional input ${name}`,
          relation === 'narrowed'
            ? 'Values previously accepted as an extra input may now fail the declared property schema.'
            : relation === 'unknown'
              ? 'The prior extra-property behavior and the declared property schema could not be compared safely.'
              : 'This additive optional field does not reject inputs accepted by the previous schema.'
        ));
      }
      for (const name of Object.keys(beforeProperties).filter((name) => !hasOwn(afterProperties, name)).sort()) {
        const relation = afterAdditionalProperties.status === 'reject'
          ? 'narrowed'
          : compareSchemaAcceptance(
            beforeProperties[name],
            afterAdditionalProperties.status === 'schema'
              ? afterAdditionalProperties.schema
              : undefined
          );
        changes.push(makeChange(
          relation === 'narrowed' ? 'removal' : relation === 'unknown' ? 'unknown' : 'change',
          'tools', `${path}.properties.${name}`,
          relation === 'unknown'
            ? `${toolName} removed input ${name}, but compatibility is unknown`
            : `${toolName} removed input ${name}`,
          relation === 'narrowed'
            ? 'Callers that still send this input may fail validation.'
            : relation === 'unknown'
              ? 'The removed property schema and the latest extra-property behavior could not be compared safely.'
              : 'The input remains accepted through the latest extra-property behavior, so the contract was relaxed.',
          relation === 'narrowed'
        ));
      }
      for (const name of Object.keys(beforeProperties).filter((name) => hasOwn(afterProperties, name)).sort()) {
        changes.push(...schemaChanges(
          beforeProperties[name], afterProperties[name], toolName, `${path}.properties.${name}`
        ));
      }
    }
  }
  reportedHandledKeys.add('properties');

  const beforeEnum = Array.isArray(before.enum) ? before.enum : undefined;
  const afterEnum = Array.isArray(after.enum) ? after.enum : undefined;
  const enumChangeStart = changes.length;
  if (beforeEnum && afterEnum && !sameEnumKeyword(beforeEnum, afterEnum)) {
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
  } else if ((!beforeEnum || !afterEnum) && !same(before.enum, after.enum)) {
    changes.push(makeChange(
      'unknown', 'tools', `${path}.enum`, `${toolName} enum could not be compared`,
      'At least one enum declaration is not an array of literal values.'
    ));
  }
  if (changes.length > enumChangeStart) reportedHandledKeys.add('enum');

  const additionalPropertiesChangeStart = changes.length;
  if (!sameAdditionalPropertiesKeyword(before.additionalProperties, after.additionalProperties)
      && (beforeAdditionalProperties.status === 'malformed'
        || afterAdditionalProperties.status === 'malformed')) {
    changes.push(makeChange(
      'unknown', 'tools', `${path}.additionalProperties`,
      `${toolName} extra-input behavior could not be compared`,
      'At least one additionalProperties declaration is malformed.'
    ));
  } else if (beforeAdditionalProperties.status !== 'reject'
      && afterAdditionalProperties.status === 'reject') {
    changes.push(makeChange(
      'breaking', 'tools', `${path}.additionalProperties`, `${toolName} stopped accepting extra inputs`,
      'Callers sending undeclared inputs may now fail validation.'
    ));
  } else if (beforeAdditionalProperties.status === 'reject'
      && afterAdditionalProperties.status !== 'reject') {
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
    const semanticallyEqual = key === 'type'
      ? sameTypeKeyword(before, after)
      : key === 'required'
      ? sameRequiredKeyword(before, after)
      : key === 'properties'
        ? samePropertiesKeyword(before, after)
      : key === 'enum'
        ? sameEnumKeyword(before[key], after[key])
        : key === 'additionalProperties'
          ? sameAdditionalPropertiesKeyword(before[key], after[key])
          : same(before[key], after[key]);
    if (semanticallyEqual || reportedHandledKeys.has(key)) continue;
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
    return [makeChange(
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

const OAUTH_SET_VALUED_ARRAY_KEYS = new Set([
  'authorizationServers',
  'authorization_servers',
  'bearerMethodsSupported',
  'bearer_methods_supported',
  'codeChallengeMethodsSupported',
  'code_challenge_methods_supported',
  'grantTypesSupported',
  'grant_types_supported',
  'introspectionEndpointAuthMethodsSupported',
  'introspection_endpoint_auth_methods_supported',
  'resourceSigningAlgValuesSupported',
  'resource_signing_alg_values_supported',
  'responseModesSupported',
  'responseTypesSupported',
  'response_modes_supported',
  'response_types_supported',
  'revocationEndpointAuthMethodsSupported',
  'revocation_endpoint_auth_methods_supported',
  'scopesSupported',
  'scopes_supported',
  'supportedGrantTypes',
  'supportedMethods',
  'tokenEndpointAuthMethodsSupported',
  'tokenEndpointAuthSigningAlgValuesSupported',
  'token_endpoint_auth_methods_supported',
  'token_endpoint_auth_signing_alg_values_supported',
  'uiLocalesSupported',
  'ui_locales_supported',
]);

const stableOAuthValue = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    const values = value.map((child) => stableOAuthValue(child));
    return key && OAUTH_SET_VALUED_ARRAY_KEYS.has(key)
      ? values.sort((left, right) => stableString(left).localeCompare(stableString(right)))
      : values;
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([childKey, child]) => [childKey, stableOAuthValue(child, childKey)]));
  }
  return value;
};

const sameOAuthMetadata = (left: unknown, right: unknown): boolean => (
  JSON.stringify(stableOAuthValue(left)) === JSON.stringify(stableOAuthValue(right))
);

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

const hasCompleteRunObservations = (report: PublicReport): boolean => (
  report.outcome.status !== 'partial' && report.outcome.status !== 'failed'
);

const compareOAuth = (before: PublicReport, after: PublicReport): ReportDiffChange[] => {
  const changes: ReportDiffChange[] = [];
  if (before.outcome.status === 'scored' && after.outcome.status === 'authorization-required') {
    changes.push(makeChange(
      'breaking', 'authentication', 'outcome.status', 'Server now requires authorization',
      'A previously usable evaluation is now blocked by an authorization prerequisite.'
    ));
  } else if (before.outcome.status === 'authorization-required' && after.outcome.status === 'scored') {
    changes.push(makeChange(
      'change', 'authentication', 'outcome.status', 'Authorization prerequisite cleared',
      'The latest run progressed beyond the prior authorization gate.'
    ));
  } else if (
    (before.outcome.status === 'authorization-required')
    !== (after.outcome.status === 'authorization-required')
  ) {
    changes.push(makeChange(
      'unknown', 'authentication', 'outcome.status', 'Authorization requirement is not comparable',
      'A partial or failed run did not establish whether the authorization prerequisite changed.'
    ));
  }

  const beforeSteps = metadataByOAuthStep(before);
  const afterSteps = metadataByOAuthStep(after);
  const observationsComparable = hasCompleteRunObservations(before)
    && hasCompleteRunObservations(after);
  for (const type of [...new Set([...beforeSteps.keys(), ...afterSteps.keys()])].sort()) {
    const left = beforeSteps.get(type);
    const right = afterSteps.get(type);
    if (sameOAuthMetadata(left, right)) continue;
    if (!observationsComparable || right === undefined) {
      changes.push(makeChange(
        'unknown', 'authentication', `oauth.${type}`,
        `OAuth observation is not comparable: ${type}`,
        'One run did not establish this OAuth observation.'
      ));
    } else if (left === undefined) {
      changes.push(makeChange(
        'addition', 'authentication', `oauth.${type}`,
        `OAuth observation added: ${type}`,
        'The latest snapshot includes additional OAuth evidence.'
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
    if (sameOAuthMetadata({ [key]: left }, { [key]: right })) continue;
    const removed = beforeMetadata.has(key) && !afterMetadata.has(key);
    if (!observationsComparable) {
      changes.push(makeChange(
        'unknown', 'authentication', `oauth.metadata.${key}`,
        `OAuth metadata is not comparable: ${key}`,
        'A partial or failed run did not establish this authentication metadata.'
      ));
      continue;
    }
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

const capabilityObservation = (report: PublicReport): {
  status: PublicReport['sections'][number]['status'] | undefined;
  values: Map<string, unknown>;
} => {
  const map = new Map<string, unknown>();
  const section = report.sections.find((candidate) => candidate.id === 'capabilities');
  for (const evidence of section?.evidence || []) {
    if (!isRecord(evidence.metadata) || typeof evidence.metadata.method !== 'string') continue;
    map.set(evidence.metadata.method, {
      itemCount: evidence.metadata.itemCount,
      outcome: evidence.metadata.outcome,
    });
  }
  return { status: section?.status, values: map };
};

const compareCapabilities = (before: PublicReport, after: PublicReport): ReportDiffChange[] => {
  const changes: ReportDiffChange[] = [];
  const beforeObservation = capabilityObservation(before);
  const afterObservation = capabilityObservation(after);
  const left = beforeObservation.values;
  const right = afterObservation.values;
  const observationsComparable = beforeObservation.status === 'evaluated'
    && afterObservation.status === 'evaluated';
  for (const method of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (same(left.get(method), right.get(method))) continue;
    if (!observationsComparable) {
      changes.push(makeChange(
        'unknown', 'capabilities', `capabilities.${method}`,
        `Capability is not comparable: ${method}`,
        'One run did not fully evaluate discovery capabilities.'
      ));
      continue;
    }
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

type FindingSource =
  | { kind: 'release'; source: 'Host compatibility' | 'Tool surface' | 'Evaluation' }
  | { kind: 'tool' }
  | { kind: 'compatibility'; profileId: string };

interface FindingObservation {
  severity: string;
  title: string;
  source: FindingSource;
}

const findingMap = (report: PublicReport): Map<string, FindingObservation> => {
  const findings = new Map<string, FindingObservation>();
  for (const priority of report.releaseDecision?.priorities || []) {
    findings.set(`release:${priority.id}`, {
      severity: priority.severity,
      title: priority.title,
      source: { kind: 'release', source: priority.source },
    });
  }
  const buckets = report.toolSurfaceAnalysis?.findings;
  if (buckets) {
    for (const [severity, values] of Object.entries(buckets)) {
      for (const finding of values) {
        findings.set(`tool:${finding.id}`, {
          severity,
          title: finding.title,
          source: { kind: 'tool' },
        });
      }
    }
  }
  for (const assessment of Object.values(report.compatibility?.assessments || {})) {
    for (const finding of assessment.findings || []) {
      if (finding.outcome === 'pass') continue;
      findings.set(`compatibility:${assessment.profileId}:${finding.ruleId}`, {
        severity: finding.severity,
        title: finding.summary,
        source: { kind: 'compatibility', profileId: assessment.profileId },
      });
    }
  }
  return findings;
};

const completedReport = (report: PublicReport): boolean => report.outcome.status === 'scored';

const toolFindingsWereEvaluated = (report: PublicReport): boolean => (
  completedReport(report)
  && report.toolSurfaceAnalysis !== undefined
  && sectionWasEvaluated(report, 'capabilities')
);

const findingSourceWasEvaluated = (report: PublicReport, source: FindingSource): boolean => {
  if (!completedReport(report)) return false;
  if (source.kind === 'tool') return toolFindingsWereEvaluated(report);
  if (source.kind === 'compatibility') {
    return report.compatibility?.assessments[source.profileId] !== undefined;
  }
  if (!report.releaseDecision) return false;
  if (source.source === 'Tool surface') return toolFindingsWereEvaluated(report);
  if (source.source === 'Host compatibility') return report.compatibility !== undefined;
  return true;
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
    const finding = left.get(id)!;
    const comparable = findingSourceWasEvaluated(before, finding.source)
      && findingSourceWasEvaluated(after, finding.source);
    changes.push(makeChange(
      comparable ? 'removal' : 'unknown', 'findings', `findings.${id}`,
      comparable ? `Finding resolved: ${finding.title}` : `Finding is not comparable: ${finding.title}`,
      comparable
        ? 'This finding is absent from the latest report.'
        : 'The finding source was not completely evaluated in both snapshots.'
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

const checkLatencies = (report: PublicReport): Map<string, number> => new Map(
  (report.timings?.checks || []).map((check) => [check.name, check.durationMs])
);

const sectionWasEvaluated = (report: PublicReport, id: string): boolean => (
  report.sections.find((section) => section.id === id)?.status === 'evaluated'
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

  const protocolSectionsComparable = sectionWasEvaluated(before, 'protocol')
    && sectionWasEvaluated(after, 'protocol');
  const beforeProtocolEra = before.protocol?.era;
  const afterProtocolEra = after.protocol?.era;
  const protocolEraComparable = protocolSectionsComparable
    && beforeProtocolEra !== undefined
    && afterProtocolEra !== undefined;
  const protocolRegressed = protocolEraComparable
    && beforeProtocolEra === 'modern'
    && afterProtocolEra === 'legacy';
  compareScalar(changes, beforeProtocolEra, afterProtocolEra, {
    classification: !protocolEraComparable ? 'unknown' : protocolRegressed ? 'breaking' : 'change',
    category: 'protocol', path: 'protocol.era', title: 'Protocol lifecycle changed',
    detail: protocolEraComparable
      ? undefined
      : 'One run did not establish a comparable protocol lifecycle.',
    breaking: protocolRegressed,
  });
  const beforeProtocolVersion = before.protocol?.version;
  const afterProtocolVersion = after.protocol?.version;
  const protocolVersionComparable = protocolSectionsComparable
    && beforeProtocolVersion !== undefined
    && afterProtocolVersion !== undefined;
  compareScalar(changes, beforeProtocolVersion, afterProtocolVersion, {
    classification: protocolVersionComparable ? 'change' : 'unknown', category: 'protocol',
    path: 'protocol.version', title: 'Protocol version changed',
    detail: protocolVersionComparable
      ? undefined
      : 'One run did not establish a comparable protocol version.',
    breaking: false,
  });
  if (before.provenance.route === 'direct' && after.provenance.route === 'authenticated-proxy') {
    changes.push(makeChange(
      'breaking', 'transport', 'provenance.route', 'Direct browser access regressed',
      'The latest run required the authenticated proxy after the previous run connected directly.'
    ));
  } else {
    const routeComparable = before.provenance.route !== 'unknown'
      && after.provenance.route !== 'unknown';
    compareScalar(changes, before.provenance.route, after.provenance.route, {
      classification: routeComparable ? 'change' : 'unknown',
      category: 'transport', path: 'provenance.route',
      title: 'Connection route changed',
      detail: routeComparable
        ? undefined
        : 'One run did not establish a comparable connection route.',
      breaking: false,
    });
  }

  const connectionTimings = [
    { key: 'connectionSetupMs', label: 'Connection setup' },
    { key: 'negotiationMs', label: 'Negotiation' },
  ] as const;
  for (const { key, label } of connectionTimings) {
    const beforeLatency = before.timings?.[key];
    const afterLatency = after.timings?.[key];
    if (beforeLatency === afterLatency) continue;
    if (beforeLatency === undefined || afterLatency === undefined) {
      changes.push(makeChange(
        'unknown', 'latency', `timings.${key}`, `${label} latency is not comparable`,
        'One snapshot does not contain this timing.'
      ));
      continue;
    }
    const regression = afterLatency > beforeLatency + 100 && afterLatency > beforeLatency * 1.25;
    changes.push(makeChange(
      regression ? 'risk' : 'change', 'latency', `timings.${key}`,
      regression ? `${label} latency regressed` : `${label} latency changed`,
      `Changed from ${beforeLatency} ms to ${afterLatency} ms.`
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
