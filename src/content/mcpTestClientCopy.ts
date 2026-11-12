/**
 * Copy for /mcp-test-client: the lede, how to connect, the whoami/headers
 * self-check, the FAQ and related links. McpTestClientView renders it with
 * the checklist in mcpTestClientChecklist.ts; scripts/generate-seo-pages.js
 * builds the FAQPage JSON-LD from MCP_TEST_CLIENT_FAQ.
 */
import { PUBLIC_FIXTURE_BEARER_TOKEN, getPublicFixtureUrl } from '../data/publicFixtures.ts';
import {
  BEARER_HEADER,
  CLIENT_INFO,
  STATEFUL_HEADERS,
  STATEFUL_VERSION,
  STATELESS_META,
  STATELESS_VERSION,
  rpc,
  rpcResult,
  serverInfo,
  statefulResultHeaders,
  structuredResult,
  type HttpExchange,
} from './mcpTestClientExchanges.ts';

export const MCP_TEST_CLIENT_COPY = {
  heading: 'Test your MCP client',
  lede: 'Point the MCP client, agent or AI app you are building at mcptest.io’s public test servers and check it against a protocol checklist: the handshake, version negotiation, tool calls, bearer auth, errors, timeouts, progress and structured output.',
  intro: 'Each check below names the fixture to use, what a correct client does, and the exact HTTP request and response to compare with your client’s debug log or a proxy capture. The fixtures are deterministic, so the only thing that can differ is your client.',
  pageViewTitle: 'Test your MCP client',
} as const;

export const CONNECT_STEPS: readonly string[] = [
  `Add ${getPublicFixtureUrl('echo')} to your client as a remote Streamable HTTP server. No account or API key is needed.`,
  'Turn on your client’s protocol logging, or route it through a proxy that shows HTTP requests, so you can see the raw JSON-RPC.',
  'Work through the checklist one fixture at a time, swapping the URL: /fixtures/auth-bearer/mcp, /fixtures/errors/mcp, /fixtures/slow/mcp and /fixtures/schemas/mcp.',
  `For the auth-bearer fixture, configure the static header Authorization: ${BEARER_HEADER}. The token is public and protects nothing.`,
];

export const EXAMPLE_NOTES: readonly string[] = [
  `The examples use the stateful ${STATEFUL_VERSION} flow unless they say otherwise. A ${STATELESS_VERSION} client sends no initialize and no session; instead every request carries _meta with the protocol version and client capabilities, plus matching MCP-Protocol-Version, Mcp-Method and Mcp-Name headers.`,
  'Mcp-Session-Id: <Mcp-Session-Id from initialize> stands for the ID your client received. Issued IDs look like mcptest-fx- followed by a random part and a digest.',
  'Response headers shown are the MCP, session and auth headers; every response also carries CORS headers and Cache-Control: no-store.',
];

const WHOAMI_STATELESS_HEADERS = {
  'MCP-Protocol-Version': STATELESS_VERSION,
  'Mcp-Method': 'tools/call',
  'Mcp-Name': 'whoami',
  'User-Agent': 'my-client/1.0.0',
};

/** The self-check: run whoami and headers from your own client and read what the fixture received. */
export const SELF_CHECK_EXCHANGES: readonly HttpExchange[] = [
  {
    id: 'self-check-whoami-stateless',
    fixture: 'echo',
    caption: `whoami from a ${STATELESS_VERSION} client:`,
    request: {
      headers: WHOAMI_STATELESS_HEADERS,
      body: rpc(20, 'tools/call', { name: 'whoami', arguments: {}, _meta: STATELESS_META }),
    },
    response: {
      status: 200,
      headers: { 'MCP-Protocol-Version': STATELESS_VERSION },
      body: rpcResult(20, {
        ...structuredResult({
          fixture: 'echo',
          protocolEra: 'stateless',
          protocolVersion: STATELESS_VERSION,
          clientInfo: CLIENT_INFO,
          session: 'none',
          authorization: { present: false },
          headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-method': 'tools/call',
            'mcp-name': 'whoami',
            'mcp-protocol-version': STATELESS_VERSION,
            'user-agent': 'my-client/1.0.0',
          },
        }),
        resultType: 'complete',
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo('echo', 'mcptest.io echo fixture') },
      }),
    },
  },
  {
    id: 'self-check-whoami-stateful',
    fixture: 'auth-bearer',
    caption: `whoami from a stateful ${STATEFUL_VERSION} client on the auth-bearer fixture:`,
    request: {
      headers: { ...STATEFUL_HEADERS, Authorization: BEARER_HEADER, 'User-Agent': 'my-client/1.0.0' },
      body: rpc(21, 'tools/call', { name: 'whoami', arguments: {} }),
    },
    response: {
      status: 200,
      headers: statefulResultHeaders,
      body: rpcResult(21, structuredResult({
        fixture: 'auth-bearer',
        protocolEra: 'stateful',
        protocolVersion: STATEFUL_VERSION,
        session: 'present',
        authorization: { present: true, scheme: 'Bearer' },
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': STATEFUL_VERSION,
          'user-agent': 'my-client/1.0.0',
        },
      })),
    },
  },
  {
    id: 'self-check-headers',
    fixture: 'auth-bearer',
    caption: 'headers in the same session, listing every header name it received:',
    request: {
      headers: { ...STATEFUL_HEADERS, Authorization: BEARER_HEADER, 'User-Agent': 'my-client/1.0.0' },
      body: rpc(22, 'tools/call', { name: 'headers', arguments: {} }),
    },
    response: {
      status: 200,
      headers: statefulResultHeaders,
      body: rpcResult(22, structuredResult({
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: '[redacted]',
          'content-type': 'application/json',
          'mcp-protocol-version': STATEFUL_VERSION,
          'mcp-session-id': '[redacted]',
          'user-agent': 'my-client/1.0.0',
        },
        omitted: 0,
        note: 'Values are shown only for MCP and content-negotiation headers; credentials and cookies are never echoed.',
      })),
    },
  },
];

export interface SelfCheckField {
  field: string;
  meaning: string;
}

/** How to read the whoami and headers results. */
export const SELF_CHECK_FIELDS: readonly SelfCheckField[] = [
  { field: 'protocolEra, protocolVersion', meaning: `Which flow your client used and the version it sent. stateless means ${STATELESS_VERSION} with _meta; stateful means initialize and a session. The version should be the one your client negotiated, not a default it fell back to.` },
  { field: 'session', meaning: 'present when the request carried an Mcp-Session-Id, none in the stateless flow. A stateful client that shows no session never reaches whoami: the fixture answers 400 first.' },
  { field: 'clientInfo', meaning: 'The name and version from _meta, so only in the stateless flow. The fixture keeps no session state, so it cannot repeat what a stateful client sent in initialize.' },
  { field: 'authorization', meaning: 'Whether an Authorization header arrived and its scheme. The value is never echoed. On auth-bearer you only get this far with the right token.' },
  { field: 'headers (whoami)', meaning: 'Values of Accept, Content-Type, the MCP headers, Origin and User-Agent. Accept should list both application/json and text/event-stream; mcp-protocol-version should match the negotiated version.' },
  { field: 'headers (headers tool)', meaning: 'Every header name the fixture received, apart from CDN and proxy headers. Credential-shaped values show as [redacted] and other custom headers as [present], so you can confirm a static header was sent without exposing it.' },
];

export interface FaqEntry {
  question: string;
  answer: string;
}

export const MCP_TEST_CLIENT_FAQ: readonly FaqEntry[] = [
  {
    question: 'How do I test an MCP client?',
    answer: `Add the public fixture ${getPublicFixtureUrl('echo')} to your client, turn on protocol logging, and check the handshake, version negotiation and a tool call against the expected exchanges on this page. Then switch to the auth-bearer, errors, slow and schemas fixtures to check authentication, error handling, timeouts, progress and structured output.`,
  },
  {
    question: 'Does mcptest.io record my client’s traffic?',
    answer: 'No. The fixtures have no database or key-value storage and make no outbound requests, so there is nothing to look up later. The whoami and headers tools return what the server received in the tool result itself, only to your client, and never echo Authorization, Cookie or other credential values.',
  },
  {
    question: 'How can I tell whether my client sent notifications/initialized?',
    answer: 'Check your client’s log or a proxy capture. The fixture accepts the notification with HTTP 202, but it keeps no session state, so it cannot report whether the notification arrived or in which order.',
  },
  {
    question: 'Why does whoami show no clientInfo for my client?',
    answer: `clientInfo is reported only for ${STATELESS_VERSION} requests, which carry it in _meta on every request. A stateful client sends clientInfo once in initialize, and the fixture does not store it.`,
  },
  {
    question: 'What should my client do with the 401 from the auth-bearer fixture?',
    answer: `Stop and ask for credentials or report that a token is needed, without retrying in a loop. The WWW-Authenticate header is a plain Bearer challenge with no resource_metadata, so OAuth discovery has nothing to find. Configure Authorization: Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN} as a static header and reconnect.`,
  },
  {
    question: 'Can I run these checks in CI?',
    answer: 'Yes. Every fixture returns the same result for the same input, so a client test suite can connect to them and assert on results: echo for the happy path, errors for error mapping, slow for timeouts and schemas for structured output. They are public internet endpoints, so assert on results rather than latency.',
  },
];

export interface RelatedLink {
  path: string;
  label: string;
}

export const CLIENT_GUIDES: readonly RelatedLink[] = [
  { path: '/learn/add-remote-mcp-server-to-claude', label: 'Claude, Claude Code and Claude Desktop' },
  { path: '/learn/connect-mcp-server-to-chatgpt', label: 'ChatGPT' },
  { path: '/learn/connect-mcp-server-to-cursor', label: 'Cursor' },
  { path: '/learn/connect-mcp-server-to-vs-code', label: 'VS Code' },
  { path: '/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex', label: 'Windsurf, Gemini CLI and Codex' },
  { path: '/learn/connect-mcp-server-to-github-copilot-cli-and-coding-agent', label: 'GitHub Copilot CLI and coding agent' },
  { path: '/learn/connect-mcp-server-to-jetbrains-ai-assistant', label: 'JetBrains AI Assistant' },
  { path: '/learn/connect-mcp-server-to-zed', label: 'Zed' },
];

export const RELATED_GUIDES: readonly RelatedLink[] = [
  { path: '/mcp-test-servers', label: 'Public MCP test servers: URLs, tools and client configs' },
  { path: '/learn/mcp-client-support-matrix', label: 'Which clients support remote MCP servers' },
  { path: '/learn/mcp-clients-compared', label: 'MCP clients compared' },
  { path: '/learn/mcp-protocol-versions-explained', label: 'MCP protocol versions explained' },
  { path: '/learn/mcp-json-rpc-error-codes', label: 'MCP JSON-RPC error codes' },
  { path: '/learn/mcp-tool-output-schemas-and-structured-content', label: 'Tool output schemas and structured content' },
];
