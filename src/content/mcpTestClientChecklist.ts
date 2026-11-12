/**
 * The /mcp-test-client protocol checklist: for each public fixture, what a
 * correct MCP client does and the HTTP exchange to compare its log against.
 * McpTestClientView renders it; the exchanges are replayed against the
 * worker by src/content/mcpTestClientExchanges.test.ts.
 *
 * Protocol statements follow the guides in src/content/articles
 * (mcp-protocol-versions-explained.md, mcp-json-rpc-error-codes.md,
 * mcp-tool-output-schemas-and-structured-content.md) and the fixture code in
 * cloudflare-worker/src/fixtures.js and fixtureServers.js.
 */
import { PUBLIC_FIXTURE_BEARER_TOKEN, PUBLIC_FIXTURE_MAX_DELAY_MS, type PublicFixtureId } from '../data/publicFixtures.ts';
import {
  BEARER_HEADER,
  ISSUED_SESSION_ID,
  STATEFUL_HEADERS,
  STATEFUL_VERSION,
  STATELESS_META,
  STATELESS_VERSION,
  UNKNOWN_SESSION_ID,
  initializeRequest,
  rpc,
  rpcError,
  rpcResult,
  serverInfo,
  statefulResultHeaders,
  structuredResult,
  type HttpExchange,
} from './mcpTestClientExchanges.ts';

export interface ChecklistItem {
  id: string;
  /** The behavior, phrased as a check a developer can tick. */
  check: string;
  /** Why it matters and what to look for, in a sentence or two. */
  detail: string;
  exchanges: readonly HttpExchange[];
}

export interface FixtureChecklist {
  fixture: PublicFixtureId;
  heading: string;
  intro: string;
  items: readonly ChecklistItem[];
}

const ALL_VERSIONS = [STATELESS_VERSION, '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ECHO_INSTRUCTIONS = 'Deterministic public test server. Tools: echo, add, whoami, headers. One static resource and one prompt.';
const ECHO_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
  prompts: { listChanged: false },
};
const ECHO_SERVER_INFO = serverInfo('echo', 'mcptest.io echo fixture');
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const UNAUTHORIZED_BODY = rpcError(null, -32001, `Unauthorized: send Authorization: Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}`);
const REALM = 'realm="mcptest.io fixtures"';

const ECHO_ITEMS: readonly ChecklistItem[] = [
  {
    id: 'initialize',
    check: 'Completes initialize, then sends notifications/initialized',
    detail: 'The 2025 handshake is an initialize request, its result, then the notifications/initialized notification before any other request. The fixture answers the notification with an empty 202. It keeps no state, so it cannot tell whether you sent it: check that the notification appears in your client\'s log.',
    exchanges: [
      {
        id: 'echo-initialize',
        fixture: 'echo',
        caption: 'initialize, asking for the newest stateful revision:',
        request: { headers: {}, body: initializeRequest(1) },
        response: {
          status: 200,
          headers: { 'MCP-Protocol-Version': STATEFUL_VERSION, 'Mcp-Session-Id': ISSUED_SESSION_ID },
          body: rpcResult(1, {
            protocolVersion: STATEFUL_VERSION,
            capabilities: ECHO_CAPABILITIES,
            serverInfo: ECHO_SERVER_INFO,
            instructions: ECHO_INSTRUCTIONS,
          }),
        },
      },
      {
        id: 'echo-initialized',
        fixture: 'echo',
        caption: 'notifications/initialized, with the session ID from the response above:',
        request: { headers: STATEFUL_HEADERS, body: { jsonrpc: '2.0', method: 'notifications/initialized' } },
        response: { status: 202 },
      },
    ],
  },
  {
    id: 'negotiate',
    check: 'Negotiates the protocol version and sends it on every request',
    detail: `If the server answers initialize with a different protocolVersion, the client uses that version or disconnects if it does not support it. After the handshake every HTTP request carries MCP-Protocol-Version with the negotiated value. A 2026-capable client instead starts with server/discover and reads supportedVersions; the fixture lists ${STATELESS_VERSION} first.`,
    exchanges: [
      {
        id: 'echo-initialize-unknown-version',
        fixture: 'echo',
        caption: 'initialize with a version the fixture does not know: it answers with its own default, and the client must accept it or disconnect.',
        request: { headers: {}, body: initializeRequest(1, '2099-01-01') },
        response: {
          status: 200,
          headers: { 'MCP-Protocol-Version': STATEFUL_VERSION, 'Mcp-Session-Id': ISSUED_SESSION_ID },
          body: rpcResult(1, {
            protocolVersion: STATEFUL_VERSION,
            capabilities: ECHO_CAPABILITIES,
            serverInfo: ECHO_SERVER_INFO,
            instructions: ECHO_INSTRUCTIONS,
          }),
        },
      },
      {
        id: 'echo-discover',
        fixture: 'echo',
        caption: `server/discover, the stateless ${STATELESS_VERSION} entry point: no session, and the version travels in _meta and in the header.`,
        request: {
          headers: { 'MCP-Protocol-Version': STATELESS_VERSION, 'Mcp-Method': 'server/discover' },
          body: rpc(1, 'server/discover', { _meta: STATELESS_META }),
        },
        response: {
          status: 200,
          headers: { 'MCP-Protocol-Version': STATELESS_VERSION },
          body: rpcResult(1, {
            supportedVersions: ALL_VERSIONS,
            capabilities: ECHO_CAPABILITIES,
            instructions: ECHO_INSTRUCTIONS,
            resultType: 'complete',
            ttlMs: 0,
            cacheScope: 'public',
            _meta: { 'io.modelcontextprotocol/serverInfo': ECHO_SERVER_INFO },
          }),
        },
      },
      {
        id: 'echo-header-mismatch',
        fixture: 'echo',
        caption: 'A stateless request whose Mcp-Method header disagrees with the body gets -32020:',
        request: {
          headers: { 'MCP-Protocol-Version': STATELESS_VERSION, 'Mcp-Method': 'tools/list' },
          body: rpc(2, 'tools/call', { name: 'echo', arguments: { message: 'hi' }, _meta: STATELESS_META }),
        },
        response: { status: 400, body: rpcError(2, -32020, 'Mcp-Method header does not match the JSON-RPC method') },
      },
    ],
  },
  {
    id: 'session',
    check: 'Sends the Mcp-Session-Id it was given on every stateful request',
    detail: 'In the stateful flow the session ID from the initialize response goes on every later request, notifications included. A missing ID is a 400; an ID the server did not issue is a 404, which tells a client to start a new session with initialize.',
    exchanges: [
      {
        id: 'echo-missing-session',
        fixture: 'echo',
        caption: 'tools/list without the session header:',
        request: { headers: { 'MCP-Protocol-Version': STATEFUL_VERSION }, body: rpc(2, 'tools/list') },
        response: {
          status: 400,
          body: rpcError(2, -32600, 'Bad Request: Mcp-Session-Id header is required; send initialize first, or server/discover for the stateless revision'),
        },
      },
      {
        id: 'echo-unknown-session',
        fixture: 'echo',
        caption: 'tools/list with a session ID the fixture did not issue:',
        request: { headers: { 'MCP-Protocol-Version': STATEFUL_VERSION, 'Mcp-Session-Id': UNKNOWN_SESSION_ID }, body: rpc(2, 'tools/list') },
        response: { status: 404, body: rpcError(2, -32001, 'Session not found') },
      },
    ],
  },
  {
    id: 'tools',
    check: 'Lists tools and calls them with arguments that match the input schema',
    detail: 'tools/list returns echo, add, whoami and headers. A client should show each tool with its schema and send arguments as JSON values of the declared types: add takes numbers, not strings. add also returns structuredContent next to the text.',
    exchanges: [
      {
        id: 'echo-tools-list',
        fixture: 'echo',
        caption: 'tools/list:',
        abbreviated: 'Abbreviated: the real response also carries descriptions, add\'s outputSchema and annotations on every tool.',
        request: { headers: STATEFUL_HEADERS, body: rpc(2, 'tools/list') },
        response: {
          status: 200,
          headers: statefulResultHeaders,
          body: rpcResult(2, {
            tools: [
              {
                name: 'echo',
                title: 'Echo',
                inputSchema: {
                  type: 'object',
                  properties: { message: { type: 'string', maxLength: 1000, description: 'Text to echo back.' } },
                  required: ['message'],
                  additionalProperties: false,
                },
              },
              {
                name: 'add',
                title: 'Add',
                inputSchema: {
                  type: 'object',
                  properties: { a: { type: 'number', description: 'First addend.' }, b: { type: 'number', description: 'Second addend.' } },
                  required: ['a', 'b'],
                  additionalProperties: false,
                },
              },
              { name: 'whoami', title: 'Who am I', inputSchema: NO_ARGS },
              { name: 'headers', title: 'Request headers', inputSchema: NO_ARGS },
            ],
          }),
        },
      },
      {
        id: 'echo-tools-call-add',
        fixture: 'echo',
        caption: 'tools/call add:',
        request: { headers: STATEFUL_HEADERS, body: rpc(3, 'tools/call', { name: 'add', arguments: { a: 2, b: 3 } }) },
        response: {
          status: 200,
          headers: statefulResultHeaders,
          body: rpcResult(3, { content: [{ type: 'text', text: '5' }], structuredContent: { sum: 5 } }),
        },
      },
    ],
  },
];

const AUTH_ITEMS: readonly ChecklistItem[] = [
  {
    id: 'auth-challenge',
    check: 'Handles a 401 with WWW-Authenticate instead of retrying blindly',
    detail: 'Without a token the fixture answers 401 with a Bearer challenge. A client should stop and ask for credentials, or report that the server needs a token. The challenge has no resource_metadata and there is no OAuth metadata, so a client that tries OAuth discovery must fail with a clear message rather than loop.',
    exchanges: [
      {
        id: 'auth-missing-token',
        fixture: 'auth-bearer',
        caption: 'initialize with no Authorization header:',
        request: { headers: {}, body: initializeRequest(1) },
        response: { status: 401, headers: { 'WWW-Authenticate': `Bearer ${REALM}` }, body: UNAUTHORIZED_BODY },
      },
      {
        id: 'auth-wrong-token',
        fixture: 'auth-bearer',
        caption: 'A wrong token adds error="invalid_token" to the challenge:',
        request: { headers: { Authorization: 'Bearer not-the-token' }, body: initializeRequest(1) },
        response: {
          status: 401,
          headers: { 'WWW-Authenticate': `Bearer ${REALM}, error="invalid_token", error_description="Use the public token ${PUBLIC_FIXTURE_BEARER_TOKEN}"` },
          body: UNAUTHORIZED_BODY,
        },
      },
    ],
  },
  {
    id: 'auth-every-request',
    check: 'Sends the bearer token on every request, not only on initialize',
    detail: `Configure the static header Authorization: ${BEARER_HEADER}. The fixture checks it before anything else, so a notification or tool call without it gets the same 401 even inside a valid session.`,
    exchanges: [
      {
        id: 'auth-initialize',
        fixture: 'auth-bearer',
        caption: 'initialize with the public token:',
        request: { headers: { Authorization: BEARER_HEADER }, body: initializeRequest(1) },
        response: {
          status: 200,
          headers: { 'MCP-Protocol-Version': STATEFUL_VERSION, 'Mcp-Session-Id': ISSUED_SESSION_ID },
          body: rpcResult(1, {
            protocolVersion: STATEFUL_VERSION,
            capabilities: ECHO_CAPABILITIES,
            serverInfo: serverInfo('auth-bearer', 'mcptest.io bearer-auth fixture'),
            instructions: `Same tools as the echo fixture. Requires Authorization: ${BEARER_HEADER} (a documented public token).`,
          }),
        },
      },
      {
        id: 'auth-notification-without-token',
        fixture: 'auth-bearer',
        caption: 'notifications/initialized in that session, but without the header:',
        request: { headers: STATEFUL_HEADERS, body: { jsonrpc: '2.0', method: 'notifications/initialized' } },
        response: { status: 401, headers: { 'WWW-Authenticate': `Bearer ${REALM}` }, body: UNAUTHORIZED_BODY },
      },
    ],
  },
];

const errorCall = (id: number, name: string) => rpc(id, 'tools/call', { name, arguments: {} });

const ERRORS_ITEMS: readonly ChecklistItem[] = [
  {
    id: 'errors-protocol',
    check: 'Shows JSON-RPC errors as failed requests',
    detail: 'protocol_error and invalid_params answer with a JSON-RPC error object and HTTP 200. There is no result: the client should report the code and message as an error, not hand an empty result to the model.',
    exchanges: [
      {
        id: 'errors-protocol-error',
        fixture: 'errors',
        caption: 'tools/call protocol_error:',
        request: { headers: STATEFUL_HEADERS, body: errorCall(4, 'protocol_error') },
        response: { status: 200, body: rpcError(4, -32603, 'Deterministic protocol error from the errors fixture', { fixture: 'errors' }) },
      },
      {
        id: 'errors-invalid-params',
        fixture: 'errors',
        caption: 'tools/call invalid_params:',
        request: { headers: STATEFUL_HEADERS, body: errorCall(5, 'invalid_params') },
        response: { status: 200, body: rpcError(5, -32602, 'Invalid params: deterministic error from the errors fixture', { fixture: 'errors' }) },
      },
    ],
  },
  {
    id: 'errors-is-error',
    check: 'Passes isError tool results to the model as a failed tool result',
    detail: 'tool_error is a successful JSON-RPC response whose result has isError: true. It is a tool execution error the model can read and react to, so the client should show it as a failed call with its text, not as a transport or protocol failure.',
    exchanges: [
      {
        id: 'errors-tool-error',
        fixture: 'errors',
        caption: 'tools/call tool_error:',
        request: { headers: STATEFUL_HEADERS, body: errorCall(6, 'tool_error') },
        response: {
          status: 200,
          headers: statefulResultHeaders,
          body: rpcResult(6, { content: [{ type: 'text', text: 'Deterministic tool execution error from the errors fixture.' }], isError: true }),
        },
      },
    ],
  },
  {
    id: 'errors-http',
    check: 'Reports an HTTP 500 and keeps the connection usable',
    detail: 'http_500 fails at the HTTP layer, with a JSON-RPC error in the body. The client should surface the status, and the next request in the same session should work: one failed call is not a reason to drop the session.',
    exchanges: [
      {
        id: 'errors-http-500',
        fixture: 'errors',
        caption: 'tools/call http_500:',
        request: { headers: STATEFUL_HEADERS, body: errorCall(7, 'http_500') },
        response: { status: 500, body: rpcError(7, -32603, 'Internal error: deterministic HTTP 500 from the errors fixture') },
      },
    ],
  },
];

const SLOW_ITEMS: readonly ChecklistItem[] = [
  {
    id: 'slow-timeout',
    check: 'Enforces a request timeout and cancels cleanly',
    detail: `sleep waits for ms milliseconds, capped at ${PUBLIC_FIXTURE_MAX_DELAY_MS.toLocaleString('en-US')}. Set your client timeout below the delay: it should give up, tell the user, and cancel the request. In the stateful flow that is a notifications/cancelled with the request ID, which the fixture accepts with 202; in the stateless flow closing the response stream is the cancellation.`,
    exchanges: [
      {
        id: 'slow-sleep',
        fixture: 'slow',
        caption: 'tools/call sleep, which answers after about two seconds:',
        request: { headers: STATEFUL_HEADERS, body: rpc(8, 'tools/call', { name: 'sleep', arguments: { ms: 2000 } }) },
        response: {
          status: 200,
          headers: statefulResultHeaders,
          body: rpcResult(8, structuredResult({ requestedMs: 2000, sleptMs: 2000, capped: false })),
        },
      },
      {
        id: 'slow-cancelled',
        fixture: 'slow',
        caption: 'The cancellation a stateful client sends when its timeout fires first:',
        request: {
          headers: STATEFUL_HEADERS,
          body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 8, reason: 'Request timed out' } },
        },
        response: { status: 202 },
      },
    ],
  },
  {
    id: 'slow-progress',
    check: 'Accepts an SSE response and handles progress notifications',
    detail: 'With a progressToken in _meta and text/event-stream in Accept, progress answers with an event stream: one notifications/progress per step, then the result. The client should parse both response types, match the token, show or log progress, and may reset its timeout on each notification while keeping an overall limit.',
    exchanges: [
      {
        id: 'slow-progress-stream',
        fixture: 'slow',
        caption: 'tools/call progress with two steps:',
        request: {
          headers: STATEFUL_HEADERS,
          body: rpc(9, 'tools/call', { name: 'progress', arguments: { steps: 2 }, _meta: { progressToken: 'p1' } }),
        },
        response: {
          status: 200,
          headers: statefulResultHeaders,
          events: [
            { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 1, total: 2, message: 'Step 1 of 2' } },
            { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 2, total: 2, message: 'Step 2 of 2' } },
            rpcResult(9, { content: [{ type: 'text', text: 'Completed 2 steps.' }] }),
          ],
        },
      },
    ],
  },
];

const ORDER_ARGUMENTS = {
  customer: { name: 'Ada', tier: 'pro' },
  items: [
    { sku: 'ABC-123', quantity: 2, unitPrice: 9.5, options: ['gift-wrap'] },
    { sku: 'XYZ-789', quantity: 1, unitPrice: 20 },
  ],
  shipping: { street: '1 Main St', city: 'London', country: 'GB' },
};

const SCHEMAS_ITEMS: readonly ChecklistItem[] = [
  {
    id: 'schemas-input',
    check: 'Represents nested, enum, array and optional input fields faithfully',
    detail: 'create_order nests an object, an array of objects with a pattern and number ranges, an optional shipping address with an enum, and optional fields. classify accepts values of any JSON type. A client should pass the schema to the model or build its form from it without dropping enums, nesting or required lists, and send nulls, objects and arrays as JSON rather than strings.',
    exchanges: [
      {
        id: 'schemas-classify',
        fixture: 'schemas',
        caption: 'tools/call classify with one value of each JSON type:',
        request: {
          headers: STATEFUL_HEADERS,
          body: rpc(10, 'tools/call', { name: 'classify', arguments: { values: ['a', 1, true, null, { k: 'v' }, [1]], mode: 'list' } }),
        },
        response: {
          status: 200,
          headers: statefulResultHeaders,
          body: rpcResult(10, structuredResult({
            total: 6,
            counts: { string: 1, number: 1, boolean: 1, null: 1, object: 1, array: 1 },
            types: ['string', 'number', 'boolean', 'null', 'object', 'array'],
          })),
        },
      },
      {
        id: 'schemas-invalid',
        fixture: 'schemas',
        caption: 'Arguments that break the schema get -32602 with the failing paths:',
        request: {
          headers: STATEFUL_HEADERS,
          body: rpc(11, 'tools/call', {
            name: 'create_order',
            arguments: { customer: { name: 'Ada', tier: 'gold' }, items: [{ sku: 'abc', quantity: 0, unitPrice: 5 }] },
          }),
        },
        response: {
          status: 200,
          body: rpcError(11, -32602, 'Invalid params for tool create_order', {
            errors: [
              { path: '/customer/tier', message: 'expected one of ["free","pro","enterprise"]' },
              { path: '/items/0/sku', message: 'does not match ^[A-Z]{3}-[0-9]{3}$' },
              { path: '/items/0/quantity', message: 'below minimum 1' },
            ],
          }),
        },
      },
    ],
  },
  {
    id: 'schemas-output',
    check: 'Reads structuredContent and validates it against outputSchema',
    detail: 'Tools with an outputSchema return structuredContent that conforms to it, plus the same JSON as text for older clients. A client that supports structured output should validate structuredContent against the advertised schema and prefer it over parsing the text.',
    exchanges: [
      {
        id: 'schemas-create-order',
        fixture: 'schemas',
        caption: 'tools/call create_order, a dry run with a deterministic quote:',
        request: { headers: STATEFUL_HEADERS, body: rpc(12, 'tools/call', { name: 'create_order', arguments: ORDER_ARGUMENTS }) },
        response: {
          status: 200,
          headers: statefulResultHeaders,
          body: rpcResult(12, structuredResult({
            orderId: 'ORD-003-123789',
            itemCount: 3,
            subtotal: 39,
            discount: 3.9,
            total: 35.1,
            currency: 'USD',
            shipsTo: 'London, GB',
          })),
        },
      },
    ],
  },
];

export const CLIENT_CHECKLISTS: readonly FixtureChecklist[] = [
  {
    fixture: 'echo',
    heading: 'Echo: handshake, version negotiation and tool calls',
    intro: 'Start here. If your client cannot complete these against the echo fixture, nothing else on this page will work.',
    items: ECHO_ITEMS,
  },
  {
    fixture: 'auth-bearer',
    heading: 'Bearer auth: static headers and 401 handling',
    intro: `The echo tools behind the public token ${PUBLIC_FIXTURE_BEARER_TOKEN}. Connect once without it and once with it.`,
    items: AUTH_ITEMS,
  },
  {
    fixture: 'errors',
    heading: 'Errors: JSON-RPC errors versus isError results',
    intro: 'Connecting and tools/list succeed; every tools/call fails in a different, fixed way. The examples continue a session started with initialize.',
    items: ERRORS_ITEMS,
  },
  {
    fixture: 'slow',
    heading: 'Slow: timeouts and progress',
    intro: 'Bounded delays and a streamed progress tool, for checking that your client neither hangs nor gives up too early.',
    items: SLOW_ITEMS,
  },
  {
    fixture: 'schemas',
    heading: 'Schemas: complex inputs and structuredContent',
    intro: 'Tools with nested, enum, array and optional fields, an outputSchema and structuredContent.',
    items: SCHEMAS_ITEMS,
  },
];

