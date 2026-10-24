/**
 * Validates MCP Server Cards (SEP-2127) against the vendored JSON Schema in
 * public/schemas/server-card/v1.schema.json, plus the checks a schema cannot
 * express (a card nobody can connect to, endpoints a browser client cannot use).
 * Only the discovery checker imports this, so the schema stays in its chunk.
 */
import { Validator, type OutputUnit } from '@cfworker/json-schema';
import serverCardSchema from '../../public/schemas/server-card/v1.schema.json';

export { serverCardSchema };

/** The only `$schema` value a v1 card may carry. */
export const SERVER_CARD_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
/** Media type of a hosted Server Card (SEP-2127, "Hosted Server Card Location"). */
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';
/** Media type of an AI Catalog served at /.well-known/ai-catalog.json. */
export const AI_CATALOG_MEDIA_TYPE = 'application/ai-catalog+json';
/** Where the vendored schema came from; shown next to validation results. */
export const SERVER_CARD_SCHEMA_SOURCE = {
  url: 'https://github.com/modelcontextprotocol/ext-server-card/blob/526201bbc80231daa40ffcdecfc9da4e54e5dc93/schema.json',
  retrieved: '2026-10-24',
} as const;

export interface ServerCardInput {
  description?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  value?: string;
}

export interface ServerCardRemote {
  type: 'streamable-http' | 'sse';
  url: string;
  headers?: Array<ServerCardInput & { name: string; variables?: Record<string, ServerCardInput> }>;
  variables?: Record<string, ServerCardInput>;
  supportedProtocolVersions?: string[];
}

export interface ServerCard {
  $schema: string;
  name: string;
  version: string;
  description: string;
  title?: string;
  websiteUrl?: string;
  remotes?: ServerCardRemote[];
  [key: string]: unknown;
}

export interface ServerCardValidation {
  valid: boolean;
  /** Schema violations; a card with any is invalid. */
  errors: string[];
  /** Valid by the schema, but clients will struggle with it. */
  warnings: string[];
  card?: ServerCard;
}

const validator = new Validator(serverCardSchema as Record<string, unknown>, '2020-12', false);

// Keyword failures that only say "a nested $ref/properties/items failed" repeat a more specific error.
const WRAPPER_KEYWORDS = new Set(['properties', '$ref', 'allOf', 'items', 'additionalProperties', 'if', 'then', 'else']);

const describeSchemaErrors = (errors: OutputUnit[]): string[] => {
  const specific = errors.filter(error => !WRAPPER_KEYWORDS.has(error.keyword));
  const messages = (specific.length > 0 ? specific : errors).map(error => {
    const location = error.instanceLocation.replace(/^#\/?/, '') || 'card';
    return `${location}: ${error.error}`;
  });
  return Array.from(new Set(messages)).slice(0, 12);
};

const TEMPLATE_VARIABLE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const HAS_TEMPLATE_VARIABLE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;

/**
 * The URL a client would connect to: template variables replaced by their
 * defaults. Undefined when a variable has no default (the user must supply it).
 */
export const resolveRemoteUrl = (remote: ServerCardRemote): string | undefined => {
  let unresolved = false;
  const url = remote.url.replace(TEMPLATE_VARIABLE, (_match, name: string) => {
    const fallback = remote.variables?.[name]?.default;
    if (typeof fallback !== 'string' || !fallback) {
      unresolved = true;
      return '';
    }
    return encodeURIComponent(fallback);
  });
  if (unresolved) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

const isLoopbackHost = (hostname: string): boolean => (
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
);

const remoteWarnings = (remotes: ServerCardRemote[]): string[] => {
  const warnings: string[] = [];
  if (remotes.length === 0) {
    warnings.push('remotes is missing or empty: the card names a server but gives clients no endpoint to connect to.');
  }
  remotes.forEach((remote, index) => {
    const label = `remotes/${index}`;
    if (remote.type === 'sse') {
      warnings.push(`${label}: the legacy HTTP+SSE transport is deprecated; advertise a streamable-http endpoint.`);
    }
    const resolved = resolveRemoteUrl(remote);
    if (!resolved) {
      if (!HAS_TEMPLATE_VARIABLE.test(remote.url)) warnings.push(`${label}: url is not an absolute http(s) URL.`);
      return;
    }
    const parsed = new URL(resolved);
    if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
      warnings.push(`${label}: ${resolved} uses plain http; remote MCP servers must be served over HTTPS.`);
    }
    if (parsed.username || parsed.password) {
      warnings.push(`${label}: the URL carries credentials; a public card must not.`);
    }
  });
  return warnings;
};

/** Validates a parsed JSON value as a v1 Server Card. */
export const validateServerCard = (value: unknown): ServerCardValidation => {
  const result = validator.validate(value);
  if (!result.valid) {
    const errors = describeSchemaErrors(result.errors);
    const schemaValue = (value as { $schema?: unknown } | null)?.$schema;
    if (value && typeof value === 'object' && typeof schemaValue === 'string' && schemaValue !== SERVER_CARD_SCHEMA_URL) {
      errors.unshift(`$schema must be ${SERVER_CARD_SCHEMA_URL} (found ${schemaValue}).`);
    }
    return { valid: false, errors: Array.from(new Set(errors)), warnings: [] };
  }
  const card = value as ServerCard;
  return { valid: true, errors: [], warnings: remoteWarnings(card.remotes ?? []), card };
};

/** A minimal valid card for a server at `endpoint`, as fix guidance. */
export const buildMinimalServerCard = (domain: string, endpoint?: string): ServerCard => {
  const host = domain.replace(/:\d+$/, '').toLowerCase();
  const namespace = host.split('.').filter(Boolean).reverse().join('.') || 'com.example';
  return {
    $schema: SERVER_CARD_SCHEMA_URL,
    name: `${namespace}/mcp`,
    version: '1.0.0',
    description: `Remote MCP server for ${host}.`.slice(0, 100),
    remotes: [{ type: 'streamable-http', url: endpoint ?? `https://${domain}/mcp` }],
  };
};
