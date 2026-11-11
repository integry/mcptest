/**
 * The public MCP test servers ("fixtures") the Cloudflare worker serves at
 * https://mcptest.io/fixtures/<id>/mcp: their URLs, tools and documented
 * behavior, for the /mcp-test-servers page, the landing "Try with" preset
 * and llms.txt.
 *
 * The worker's own definitions live in cloudflare-worker/src/fixtureServers.js
 * (tools) and cloudflare-worker/src/fixtures.js (protocol versions, limits);
 * src/data/publicFixtures.test.ts fails when this module disagrees with them.
 *
 * No runtime imports: scripts/generate-seo-pages.js loads this file through
 * Node's require, like src/content/navigationLinks.ts.
 */

export const PUBLIC_FIXTURE_ORIGIN = 'https://mcptest.io';

/** The documented public token of the auth-bearer fixture. It is not a secret. */
export const PUBLIC_FIXTURE_BEARER_TOKEN = 'mcptest-public-token';
export const PUBLIC_FIXTURE_MAX_DELAY_MS = 10_000;
export const PUBLIC_FIXTURE_MAX_BODY_BYTES = 16 * 1024;
export const PUBLIC_FIXTURE_STATELESS_VERSION = '2026-07-28';
/** Stateful revisions `initialize` accepts, newest first; the first is the default. */
export const PUBLIC_FIXTURE_STATEFUL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

export type PublicFixtureId = 'echo' | 'auth-bearer' | 'errors' | 'slow' | 'schemas';

export interface PublicFixtureTool {
  name: string;
  /** What calling the tool does, in the page's words. */
  summary: string;
}

export interface PublicFixture {
  id: PublicFixtureId;
  /** Display name on the page and the landing preset. */
  name: string;
  url: string;
  /** One line: what the fixture is for. */
  purpose: string;
  tools: readonly PublicFixtureTool[];
  resources: readonly string[];
  prompts: readonly string[];
  /** What a client should observe; one sentence each. */
  behavior: readonly string[];
  auth?: { type: 'bearer'; token: string };
}

export const getPublicFixtureUrl = (id: PublicFixtureId): string => `${PUBLIC_FIXTURE_ORIGIN}/fixtures/${id}/mcp`;

const BASIC_TOOLS: readonly PublicFixtureTool[] = [
  { name: 'echo', summary: 'Returns the message argument unchanged (at most 1,000 characters).' },
  { name: 'add', summary: 'Adds the numbers a and b and returns the sum as text and as structuredContent { sum }.' },
  { name: 'whoami', summary: 'Returns the negotiated protocol version, stateless or stateful era, client info and selected request headers.' },
  { name: 'headers', summary: 'Lists the request header names the server received. Credentials and cookies are never echoed.' },
];

export const PUBLIC_FIXTURES: readonly PublicFixture[] = [
  {
    id: 'echo',
    name: 'Echo',
    url: getPublicFixtureUrl('echo'),
    purpose: 'A no-auth MCP server with tools, a resource and a prompt: the quickest way to check that a client connects, lists and calls tools.',
    tools: BASIC_TOOLS,
    resources: ['mcptest://fixtures/readme'],
    prompts: ['greeting'],
    behavior: [
      'Connects without credentials over Streamable HTTP.',
      'echo returns exactly the text you send; add {"a": 2, "b": 3} returns 5 with structuredContent {"sum": 5}.',
      'whoami shows which protocol revision your client negotiated, so you can see whether it used the stateless or the stateful flow.',
      'resources/read on mcptest://fixtures/readme returns a fixed text file; prompts/get greeting returns one user message.',
    ],
  },
  {
    id: 'auth-bearer',
    name: 'Bearer auth',
    url: getPublicFixtureUrl('auth-bearer'),
    purpose: `The echo tools behind a fixed bearer token, for testing how a client sends static headers and handles a 401.`,
    tools: BASIC_TOOLS,
    resources: ['mcptest://fixtures/readme'],
    prompts: ['greeting'],
    behavior: [
      `Send Authorization: Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}. The token is public and documented here; it protects nothing.`,
      'Without the header the server answers 401 with WWW-Authenticate: Bearer realm="mcptest.io fixtures".',
      'A wrong token gets 401 with error="invalid_token" in the challenge.',
      'There is no OAuth metadata, so a client that only supports OAuth sign-in cannot connect.',
    ],
    auth: { type: 'bearer', token: PUBLIC_FIXTURE_BEARER_TOKEN },
  },
  {
    id: 'errors',
    name: 'Errors',
    url: getPublicFixtureUrl('errors'),
    purpose: 'Every tool fails in a different, fixed way, for testing how a client reports protocol errors, tool errors and HTTP failures.',
    tools: [
      { name: 'protocol_error', summary: 'Answers with a JSON-RPC error response, code -32603, instead of a result.' },
      { name: 'tool_error', summary: 'Returns a normal tool result with isError: true and an error message as text.' },
      { name: 'invalid_params', summary: 'Answers with a JSON-RPC invalid params error, code -32602.' },
      { name: 'http_500', summary: 'Answers the HTTP request with status 500 and a JSON-RPC internal error body.' },
    ],
    resources: [],
    prompts: [],
    behavior: [
      'Connecting and tools/list succeed; only tools/call fails.',
      'A good client shows tool_error as a failed tool result the model can read, and the other three as errors.',
      'The connection stays usable after each failure.',
    ],
  },
  {
    id: 'slow',
    name: 'Slow',
    url: getPublicFixtureUrl('slow'),
    purpose: 'Bounded delays and progress notifications, for testing client timeouts and progress display.',
    tools: [
      { name: 'sleep', summary: `Waits ms milliseconds (capped at ${PUBLIC_FIXTURE_MAX_DELAY_MS.toLocaleString('en-US')}) and returns requestedMs, sleptMs and capped.` },
      { name: 'progress', summary: 'Streams one notifications/progress per step over SSE when the request has a progressToken (1 to 10 steps, default 3).' },
    ],
    resources: [],
    prompts: [],
    behavior: [
      `sleep {"ms": 2000} returns after about two seconds; values above ${PUBLIC_FIXTURE_MAX_DELAY_MS} ms are capped and reported as capped: true.`,
      'progress answers with Content-Type: text/event-stream when the client accepts it, sending each progress notification before the result.',
      'Set your client timeout below the delay to check that it gives up cleanly.',
    ],
  },
  {
    id: 'schemas',
    name: 'Schemas',
    url: getPublicFixtureUrl('schemas'),
    purpose: 'Tools with nested objects, enums, arrays, patterns and optional fields, plus outputSchema and structuredContent, for testing input forms and output validation.',
    tools: [
      { name: 'create_order', summary: 'Validates a nested order (customer, items, optional shipping address) and returns a deterministic quote. Nothing is stored.' },
      { name: 'classify', summary: 'Counts the JSON types in a list of mixed values, optionally listing the type of each one.' },
    ],
    resources: [],
    prompts: [],
    behavior: [
      'Arguments that break the input schema get a JSON-RPC -32602 error listing the failing paths.',
      'Valid calls return structuredContent that matches the advertised outputSchema, plus the same JSON as text.',
      'The same input always produces the same quote, so results can be compared in tests.',
    ],
  },
];

export const getPublicFixture = (id: PublicFixtureId): PublicFixture => {
  const fixture = PUBLIC_FIXTURES.find(candidate => candidate.id === id);
  if (!fixture) throw new Error(`Unknown public fixture ${id}`);
  return fixture;
};

/**
 * The fixture offered first in the landing "Try with" row and the suggested
 * servers panel: mcptest's own no-auth echo server, which supports the
 * stateless 2026 revision.
 */
export const LANDING_FIXTURE = {
  id: 'mcptest-echo',
  name: 'mcptest echo',
  description: 'mcptest.io’s own public test server: echo, add, whoami and headers tools, no sign-in.',
  url: getPublicFixtureUrl('echo'),
  logoUrl: '/logo-96.png',
  protocolEra: 'stateless',
  transport: 'streamable-http',
} as const;
