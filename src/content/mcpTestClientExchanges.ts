/**
 * The HTTP exchanges /mcp-test-client shows as "what your client's log should
 * look like": one request to a public fixture and the response the worker
 * sends back. They are data, not prose, so
 * src/content/mcpTestClientExchanges.test.ts can replay every request against
 * the worker's own handler (cloudflare-worker/src/fixtures.js) and fail when a
 * documented response drifts from what the fixture actually returns.
 *
 * No runtime imports beyond src/data/publicFixtures.ts: the SEO generator
 * loads this file through Node's require.
 */
import {
  PUBLIC_FIXTURE_BEARER_TOKEN,
  PUBLIC_FIXTURE_STATELESS_VERSION,
  PUBLIC_FIXTURE_STATEFUL_VERSIONS,
  type PublicFixtureId,
} from '../data/publicFixtures.ts';

/** Request placeholder for the session ID the client received from initialize. */
export const SESSION_ID_PLACEHOLDER = '<Mcp-Session-Id from initialize>';
/** Response placeholder for a freshly issued session ID (random part plus a digest). */
export const ISSUED_SESSION_ID = 'mcptest-fx-<32 hex>.<16 hex>';
/** A well-formed-looking session ID the fixture did not issue. */
export const UNKNOWN_SESSION_ID = 'mcptest-fx-00000000000000000000000000000000.0000000000000000';

export const STATEFUL_VERSION = PUBLIC_FIXTURE_STATEFUL_VERSIONS[0];
export const STATELESS_VERSION = PUBLIC_FIXTURE_STATELESS_VERSION;
export const CLIENT_INFO = { name: 'my-client', version: '1.0.0' } as const;
export const BEARER_HEADER = `Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}`;

export interface ExchangeRequest {
  /** Headers besides Content-Type: application/json and the Accept header every request sends. */
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface ExchangeResponse {
  status: number;
  /** MCP, auth and session headers the response carries; Content-Type is derived from the body. */
  headers?: Readonly<Record<string, string>>;
  /** A JSON body. */
  body?: unknown;
  /** Or a text/event-stream body: one `event: message` per JSON-RPC message, in order. */
  events?: readonly unknown[];
}

export interface HttpExchange {
  id: string;
  fixture: PublicFixtureId;
  /** One line above the exchange: what the request shows. */
  caption: string;
  request: ExchangeRequest;
  response: ExchangeResponse;
  /** Set when the response body is shortened on the page; the test then compares only what is shown. */
  abbreviated?: string;
}

/** Every request sends these; a client that leaves out text/event-stream cannot receive streamed results. */
export const BASE_REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;

export const STATEFUL_HEADERS = { 'MCP-Protocol-Version': STATEFUL_VERSION, 'Mcp-Session-Id': SESSION_ID_PLACEHOLDER } as const;
export const STATELESS_META = {
  'io.modelcontextprotocol/protocolVersion': STATELESS_VERSION,
  'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
  'io.modelcontextprotocol/clientCapabilities': {},
} as const;

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  202: 'Accepted',
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  500: 'Internal Server Error',
};

/** The request as an HTTP/1.1 message, the way a proxy or client debug log prints it. */
export const formatExchangeRequest = (exchange: HttpExchange): string => [
  `POST /fixtures/${exchange.fixture}/mcp HTTP/1.1`,
  'Host: mcptest.io',
  ...Object.entries({ ...BASE_REQUEST_HEADERS, ...exchange.request.headers }).map(([name, value]) => `${name}: ${value}`),
  '',
  JSON.stringify(exchange.request.body, null, 2),
].join('\n');

export const exchangeContentType = (response: ExchangeResponse): string | undefined => {
  if (response.events) return 'text/event-stream';
  return response.body === undefined ? undefined : 'application/json';
};

/** The SSE body as the fixture writes it, without the final blank line. */
export const formatEventStream = (events: readonly unknown[]): string =>
  events.map(event => `event: message\ndata: ${JSON.stringify(event)}`).join('\n\n');

export const formatExchangeResponse = (exchange: HttpExchange): string => {
  const { response } = exchange;
  const contentType = exchangeContentType(response);
  const head = [
    `HTTP/1.1 ${response.status} ${STATUS_TEXT[response.status] ?? ''}`.trimEnd(),
    ...(contentType ? [`Content-Type: ${contentType}`] : []),
    ...Object.entries(response.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
  ];
  if (response.events) return [...head, '', formatEventStream(response.events)].join('\n');
  if (response.body === undefined) return head.join('\n');
  return [...head, '', JSON.stringify(response.body, null, 2)].join('\n');
};

/** A tool result the way the fixtures build it: the JSON as text plus structuredContent. */
export const structuredResult = (value: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

/** The JSON-RPC envelope of a request. */
export const rpc = (id: number, method: string, params?: unknown) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

export const rpcResult = (id: number | null, result: unknown) => ({ jsonrpc: '2.0', id, result });
export const rpcError = (id: number | null, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

export const initializeRequest = (id: number, protocolVersion: string = STATEFUL_VERSION) =>
  rpc(id, 'initialize', { protocolVersion, capabilities: {}, clientInfo: CLIENT_INFO });

export const serverInfo = (fixture: PublicFixtureId, title: string) => ({
  name: `mcptest-fixture-${fixture}`,
  title,
  version: '1.0.0',
});

/** The headers a stateful 2025 result carries. */
export const statefulResultHeaders = { 'MCP-Protocol-Version': STATEFUL_VERSION } as const;
