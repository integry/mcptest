import { redactReportString, redactReportValue, type PublicReport } from './reportArtifact';
import { endpointIdentity } from './endpointIdentity';
import { loadReportSnapshots, snapshotsForEndpoint } from './reportHistory';
import type { InterfaceSnapshot, InterfaceToolSnapshot } from './reportDiff';
import type { CapabilityInventorySectionV1 } from '../types/capabilityInventory';

export const INTERFACE_SNAPSHOT_STORAGE_KEY = 'mcpPlaygroundInterfaceSnapshotsV1';
export const INTERFACE_SNAPSHOT_RETENTION = 20;
/** Above this size only schema fingerprints are kept, so storage stays bounded. */
export const INTERFACE_SNAPSHOT_SCHEMA_BUDGET = 250_000;

interface StoredInterfaceSnapshot {
  endpoint: string;
  snapshot: InterfaceSnapshot;
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'getItem' | 'setItem'>;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
};

/** FNV-1a over the canonical JSON; a change detector, not a security boundary. */
export const schemaFingerprint = (value: unknown): string => {
  const text = JSON.stringify(stableValue(value ?? null));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-32:${hash.toString(16).padStart(8, '0')}:${text.length}`;
};

const record = (value: unknown): Record<string, unknown> | undefined => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

const text = (value: unknown): string | undefined => (
  typeof value === 'string' && value ? value : undefined
);

// Names identify resources so playground and report inventories compare alike.
const names = (items: readonly unknown[]): string[] => [
  ...new Set(items.flatMap((item) => {
    const value = record(item);
    const name = text(value?.name) ?? text(value?.uri) ?? text(value?.uriTemplate);
    return name ? [redactReportString(name)] : [];
  })),
].sort();

export interface LiveInterfaceInput {
  tools: readonly unknown[];
  resources: readonly unknown[];
  resourceTemplates: readonly unknown[];
  prompts: readonly unknown[];
  protocolVersion?: string | null;
  transport?: string | null;
  observedAt?: string | Date;
}

/**
 * Builds a redacted snapshot from the lists the playground fetched. Tool schemas
 * pass through the same stored-schema redaction report snapshots use, so a
 * playground snapshot and a report snapshot fingerprint identically.
 */
export const createInterfaceSnapshot = (input: LiveInterfaceInput): InterfaceSnapshot => {
  const rawTools = input.tools.flatMap((tool) => {
    const value = record(tool);
    const name = text(value?.name);
    if (!value || !name) return [];
    return [{
      name,
      ...(text(value.title) ? { title: value.title } : {}),
      ...(text(value.description) ? { description: value.description } : {}),
      inputSchema: value.inputSchema ?? {},
      ...(value.outputSchema !== undefined ? { outputSchema: value.outputSchema } : {}),
    }];
  });
  // Wrapping under `toolDefinitions` selects the report's input-schema rules.
  const redacted = record(redactReportValue({ toolDefinitions: { tools: rawTools } }));
  const redactedTools = (record(redacted?.toolDefinitions)?.tools as Record<string, unknown>[] | undefined) ?? [];
  let tools: InterfaceToolSnapshot[] = redactedTools.map((tool) => ({
    name: String(tool.name),
    ...(text(tool.title) ? { title: String(tool.title) } : {}),
    ...(text(tool.description) ? { description: String(tool.description) } : {}),
    inputSchema: tool.inputSchema,
    inputSchemaFingerprint: schemaFingerprint(tool.inputSchema),
    ...(tool.outputSchema !== undefined ? {
      outputSchema: tool.outputSchema,
      outputSchemaFingerprint: schemaFingerprint(tool.outputSchema),
    } : {}),
  }));
  if (JSON.stringify(tools).length > INTERFACE_SNAPSHOT_SCHEMA_BUDGET) {
    tools = tools.map(({ inputSchema: _input, outputSchema: _output, ...rest }) => rest);
  }
  const observedAt = input.observedAt instanceof Date
    ? input.observedAt.toISOString()
    : input.observedAt ?? new Date().toISOString();
  return {
    observedAt,
    source: 'playground',
    ...(input.protocolVersion ? { protocolVersion: input.protocolVersion } : {}),
    ...(input.transport ? { transport: input.transport } : {}),
    tools: tools.sort((left, right) => left.name.localeCompare(right.name)),
    outputSchemasObserved: true,
    resources: names(input.resources),
    resourceTemplates: names(input.resourceTemplates),
    prompts: names(input.prompts),
  };
};

const completeNames = <T extends { name: string }>(
  section: CapabilityInventorySectionV1<T> | undefined
): string[] | undefined => (
  section && section.status === 'complete' && section.omittedCount === 0 && section.paginationComplete
    ? [...new Set(section.items.map((item) => item.name))].sort()
    : undefined
);

/** Derives a comparable snapshot from a stored report, omitting anything it cannot prove. */
export const interfaceSnapshotFromReport = (report: PublicReport): InterfaceSnapshot => {
  const definitions = report.toolSurfaceAnalysis?.toolDefinitions;
  const toolsComplete = definitions?.status === 'complete';
  return {
    observedAt: report.generatedAt,
    source: 'report',
    ...(report.protocol?.version ? { protocolVersion: report.protocol.version } : {}),
    ...(report.transport?.type ? { transport: report.transport.type } : {}),
    ...(toolsComplete ? {
      tools: definitions.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
        inputSchemaFingerprint: schemaFingerprint(tool.inputSchema),
      })),
    } : {}),
    outputSchemasObserved: false,
    ...(completeNames(report.capabilityInventory?.resources)
      ? { resources: completeNames(report.capabilityInventory?.resources) } : {}),
    ...(completeNames(report.capabilityInventory?.resourceTemplates)
      ? { resourceTemplates: completeNames(report.capabilityInventory?.resourceTemplates) } : {}),
    ...(completeNames(report.capabilityInventory?.prompts)
      ? { prompts: completeNames(report.capabilityInventory?.prompts) } : {}),
  };
};

const isSnapshot = (value: unknown): value is InterfaceSnapshot => {
  const candidate = record(value);
  return Boolean(candidate)
    && typeof candidate!.observedAt === 'string'
    && !Number.isNaN(Date.parse(candidate!.observedAt))
    && (candidate!.source === 'playground' || candidate!.source === 'report')
    && (candidate!.tools === undefined || Array.isArray(candidate!.tools));
};

const readStored = (storage: ReadStorage): StoredInterfaceSnapshot[] => {
  try {
    const parsed = JSON.parse(storage.getItem(INTERFACE_SNAPSHOT_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is StoredInterfaceSnapshot => (
      typeof record(entry)?.endpoint === 'string' && isSnapshot(record(entry)?.snapshot)
    ));
  } catch {
    return [];
  }
};

export const loadInterfaceSnapshot = (
  serverUrl: string,
  storage: ReadStorage = localStorage
): InterfaceSnapshot | undefined => {
  const identity = endpointIdentity(serverUrl);
  return readStored(storage).find((entry) => entry.endpoint === identity)?.snapshot;
};

/** Keeps the newest snapshot per endpoint; storage failures never break the playground. */
export const storeInterfaceSnapshot = (
  serverUrl: string,
  snapshot: InterfaceSnapshot,
  storage: WriteStorage = localStorage
): void => {
  const identity = endpointIdentity(serverUrl);
  const retained = [
    { endpoint: identity, snapshot },
    ...readStored(storage).filter((entry) => entry.endpoint !== identity),
  ].slice(0, INTERFACE_SNAPSHOT_RETENTION);
  try {
    storage.setItem(INTERFACE_SNAPSHOT_STORAGE_KEY, JSON.stringify(retained));
  } catch {
    // Quota exceeded: the next visit simply has no baseline.
  }
};

/** The baseline for "since last visit": the playground store first, then report history. */
export const loadPreviousInterfaceSnapshot = (
  serverUrl: string,
  storage: ReadStorage = localStorage
): InterfaceSnapshot | undefined => {
  const stored = loadInterfaceSnapshot(serverUrl, storage);
  if (stored) return stored;
  const latestReport = snapshotsForEndpoint(loadReportSnapshots(storage), serverUrl)[0];
  return latestReport ? interfaceSnapshotFromReport(latestReport.report) : undefined;
};
