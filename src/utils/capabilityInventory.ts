import type {
  CapabilityInventoryArgumentV1,
  CapabilityInventoryCategory,
  CapabilityInventoryPromptV1,
  CapabilityInventoryResourceV1,
  CapabilityInventorySectionV1,
  CapabilityInventoryStatus,
  CapabilityInventoryToolV1,
  CapabilityInventoryV1,
} from '../types/capabilityInventory';

const CAPABILITY_INVENTORY_VERSION = 1 as const;

export const CAPABILITY_INVENTORY_ITEM_LIMIT = 100;
export const CAPABILITY_INVENTORY_ARGUMENT_LIMIT = 32;
export const CAPABILITY_INVENTORY_SECTION_BYTE_LIMIT = 32_000;
export const CAPABILITY_INVENTORY_AGGREGATE_BYTE_LIMIT = 96_000;
export const CAPABILITY_INVENTORY_STRING_LIMITS = {
  name: 128,
  title: 200,
  description: 600,
  mimeType: 128,
} as const;

type DiscoveryInput = Partial<Record<CapabilityInventoryCategory, unknown>>;
type DiscoveryStatuses = Record<CapabilityInventoryCategory, CapabilityInventoryStatus>;

export interface CreateCapabilityInventoryInput {
  observedAt?: string | Date;
  testedEndpoint: string;
  route: 'direct' | 'authenticated-proxy';
  authentication: 'authenticated' | 'unauthenticated';
  discovered: DiscoveryInput;
  statuses: DiscoveryStatuses;
  paginationComplete?: Partial<Record<CapabilityInventoryCategory, boolean>>;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const SECRET_ASSIGNMENT = /\b(authorization|cookie|password|passwd|secret|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|api[_ -]?key|private[_ -]?key|credential|session|token)\s*[:=]\s*([^\s,;&]+)/gi;
const BEARER_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SAFE_IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,127})$/;
const SAFE_MIME_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i;
const SCHEMA_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);

const utf8Bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
};

const redactUrlSecrets = (value: string): string => value.replace(/https?:\/\/[^\s<>]+/gi, (candidate) => {
  try {
    const url = new URL(candidate);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:auth|code|cookie|credential|key|password|secret|session|signature|token)/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    if (url.hash) url.hash = '#[REDACTED]';
    return url.toString();
  } catch {
    return '[REDACTED]';
  }
});

const cleanText = (
  value: unknown,
  limit: number
): { value?: string; changed: boolean } => {
  if (typeof value !== 'string') return { changed: value !== undefined };
  const withoutControls = value.replace(CONTROL_CHARACTERS, ' ');
  const normalized = withoutControls.replace(/\s+/g, ' ').trim();
  const redacted = redactUrlSecrets(normalized)
    .replace(SECRET_ASSIGNMENT, '$1=[REDACTED]')
    .replace(BEARER_VALUE, '$1 [REDACTED]')
    .replace(JWT_VALUE, '[REDACTED]');
  if (!redacted) return { changed: value.length > 0 };
  const bounded = redacted.length > limit ? redacted.slice(0, limit).trimEnd() : redacted;
  return { value: bounded, changed: bounded !== value };
};

const cleanCapabilityText = (
  value: unknown,
  limit: number
): { value?: string; changed: boolean } => {
  const cleaned = cleanText(value, limit);
  if (!cleaned.value) return cleaned;
  const withoutUris = cleaned.value.replace(
    /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/g,
    '[REDACTED URI]'
  );
  return { value: withoutUris, changed: cleaned.changed || withoutUris !== cleaned.value };
};

const safeIdentifier = (value: unknown): string | undefined => {
  const cleaned = cleanText(value, CAPABILITY_INVENTORY_STRING_LIMITS.name).value;
  return cleaned && SAFE_IDENTIFIER.test(cleaned) ? cleaned : undefined;
};

const safeDisplayName = (value: unknown): { value?: string; changed: boolean } => {
  const cleaned = cleanText(value, CAPABILITY_INVENTORY_STRING_LIMITS.name);
  if (!cleaned.value || /[<>]/.test(cleaned.value)
      || /\b[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(cleaned.value)) return { changed: true };
  return cleaned;
};

const record = (value: unknown): Record<string, unknown> | undefined => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const safeType = (value: unknown): string | undefined => {
  if (typeof value === 'string' && SCHEMA_TYPES.has(value)) return value;
  if (Array.isArray(value)) {
    const types = [...new Set(value.filter((item): item is string => (
      typeof item === 'string' && SCHEMA_TYPES.has(item)
    )))].sort();
    if (types.length > 0 && types.length === value.length) return types.join(' | ');
  }
  return undefined;
};

const sanitizeArguments = (
  rawArguments: unknown,
  source: 'schema' | 'prompt'
): { items?: CapabilityInventoryArgumentV1[]; changed: boolean } => {
  let entries: Array<[string, unknown]> = [];
  let required = new Set<string>();
  let changed = false;

  if (source === 'schema') {
    const schema = record(rawArguments);
    const properties = record(schema?.properties);
    if (!properties) return {
      changed: rawArguments !== undefined && (!schema || schema.properties !== undefined),
    };
    entries = Object.entries(properties);
    if (Array.isArray(schema?.required)) {
      required = new Set(schema.required.filter((item): item is string => typeof item === 'string'));
      changed ||= required.size !== schema.required.length;
    } else if (schema?.required !== undefined) changed = true;
  } else {
    if (!Array.isArray(rawArguments)) return { changed: rawArguments !== undefined };
    entries = rawArguments.map((item, index) => [String(index), item]);
  }

  const byName = new Map<string, CapabilityInventoryArgumentV1>();
  for (const [propertyName, raw] of entries) {
    const value = record(raw);
    const name = source === 'schema' ? safeIdentifier(propertyName) : safeIdentifier(value?.name);
    if (!value || !name) {
      changed = true;
      continue;
    }
    const description = cleanCapabilityText(value.description, CAPABILITY_INVENTORY_STRING_LIMITS.description);
    const argument: CapabilityInventoryArgumentV1 = {
      name,
      ...(safeType(value.type) ? { type: safeType(value.type) } : {}),
      ...(description.value ? { description: description.value } : {}),
      required: source === 'schema' ? required.has(propertyName) : value.required === true,
    };
    changed ||= description.changed || byName.has(name);
    if (!byName.has(name)) byName.set(name, argument);
  }
  const sorted = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
  if (sorted.length > CAPABILITY_INVENTORY_ARGUMENT_LIMIT) changed = true;
  const items = sorted.slice(0, CAPABILITY_INVENTORY_ARGUMENT_LIMIT);
  return { ...(items.length > 0 ? { items } : {}), changed };
};

const sanitizeTool = (raw: unknown): { item?: CapabilityInventoryToolV1; changed: boolean } => {
  const value = record(raw);
  const name = safeIdentifier(value?.name);
  if (!value || !name) return { changed: true };
  const description = cleanCapabilityText(value.description, CAPABILITY_INVENTORY_STRING_LIMITS.description);
  const input = value.inputSchema !== undefined
    ? sanitizeArguments(value.inputSchema, 'schema')
    : sanitizeArguments(value.input, 'prompt');
  return {
    item: {
      name,
      ...(description.value ? { description: description.value } : {}),
      ...(input.items ? { input: input.items } : {}),
    },
    changed: description.changed || input.changed,
  };
};

const sanitizeResource = (raw: unknown): { item?: CapabilityInventoryResourceV1; changed: boolean } => {
  const value = record(raw);
  const name = safeDisplayName(value?.name);
  if (!value || !name.value) return { changed: true };
  const title = cleanCapabilityText(value.title, CAPABILITY_INVENTORY_STRING_LIMITS.title);
  const description = cleanCapabilityText(value.description, CAPABILITY_INVENTORY_STRING_LIMITS.description);
  const mimeType = cleanText(value.mimeType, CAPABILITY_INVENTORY_STRING_LIMITS.mimeType);
  const safeMimeType = mimeType.value && SAFE_MIME_TYPE.test(mimeType.value) ? mimeType.value : undefined;
  return {
    item: {
      name: name.value,
      ...(title.value ? { title: title.value } : {}),
      ...(description.value ? { description: description.value } : {}),
      ...(safeMimeType ? { mimeType: safeMimeType } : {}),
    },
    changed: name.changed || title.changed || description.changed || mimeType.changed
      || Boolean(mimeType.value && !safeMimeType),
  };
};

const sanitizePrompt = (raw: unknown): { item?: CapabilityInventoryPromptV1; changed: boolean } => {
  const value = record(raw);
  const name = safeIdentifier(value?.name);
  if (!value || !name) return { changed: true };
  const description = cleanCapabilityText(value.description, CAPABILITY_INVENTORY_STRING_LIMITS.description);
  const args = sanitizeArguments(value.arguments, 'prompt');
  return {
    item: {
      name,
      ...(description.value ? { description: description.value } : {}),
      ...(args.items ? { arguments: args.items } : {}),
    },
    changed: description.changed || args.changed,
  };
};

const emptySection = <T>(status: CapabilityInventoryStatus): CapabilityInventorySectionV1<T> => ({
  status,
  observedCount: 0,
  retainedCount: 0,
  omittedCount: 0,
  paginationComplete: status !== 'partial' && status !== 'unavailable',
  items: [],
});

const sanitizeSection = <T extends { name: string }>(
  raw: unknown,
  status: CapabilityInventoryStatus,
  sanitizer: (value: unknown) => { item?: T; changed: boolean },
  paginationComplete?: boolean
): CapabilityInventorySectionV1<T> => {
  if (!Array.isArray(raw)) return emptySection(status === 'complete' ? 'partial' : status);
  let changed = false;
  const byName = new Map<string, T>();
  for (const value of raw) {
    const sanitized = sanitizer(value);
    changed ||= sanitized.changed || !sanitized.item;
    if (!sanitized.item) continue;
    const key = sanitized.item.name.toLocaleLowerCase('en-US');
    if (byName.has(key)) changed = true;
    else byName.set(key, sanitized.item);
  }
  const sorted = [...byName.values()].sort((left, right) => (
    left.name.localeCompare(right.name, 'en-US')
  ));
  if (sorted.length > CAPABILITY_INVENTORY_ITEM_LIMIT) changed = true;
  const items = sorted.slice(0, CAPABILITY_INVENTORY_ITEM_LIMIT);
  const omittedCount = Math.max(0, raw.length - items.length);
  return {
    status: status === 'complete' && (changed || omittedCount > 0) ? 'partial' : status,
    observedCount: raw.length,
    retainedCount: items.length,
    omittedCount,
    paginationComplete: paginationComplete ?? (status === 'complete' || status === 'unsupported'),
    items,
  };
};

const normalizeDate = (value: string | Date | undefined): string => {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Capability inventory observedAt is invalid.');
  return date.toISOString();
};

const safeEndpoint = (value: string): string => {
  const cleaned = cleanText(value, 2_048).value;
  if (!cleaned) throw new Error('Capability inventory endpoint is missing.');
  const url = new URL(cleaned);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Capability inventory endpoint must use HTTP or HTTPS.');
  }
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/(?:auth|code|cookie|credential|key|password|secret|session|signature|token)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  return url.toString();
};

const enforceAggregateBound = (inventory: CapabilityInventoryV1): CapabilityInventoryV1 => {
  const categories: CapabilityInventoryCategory[] = [
    'prompts', 'resourceTemplates', 'resources', 'tools',
  ];
  for (const category of categories) {
    const section = inventory[category] as CapabilityInventorySectionV1<{ name: string }>;
    while (section.items.length > 0 && utf8Bytes(section) > CAPABILITY_INVENTORY_SECTION_BYTE_LIMIT) {
      section.items.pop();
      section.retainedCount -= 1;
      section.omittedCount += 1;
      if (section.status === 'complete') section.status = 'partial';
    }
  }
  if (utf8Bytes(inventory) <= CAPABILITY_INVENTORY_AGGREGATE_BYTE_LIMIT) return inventory;
  for (const category of categories) {
    const section = inventory[category] as CapabilityInventorySectionV1<{ name: string }>;
    while (section.items.length > 0 && utf8Bytes(inventory) > CAPABILITY_INVENTORY_AGGREGATE_BYTE_LIMIT) {
      section.items.pop();
      section.retainedCount -= 1;
      section.omittedCount += 1;
      if (section.status === 'complete') section.status = 'partial';
    }
  }
  if (utf8Bytes(inventory) > CAPABILITY_INVENTORY_AGGREGATE_BYTE_LIMIT) {
    throw new Error('Capability inventory metadata exceeds its aggregate byte limit.');
  }
  return inventory;
};

export const createCapabilityInventory = (
  input: CreateCapabilityInventoryInput
): CapabilityInventoryV1 => enforceAggregateBound({
  version: CAPABILITY_INVENTORY_VERSION,
  observedAt: normalizeDate(input.observedAt),
  provenance: {
    testedEndpoint: safeEndpoint(input.testedEndpoint),
    route: input.route,
  },
  authentication: input.authentication,
  tools: sanitizeSection(
    input.discovered.tools,
    input.statuses.tools,
    sanitizeTool,
    input.paginationComplete?.tools
  ),
  resources: sanitizeSection(
    input.discovered.resources,
    input.statuses.resources,
    sanitizeResource,
    input.paginationComplete?.resources
  ),
  resourceTemplates: sanitizeSection(
    input.discovered.resourceTemplates,
    input.statuses.resourceTemplates,
    sanitizeResource,
    input.paginationComplete?.resourceTemplates
  ),
  prompts: sanitizeSection(
    input.discovered.prompts,
    input.statuses.prompts,
    sanitizePrompt,
    input.paginationComplete?.prompts
  ),
});

/** Re-sanitizes an unknown stored/imported value and rejects any non-canonical input. */
export const validateCapabilityInventory = (value: unknown): CapabilityInventoryV1 => {
  const candidate = record(value);
  if (!candidate || candidate.version !== CAPABILITY_INVENTORY_VERSION) {
    throw new Error('Unsupported capability inventory version.');
  }
  const provenance = record(candidate.provenance);
  const category = (name: CapabilityInventoryCategory): Record<string, unknown> => {
    const section = record(candidate[name]);
    if (!section || !['complete', 'partial', 'unsupported', 'unavailable'].includes(String(section.status))) {
      throw new Error(`Capability inventory ${name} status is invalid.`);
    }
    if (!Array.isArray(section.items)) throw new Error(`Capability inventory ${name} items are invalid.`);
    return section;
  };
  if (!provenance || (provenance.route !== 'direct' && provenance.route !== 'authenticated-proxy')) {
    throw new Error('Capability inventory provenance is invalid.');
  }
  if (candidate.authentication !== 'authenticated' && candidate.authentication !== 'unauthenticated') {
    throw new Error('Capability inventory authentication context is invalid.');
  }
  const sections = {
    tools: category('tools'),
    resources: category('resources'),
    resourceTemplates: category('resourceTemplates'),
    prompts: category('prompts'),
  };
  const canonical = createCapabilityInventory({
    observedAt: String(candidate.observedAt),
    testedEndpoint: String(provenance.testedEndpoint),
    route: provenance.route,
    authentication: candidate.authentication,
    discovered: {
      tools: sections.tools.items,
      resources: sections.resources.items,
      resourceTemplates: sections.resourceTemplates.items,
      prompts: sections.prompts.items,
    },
    statuses: {
      tools: sections.tools.status as CapabilityInventoryStatus,
      resources: sections.resources.status as CapabilityInventoryStatus,
      resourceTemplates: sections.resourceTemplates.status as CapabilityInventoryStatus,
      prompts: sections.prompts.status as CapabilityInventoryStatus,
    },
    paginationComplete: {
      tools: Boolean(sections.tools.paginationComplete),
      resources: Boolean(sections.resources.paginationComplete),
      resourceTemplates: Boolean(sections.resourceTemplates.paginationComplete),
      prompts: Boolean(sections.prompts.paginationComplete),
    },
  });
  for (const name of Object.keys(sections) as CapabilityInventoryCategory[]) {
    const source = sections[name];
    const target = canonical[name];
    const counts = [source.observedCount, source.retainedCount, source.omittedCount];
    if (!counts.every((count) => (
      typeof count === 'number' && Number.isInteger(count) && count >= 0
    ))) {
      throw new Error(`Capability inventory ${name} truncation metadata is not canonical.`);
    }
    const [observedCount, retainedCount, omittedCount] = counts as number[];
    if (retainedCount !== target.items.length || observedCount !== retainedCount + omittedCount) {
      throw new Error(`Capability inventory ${name} truncation metadata is not canonical.`);
    }
    if (typeof source.paginationComplete !== 'boolean') {
      throw new Error(`Capability inventory ${name} pagination metadata is invalid.`);
    }
    if (source.status === 'complete' && omittedCount !== 0) {
      throw new Error(`Capability inventory ${name} status metadata is contradictory.`);
    }
    if ((source.status === 'unsupported' || source.status === 'unavailable')
        && observedCount !== 0) {
      throw new Error(`Capability inventory ${name} status metadata is contradictory.`);
    }
    if ((source.status === 'complete' || source.status === 'unsupported')
        && source.paginationComplete !== true) {
      throw new Error(`Capability inventory ${name} pagination metadata is invalid.`);
    }
    if (source.status === 'unavailable' && source.paginationComplete !== false) {
      throw new Error(`Capability inventory ${name} pagination metadata is invalid.`);
    }
    target.observedCount = observedCount;
    target.retainedCount = retainedCount;
    target.omittedCount = omittedCount;
    target.paginationComplete = source.paginationComplete as boolean;
  }
  if (JSON.stringify(stableValue(value)) !== JSON.stringify(stableValue(canonical))) {
    throw new Error('Capability inventory contains unsafe or non-canonical fields.');
  }
  return canonical;
};
