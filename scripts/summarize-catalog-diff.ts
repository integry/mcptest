import fs from 'node:fs';
import type { CatalogServerSeed, CatalogValidationResult } from '../src/types/catalog';
import type { CapabilityInventoryV1 } from '../src/types/capabilityInventory';

// Builds the body of the scheduled catalog revalidation pull request from the
// before/after copies of catalogValidation.json and catalogCapabilities.json.

export type CapabilitySnapshots = Record<string, CapabilityInventoryV1>;

export interface CatalogDiffInput {
  beforeValidation: CatalogValidationResult[];
  afterValidation: CatalogValidationResult[];
  beforeCapabilities: CapabilitySnapshots;
  afterCapabilities: CapabilitySnapshots;
  /** Optional display names keyed by server id. */
  names?: Record<string, string>;
}

interface StatusChange { serverId: string; from?: string; to: string; detail?: string }
interface FieldChange { serverId: string; from: string; to: string }
interface CapabilityChange { serverId: string; fields: string[] }
interface ToolChange {
  serverId: string;
  from?: number;
  to?: number;
  added: string[];
  removed: string[];
}

export interface CatalogDiff {
  added: string[];
  removed: string[];
  wentOnline: StatusChange[];
  wentOffline: StatusChange[];
  otherStatus: StatusChange[];
  protocol: FieldChange[];
  transport: FieldChange[];
  auth: FieldChange[];
  tools: ToolChange[];
  /** Servers whose evidence changed only in fields not listed above (message, URL, error code). */
  otherEvidence: string[];
  /** Capability snapshots that changed outside tool names and counts (section status, resources, prompts, ...). */
  otherCapabilities: CapabilityChange[];
  /** Servers whose validation and capability evidence was re-observed with no observable change. */
  unchanged: number;
}

const NONE = '—';

const byId = (results: CatalogValidationResult[]): Map<string, CatalogValidationResult> => (
  new Map(results.map((result) => [result.serverId, result]))
);

const protocolLabel = (result: CatalogValidationResult): string => {
  const era = result.protocolEra && result.protocolEra !== 'unknown' ? result.protocolEra : undefined;
  if (result.protocolVersion && era) return `${result.protocolVersion} (${era})`;
  return result.protocolVersion || era || 'unknown';
};

const authLabel = (result: CatalogValidationResult): string => {
  const servers = result.authorizationServers?.length
    ? ` via ${[...result.authorizationServers].sort().join(', ')}`
    : '';
  return `${result.authType || (result.requiresOAuth ? 'oauth' : 'unknown')}${servers}`;
};

const toolNames = (inventory?: CapabilityInventoryV1): string[] => (
  inventory?.tools.items.map(({ name }) => name) ?? []
);

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
};

const comparable = (result: CatalogValidationResult): string => {
  const { checkedAt: _checkedAt, ...rest } = result;
  return canonicalJson(rest);
};

// Top-level capability fields that differ, ignoring the observation time.
const changedCapabilityFields = (
  previous?: CapabilityInventoryV1,
  next?: CapabilityInventoryV1
): string[] => {
  if (!previous || !next) return previous === next ? [] : ['snapshot'];
  const fields = new Set([...Object.keys(previous), ...Object.keys(next)]);
  fields.delete('observedAt');
  return [...fields].sort().filter((field) => (
    canonicalJson(previous[field as keyof CapabilityInventoryV1])
      !== canonicalJson(next[field as keyof CapabilityInventoryV1])
  ));
};

export function diffCatalogEvidence(input: CatalogDiffInput): CatalogDiff {
  const before = byId(input.beforeValidation);
  const after = byId(input.afterValidation);
  const diff: CatalogDiff = {
    added: [],
    removed: [],
    wentOnline: [],
    wentOffline: [],
    otherStatus: [],
    protocol: [],
    transport: [],
    auth: [],
    tools: [],
    otherEvidence: [],
    otherCapabilities: [],
    unchanged: 0,
  };
  const capabilityChanged = new Set<string>();
  const capabilityIds = new Set([
    ...Object.keys(input.beforeCapabilities),
    ...Object.keys(input.afterCapabilities),
  ]);
  for (const serverId of [...capabilityIds].sort()) {
    const previous = input.beforeCapabilities[serverId];
    const next = input.afterCapabilities[serverId];
    const fields = changedCapabilityFields(previous, next);
    if (fields.length === 0) continue;
    capabilityChanged.add(serverId);
    const previousNames = toolNames(previous);
    const nextNames = toolNames(next);
    const added = nextNames.filter((name) => !previousNames.includes(name));
    const removed = previousNames.filter((name) => !nextNames.includes(name));
    const from = previous?.tools.observedCount;
    const to = next?.tools.observedCount;
    const toolsListed = from !== to || added.length > 0 || removed.length > 0;
    if (toolsListed) diff.tools.push({ serverId, from, to, added, removed });
    // Anything a tool row does not already explain (tool section status, pagination,
    // descriptions, resources, prompts, provenance, authentication) is reported separately.
    const unexplained = toolsListed && previous && next
      ? changedCapabilityFields(
        { ...previous, tools: { ...previous.tools, observedCount: 0, retainedCount: 0, items: [] } },
        { ...next, tools: { ...next.tools, observedCount: 0, retainedCount: 0, items: [] } }
      )
      : toolsListed ? [] : fields;
    if (unexplained.length > 0) diff.otherCapabilities.push({ serverId, fields: unexplained });
  }

  for (const serverId of before.keys()) {
    if (!after.has(serverId)) diff.removed.push(serverId);
  }

  for (const [serverId, next] of after) {
    const previous = before.get(serverId);
    if (!previous) {
      diff.added.push(serverId);
      continue;
    }
    let listed = false;
    if (previous.status !== next.status) {
      const change = {
        serverId,
        from: previous.status,
        to: next.status,
        detail: next.status === 'online' ? undefined : next.errorCode,
      };
      if (next.status === 'online') diff.wentOnline.push(change);
      else if (previous.status === 'online') diff.wentOffline.push(change);
      else diff.otherStatus.push(change);
      listed = true;
    }
    // A status flip already explains protocol, transport and auth evidence appearing or
    // disappearing, so those fields are compared only for servers online in both runs.
    const comparableRuns = previous.status === 'online' && next.status === 'online';
    const fieldChanges: Array<[FieldChange[], string, string]> = comparableRuns ? [
      [diff.protocol, protocolLabel(previous), protocolLabel(next)],
      [diff.transport, previous.transport, next.transport],
      [diff.auth, authLabel(previous), authLabel(next)],
    ] : [];
    for (const [bucket, from, to] of fieldChanges) {
      if (from !== to) {
        bucket.push({ serverId, from, to });
        listed = true;
      }
    }
    const validationUnchanged = comparable(previous) === comparable(next);
    if (!listed && !validationUnchanged) diff.otherEvidence.push(serverId);
    if (!listed && validationUnchanged && !capabilityChanged.has(serverId)) diff.unchanged += 1;
  }

  return diff;
}

const escapeCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

const LIST_LIMIT = 8;
const nameList = (names: string[]): string => {
  if (names.length === 0) return NONE;
  const shown = names.slice(0, LIST_LIMIT).map((name) => `\`${name}\``).join(', ');
  return names.length > LIST_LIMIT ? `${shown} and ${names.length - LIST_LIMIT} more` : shown;
};

export function renderCatalogDiff(diff: CatalogDiff, names: Record<string, string> = {}): string {
  const server = (serverId: string): string => (
    names[serverId] && names[serverId] !== serverId
      ? `${escapeCell(names[serverId])} (\`${serverId}\`)`
      : `\`${serverId}\``
  );
  const lines: string[] = ['## Catalog revalidation', ''];
  const total = diff.wentOnline.length + diff.wentOffline.length + diff.otherStatus.length
    + diff.protocol.length + diff.transport.length + diff.auth.length + diff.tools.length
    + diff.added.length + diff.removed.length + diff.otherEvidence.length
    + diff.otherCapabilities.length;

  lines.push(
    '| Change | Servers |',
    '| --- | ---: |',
    `| Went online | ${diff.wentOnline.length} |`,
    `| Went offline or unknown | ${diff.wentOffline.length + diff.otherStatus.length} |`,
    `| Protocol version changed | ${diff.protocol.length} |`,
    `| Transport changed | ${diff.transport.length} |`,
    `| Authentication changed | ${diff.auth.length} |`,
    `| Tool count or tool names changed | ${diff.tools.length} |`,
    `| Other evidence changed | ${diff.otherEvidence.length} |`,
    `| Other capability evidence changed | ${diff.otherCapabilities.length} |`,
    `| No observable change | ${diff.unchanged} |`,
    ''
  );

  if (total === 0) {
    lines.push('No observable change since the last snapshot.', '');
    return `${lines.join('\n')}\n`;
  }

  const section = (title: string, header: string, rows: string[]): void => {
    if (rows.length === 0) return;
    lines.push(`### ${title}`, '', header, `|${header.split('|').slice(1, -1).map(() => ' --- ').join('|')}|`, ...rows, '');
  };

  section('Went online', '| Server | Before | After |', diff.wentOnline.map(
    (change) => `| ${server(change.serverId)} | ${change.from} | ${change.to} |`
  ));
  section('Went offline or unknown', '| Server | Before | After | Error |', [...diff.wentOffline, ...diff.otherStatus].map(
    (change) => `| ${server(change.serverId)} | ${change.from} | ${change.to} | ${change.detail || NONE} |`
  ));
  section('Protocol version changes', '| Server | Before | After |', diff.protocol.map(
    (change) => `| ${server(change.serverId)} | ${escapeCell(change.from)} | ${escapeCell(change.to)} |`
  ));
  section('Transport changes', '| Server | Before | After |', diff.transport.map(
    (change) => `| ${server(change.serverId)} | ${change.from} | ${change.to} |`
  ));
  section('Authentication changes', '| Server | Before | After |', diff.auth.map(
    (change) => `| ${server(change.serverId)} | ${escapeCell(change.from)} | ${escapeCell(change.to)} |`
  ));
  section('Tool changes', '| Server | Tools before | Tools after | Added | Removed |', diff.tools.map(
    (change) => `| ${server(change.serverId)} | ${change.from ?? NONE} | ${change.to ?? NONE} | ${
      nameList(change.added)} | ${nameList(change.removed)} |`
  ));
  section('Other capability changes', '| Server | Changed fields |', diff.otherCapabilities.map(
    (change) => `| ${server(change.serverId)} | ${change.fields.map((field) => `\`${field}\``).join(', ')} |`
  ));

  if (diff.added.length > 0) {
    lines.push(`**New in the validation file:** ${diff.added.map(server).join(', ')}`, '');
  }
  if (diff.removed.length > 0) {
    lines.push(`**Removed from the validation file:** ${diff.removed.map(server).join(', ')}`, '');
  }
  if (diff.otherEvidence.length > 0) {
    lines.push(
      `**Other evidence changed** (message, validated URL or error code): ${diff.otherEvidence.map(server).join(', ')}`,
      ''
    );
  }
  return `${lines.join('\n')}\n`;
}

export function summarizeCatalogDiff(input: CatalogDiffInput): string {
  return renderCatalogDiff(diffCatalogEvidence(input), input.names);
}

const option = (argv: string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const readJson = <T>(filePath: string | undefined, fallback: T): T => (
  filePath && fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) as T : fallback
);

export const USAGE = 'Usage: npm run summarize-catalog-diff -- '
  + '--before-validation <file> --after-validation <file> '
  + '--before-capabilities <file> --after-capabilities <file> [--catalog <serverCatalog.json>] [--output <file>]';

export function main(argv: string[] = process.argv.slice(2)): string {
  const required = ['--before-validation', '--after-validation', '--before-capabilities', '--after-capabilities'];
  if (required.some((name) => !option(argv, name))) throw new Error(USAGE);
  const catalog = readJson<CatalogServerSeed[]>(option(argv, '--catalog'), []);
  // A missing "before" file means the snapshot is new; treat it as empty.
  const body = summarizeCatalogDiff({
    beforeValidation: readJson(option(argv, '--before-validation'), []),
    afterValidation: readJson(option(argv, '--after-validation'), []),
    beforeCapabilities: readJson(option(argv, '--before-capabilities'), {}),
    afterCapabilities: readJson(option(argv, '--after-capabilities'), {}),
    names: Object.fromEntries(catalog.map(({ id, name }) => [id, name])),
  });
  const output = option(argv, '--output');
  if (output) fs.writeFileSync(output, body, 'utf8');
  else process.stdout.write(body);
  return body;
}
