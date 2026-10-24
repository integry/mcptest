/**
 * Presentation helpers for the public tool inventory on server pages. Shared
 * by the React profile and the prerendered HTML (scripts/generate-seo-pages.js
 * loads this file through Node's native require), so it has type-only imports.
 */
import type {
  CapabilityInventoryArgumentV1,
  CapabilityInventoryToolV1,
  CapabilityInventoryV1,
} from '../types/capabilityInventory';
import type { CatalogAuthType } from '../types/catalog';

export type ToolInventoryAvailability = 'observed' | 'requires-authorization' | 'not-observed';

interface InventoryServer {
  name: string;
  authType: CatalogAuthType;
  capabilityInventory?: CapabilityInventoryV1;
}

const CREDENTIAL_AUTH_TYPES: readonly CatalogAuthType[] = ['oauth', 'bearer-token', 'api-token', 'api-key'];

const AUTH_PHRASES: Partial<Record<CatalogAuthType, string>> = {
  oauth: 'OAuth 2.1 sign-in',
  'bearer-token': 'a bearer token',
  'api-token': 'an API token',
  'api-key': 'an API key',
};

/**
 * Whether the catalog holds an inventory for a server, and if not, why. The
 * validator lists capabilities only on servers that answer without credentials.
 */
export const getToolInventoryAvailability = (server: InventoryServer): ToolInventoryAvailability => {
  if (server.capabilityInventory) return 'observed';
  return CREDENTIAL_AUTH_TYPES.includes(server.authType) ? 'requires-authorization' : 'not-observed';
};

/** Heading and explanation shown in place of an inventory the validator could not record. */
export const getMissingInventoryNotice = (server: InventoryServer): { title: string; detail: string } => {
  if (getToolInventoryAvailability(server) === 'requires-authorization') {
    return {
      title: 'Requires authorization; inventory not observed',
      detail: `The catalog validator lists tools only on servers that answer without credentials. ${server.name} asks for ${AUTH_PHRASES[server.authType]} first, so its tools, resources and prompts were not observed. Connect in the Playground with your own credentials to list them.`,
    };
  }
  return {
    title: 'Inventory not observed',
    detail: `The catalog validator has not recorded a complete public tool listing for ${server.name}. Connect in the Playground to list its tools live.`,
  };
};

/** `name: type` for a required parameter, `name?: type` for an optional one. */
export const formatArgumentSignature = (argument: CapabilityInventoryArgumentV1): string =>
  `${argument.name}${argument.required ? '' : '?'}: ${argument.type ?? 'any'}`;

/** One-line input schema summary: parameter names and types. */
export const formatInputSummary = (input?: CapabilityInventoryArgumentV1[]): string =>
  input?.length ? input.map(formatArgumentSignature).join(', ') : 'No parameters';

export const formatOutputSchemaPresence = (tool: CapabilityInventoryToolV1): string => {
  if (tool.outputSchema === true) return 'outputSchema declared';
  if (tool.outputSchema === false) return 'No outputSchema';
  return 'outputSchema not recorded';
};

/** Calendar date of a snapshot, in UTC so the static page and the app agree. */
export const formatSnapshotDate = (observedAt: string): string => {
  const timestamp = new Date(observedAt);
  if (Number.isNaN(timestamp.getTime())) return observedAt;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(timestamp);
};

const FEATURE_DESCRIPTION_LIMIT = 160;

const firstSentence = (value: string): string => {
  const sentence = value.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? value;
  return sentence.length <= FEATURE_DESCRIPTION_LIMIT
    ? sentence
    : `${sentence.slice(0, FEATURE_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
};

/** schema.org `featureList` entries: each observed tool, then each prompt. */
export const getToolInventoryFeatureList = (inventory: CapabilityInventoryV1): string[] => [
  ...inventory.tools.items.map((tool) => (
    tool.description ? `${tool.name}: ${firstSentence(tool.description)}` : tool.name
  )),
  ...inventory.prompts.items.map((prompt) => `Prompt ${prompt.name}`),
];
