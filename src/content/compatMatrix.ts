/**
 * Renders the client compatibility matrix from `src/data/clientCompatibility.json`
 * as GitHub-flavored Markdown. Articles place it with an inline directive:
 *
 *   <!-- compat-matrix clients="claude-code,cursor" -->
 *   <!-- compat-matrix clients="cursor" limitations="true" -->
 *
 * The directive is expanded when the article is created, so the React page,
 * the prerendered HTML and the raw `.md` export all carry the same table.
 */
import {
  CLIENT_COMPATIBILITY_IDS,
  getClientCompatibility,
  getSourceTitle,
  type ClientCompatibilityEntry,
  type ConfigurationKind,
  type SourcedCell,
  type SupportLevel,
} from '../data/clientCompatibility.ts';

export const COMPAT_MATRIX_DIRECTIVE_PATTERN = /^[ \t]*<!--\s*compat-matrix\b([^>]*?)-->[ \t]*$/gm;
export const CLIENT_COMPATIBILITY_DATA_URL =
  'https://github.com/integry/mcptest/blob/master/src/data/clientCompatibility.json';

const supportLabel: Record<SupportLevel, string> = {
  supported: 'Yes',
  limited: 'Limited',
  unsupported: 'No',
  'bridge-required': 'Bridge required',
  unknown: 'unknown',
};

const configurationLabel: Record<ConfigurationKind, string> = {
  ui: 'UI',
  file: 'File',
  cli: 'CLI',
};

const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const support = (cell: SourcedCell<SupportLevel>) => supportLabel[cell.value];

const listByLevel = (cells: Array<[string, SourcedCell<SupportLevel>]>, empty: string): string => {
  const supported = cells.filter(([, cell]) => cell.value === 'supported').map(([label]) => label);
  const limited = cells.filter(([, cell]) => cell.value === 'limited').map(([label]) => label);
  const unknown = cells.filter(([, cell]) => cell.value === 'unknown').map(([label]) => label);
  const parts: string[] = [];
  if (supported.length > 0) parts.push(supported.join(', '));
  if (limited.length > 0) parts.push(`${limited.join(', ')} limited`);
  if (unknown.length > 0) parts.push(`${unknown.join(', ')} unknown`);
  return parts.length > 0 ? parts.join('; ') : empty;
};

const transportCell = (entry: ClientCompatibilityEntry, key: keyof ClientCompatibilityEntry['transports']) =>
  support(entry.transports[key]);

const protocolCell = (entry: ClientCompatibilityEntry) =>
  entry.protocolVersions.value === 'unknown' ? 'unknown' : entry.protocolVersions.value.map((version) => `\`${version}\``).join(', ');

const oauthCell = (entry: ClientCompatibilityEntry) => listByLevel([
  ['DCR', entry.auth.oauthDcr],
  ['CIMD', entry.auth.cimd],
  ['pre-registered client', entry.auth.preRegisteredClient],
], 'No OAuth');

const credentialsCell = (entry: ClientCompatibilityEntry) => listByLevel([
  ['custom headers', entry.headers.custom],
  ['bearer token', entry.auth.bearerToken],
  ['API key header', entry.auth.apiKeyHeader],
  ['no auth', entry.auth.none],
], 'None');

const configurationCell = (entry: ClientCompatibilityEntry) =>
  entry.configuration.map(({ kind, text }) => `${configurationLabel[kind]}: ${text}`).join('; ');

const clientCell = (entry: ClientCompatibilityEntry, currentPath?: string) => {
  const name = `[${entry.name}](${entry.documentationUrl})`;
  return entry.guidePath && entry.guidePath !== currentPath ? `${name} ([guide](${entry.guidePath}))` : name;
};

const versionCell = (entry: ClientCompatibilityEntry) =>
  entry.version.value === 'unknown' ? 'unknown' : entry.version.value;

/** Parses `clients="a,b"` and other attributes from a directive body. */
export const parseCompatMatrixDirective = (body: string): { clients: string[]; limitations: boolean } => {
  const attributes = new Map<string, string>();
  for (const match of body.matchAll(/([a-z-]+)="([^"]*)"/g)) attributes.set(match[1], match[2]);
  const unknownAttribute = [...attributes.keys()].find((name) => name !== 'clients' && name !== 'limitations');
  if (unknownAttribute) throw new Error(`compat-matrix directive has unknown attribute ${unknownAttribute}.`);
  const clientList = attributes.get('clients');
  const clients = clientList === undefined || clientList.trim() === 'all'
    ? [...CLIENT_COMPATIBILITY_IDS]
    : clientList.split(',').map((id) => id.trim()).filter(Boolean);
  if (clients.length === 0) throw new Error('compat-matrix directive lists no clients.');
  return { clients, limitations: attributes.get('limitations') === 'true' };
};

/** Markdown table (and optional limitation list) for the given client ids. */
export const renderCompatMatrixMarkdown = (
  clientIds: readonly string[],
  options: { limitations?: boolean; currentPath?: string } = {}
): string => {
  const entries = clientIds.map((id) => {
    const entry = getClientCompatibility(id);
    if (!entry) throw new Error(`compat-matrix references unknown client ${id}. Known clients: ${CLIENT_COMPATIBILITY_IDS.join(', ')}.`);
    return entry;
  });
  const header = ['Client', 'Version', 'Streamable HTTP', 'Legacy SSE', 'stdio', 'Protocol versions', 'OAuth registration', 'Other credentials', 'Private hosts', 'Configuration', 'Verified'];
  const rows = entries.map((entry) => [
    clientCell(entry, options.currentPath),
    versionCell(entry),
    transportCell(entry, 'streamableHttp'),
    transportCell(entry, 'legacySse'),
    transportCell(entry, 'stdio'),
    protocolCell(entry),
    oauthCell(entry),
    credentialsCell(entry),
    support(entry.privateHosts),
    configurationCell(entry),
    entry.verifiedOn,
  ].map(escapeCell));

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];

  if (options.limitations) {
    const limitationLines = entries.flatMap((entry) => entry.limitations.map(({ text, source }) => (
      `- **${entry.name}:** ${text} ([${getSourceTitle(entry, source)}](${source}))`
    )));
    if (limitationLines.length > 0) {
      lines.push('', 'Known limitations:', '', ...limitationLines);
    }
  }

  lines.push(
    '',
    `"Limited" means beta, plan-gated or restricted to some accounts. "unknown" means the vendor's current documentation does not state it. Every cell, with its source page and verification date, is in [clientCompatibility.json](${CLIENT_COMPATIBILITY_DATA_URL}).`
  );
  return lines.join('\n');
};

/**
 * Replaces every compat-matrix directive in an article body with the rendered
 * table. `currentPath` drops the guide link that would point at the article itself.
 */
export const expandCompatMatrixDirectives = (content: string, currentPath?: string): string =>
  content.replace(COMPAT_MATRIX_DIRECTIVE_PATTERN, (_match, body: string) => {
    const { clients, limitations } = parseCompatMatrixDirective(body);
    return renderCompatMatrixMarkdown(clients, { limitations, currentPath });
  });
