/**
 * Copy for /mcp-test-servers: client setup snippets, curl examples and the
 * FAQ. McpTestServersView renders it, and scripts/generate-seo-pages.js
 * builds the page's FAQPage JSON-LD and llms.txt entries from the same data.
 *
 * The client config formats are the ones the connect-* guides document
 * (src/content/articles/add-remote-mcp-server-to-claude.md,
 * connect-mcp-server-to-cursor.md, connect-mcp-server-to-vs-code.md,
 * connect-mcp-server-to-windsurf-gemini-cli-and-codex.md and
 * connect-mcp-server-to-chatgpt.md). Every URL and token comes from
 * src/data/publicFixtures.ts.
 */
import {
  PUBLIC_FIXTURE_BEARER_TOKEN,
  PUBLIC_FIXTURE_MAX_BODY_BYTES,
  PUBLIC_FIXTURE_MAX_DELAY_MS,
  PUBLIC_FIXTURE_STATEFUL_VERSIONS,
  PUBLIC_FIXTURE_STATELESS_VERSION,
  getPublicFixtureUrl,
} from '../data/publicFixtures.ts';

export const MCP_TEST_SERVERS_COPY = {
  heading: 'Public MCP test servers',
  lede: 'Free, deterministic MCP servers you can point any client at: an echo server, a bearer-auth server, an errors server, a slow server and a schemas server. No sign-up, no API key, and the same answer every time.',
  intro: 'Use them to check that an MCP client, SDK or proxy connects, lists tools and handles failures before you test against a real server. Each endpoint speaks Streamable HTTP and supports both the stateless 2026 and the stateful 2025 protocol revisions.',
  pageViewTitle: 'Public MCP test servers',
} as const;

const ECHO_URL = getPublicFixtureUrl('echo');
const AUTH_URL = getPublicFixtureUrl('auth-bearer');

export interface SetupSnippet {
  /** Language for highlighting: bash, json or toml; undefined for numbered steps. */
  language?: 'bash' | 'json' | 'toml';
  code?: string;
  steps?: readonly string[];
  caption?: string;
}

export interface ClientSetupSection {
  id: string;
  client: string;
  /** Where the config goes, or how to open the form. */
  location: string;
  guidePath: string;
  snippets: readonly SetupSnippet[];
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

export const CLIENT_SETUPS: readonly ClientSetupSection[] = [
  {
    id: 'claude-code',
    client: 'Claude Code',
    location: 'Run in a terminal. Add --scope project to share it through .mcp.json, or --scope user for every project.',
    guidePath: '/learn/add-remote-mcp-server-to-claude#claude-code',
    snippets: [
      { language: 'bash', code: `claude mcp add --transport http mcptest-echo ${ECHO_URL}` },
      {
        language: 'bash',
        caption: 'The bearer-auth fixture, with its public token as a header:',
        code: `claude mcp add --transport http mcptest-auth ${AUTH_URL} \\\n  --header 'Authorization: Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}'`,
      },
    ],
  },
  {
    id: 'claude-ai',
    client: 'claude.ai and Claude Desktop',
    location: 'Custom connectors are added in claude.ai and appear in Claude Desktop for the same account.',
    guidePath: '/learn/add-remote-mcp-server-to-claude#claudeai-custom-connectors',
    snippets: [
      {
        steps: [
          'Open Customize > Connectors (claude.ai/customize/connectors).',
          'Click + Add, then Add custom connector.',
          `Enter the MCP server URL ${ECHO_URL}.`,
          'Under Authentication, choose No sign-in, then save.',
        ],
        caption: 'The connector form takes no fixed headers, so use a fixture without auth. Do not put a remote URL in claude_desktop_config.json; that file is for local servers.',
      },
    ],
  },
  {
    id: 'cursor',
    client: 'Cursor',
    location: '.cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project. Remote entries need only url.',
    guidePath: '/learn/connect-mcp-server-to-cursor',
    snippets: [
      { language: 'json', code: json({ mcpServers: { 'mcptest-echo': { url: ECHO_URL } } }) },
      {
        language: 'json',
        caption: 'The bearer-auth fixture:',
        code: json({ mcpServers: { 'mcptest-auth': { url: AUTH_URL, headers: { Authorization: `Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}` } } } }),
      },
    ],
  },
  {
    id: 'vs-code',
    client: 'VS Code',
    location: '.vscode/mcp.json, or run MCP: Open User Configuration for every workspace. Note the servers key and type: "http".',
    guidePath: '/learn/connect-mcp-server-to-vs-code',
    snippets: [
      { language: 'json', code: json({ servers: { 'mcptest-echo': { type: 'http', url: ECHO_URL } } }) },
      {
        language: 'json',
        caption: 'The bearer-auth fixture:',
        code: json({ servers: { 'mcptest-auth': { type: 'http', url: AUTH_URL, headers: { Authorization: `Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}` } } } }),
      },
    ],
  },
  {
    id: 'windsurf',
    client: 'Windsurf (Devin Desktop)',
    location: '~/.config/devin/mcp_config.json on macOS and Linux, %APPDATA%\\devin\\mcp_config.json on Windows. Remote entries use serverUrl.',
    guidePath: '/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex#windsurf-devin-desktop',
    snippets: [
      { language: 'json', code: json({ mcpServers: { 'mcptest-echo': { serverUrl: ECHO_URL } } }) },
    ],
  },
  {
    id: 'codex',
    client: 'Codex',
    location: 'Run in a terminal; Codex writes the entry to ~/.codex/config.toml.',
    guidePath: '/learn/connect-mcp-server-to-windsurf-gemini-cli-and-codex#codex',
    snippets: [
      { language: 'bash', code: `codex mcp add mcptest-echo --url ${ECHO_URL}` },
    ],
  },
  {
    id: 'chatgpt',
    client: 'ChatGPT',
    location: 'On the web, on plans that allow custom MCP servers (Pro with read and fetch only; Business, Enterprise and Edu). Developer mode is no longer required.',
    guidePath: '/learn/connect-mcp-server-to-chatgpt',
    snippets: [
      {
        steps: [
          'Open Plugins (chatgpt.com/plugins), select the plus button, then Add custom MCP server.',
          'Enter a name such as mcptest echo.',
          `Under Connection, enter ${ECHO_URL}.`,
          'Choose No authentication, confirm the risk warning, and select Create as a plugin.',
        ],
        caption: 'ChatGPT connects from OpenAI’s servers, so it reaches these public endpoints directly.',
      },
    ],
  },
];

const STATEFUL_VERSION = PUBLIC_FIXTURE_STATEFUL_VERSIONS[0];
const CURL_HEADERS = `  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream"`;
const STATELESS_META = `"_meta": {\n        "io.modelcontextprotocol/protocolVersion": "${PUBLIC_FIXTURE_STATELESS_VERSION}",\n        "io.modelcontextprotocol/clientCapabilities": {}\n      }`;

export interface CurlExample {
  id: string;
  title: string;
  description: string;
  code: string;
  /** What the response looks like. */
  expected?: string;
}

export const CURL_EXAMPLES: readonly CurlExample[] = [
  {
    id: 'curl-initialize',
    title: 'initialize (stateful 2025-11-25)',
    description: 'Keep -i: the response headers carry the Mcp-Session-Id that every later stateful request must send.',
    code: `curl -i ${ECHO_URL} \\\n${CURL_HEADERS} \\\n  -d '{\n    "jsonrpc": "2.0",\n    "id": 1,\n    "method": "initialize",\n    "params": {\n      "protocolVersion": "${STATEFUL_VERSION}",\n      "capabilities": {},\n      "clientInfo": { "name": "curl-check", "version": "1.0.0" }\n    }\n  }'`,
    expected: `HTTP 200 with headers Mcp-Session-Id: mcptest-fx-… and MCP-Protocol-Version: ${STATEFUL_VERSION}, and a result naming the server mcptest-fixture-echo with tools, resources and prompts capabilities.`,
  },
  {
    id: 'curl-tools-list',
    title: 'tools/list',
    description: 'Copy the session ID from the initialize response. The initialized notification gets an empty 202.',
    code: `SESSION_ID=paste-the-Mcp-Session-Id-here\n\ncurl -i ${ECHO_URL} \\\n${CURL_HEADERS} \\\n  -H "MCP-Protocol-Version: ${STATEFUL_VERSION}" \\\n  -H "Mcp-Session-Id: $SESSION_ID" \\\n  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'\n\ncurl ${ECHO_URL} \\\n${CURL_HEADERS} \\\n  -H "MCP-Protocol-Version: ${STATEFUL_VERSION}" \\\n  -H "Mcp-Session-Id: $SESSION_ID" \\\n  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`,
    expected: 'The echo, add, whoami and headers tools with their input schemas. Without the session header the server answers 400; with an ID it did not issue, 404.',
  },
  {
    id: 'curl-tools-call',
    title: 'tools/call',
    description: 'In the same session, call echo:',
    code: `curl ${ECHO_URL} \\\n${CURL_HEADERS} \\\n  -H "MCP-Protocol-Version: ${STATEFUL_VERSION}" \\\n  -H "Mcp-Session-Id: $SESSION_ID" \\\n  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hello"}}}'`,
    expected: '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"hello"}]}}',
  },
  {
    id: 'curl-stateless',
    title: 'tools/call without a session (stateless 2026-07-28)',
    description: 'The 2026 revision needs no initialize and no session. Every request carries the protocol version in _meta, and the MCP-Protocol-Version, Mcp-Method and Mcp-Name headers must match the body.',
    code: `curl ${ECHO_URL} \\\n${CURL_HEADERS} \\\n  -H "MCP-Protocol-Version: ${PUBLIC_FIXTURE_STATELESS_VERSION}" \\\n  -H "Mcp-Method: tools/call" \\\n  -H "Mcp-Name: add" \\\n  -d '{\n    "jsonrpc": "2.0",\n    "id": 4,\n    "method": "tools/call",\n    "params": {\n      "name": "add",\n      "arguments": { "a": 2, "b": 3 },\n      ${STATELESS_META}\n    }\n  }'`,
    expected: 'A result with content text "5", structuredContent {"sum": 5} and resultType "complete". A header that disagrees with the body gets error -32020.',
  },
  {
    id: 'curl-auth',
    title: 'The bearer-auth fixture',
    description: 'Add the public token to any of the requests above, with the auth-bearer URL:',
    code: `curl -i ${AUTH_URL} \\\n${CURL_HEADERS} \\\n  -H "Authorization: Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"${STATEFUL_VERSION}","capabilities":{},"clientInfo":{"name":"curl-check","version":"1.0.0"}}}'`,
    expected: 'HTTP 200 and a session ID. Leave out the Authorization header and the answer is 401 with WWW-Authenticate: Bearer realm="mcptest.io fixtures".',
  },
];

export interface FaqEntry {
  question: string;
  answer: string;
}

export const MCP_TEST_SERVERS_FAQ: readonly FaqEntry[] = [
  {
    question: 'Are the MCP test servers free?',
    answer: `Yes. They are free and need no account or API key. The bearer-auth fixture uses the public token ${PUBLIC_FIXTURE_BEARER_TOKEN}, which is published on this page and protects nothing.`,
  },
  {
    question: 'Is there a rate limit?',
    answer: `The fixtures enforce no per-client quota, but every request is bounded: bodies are capped at ${PUBLIC_FIXTURE_MAX_BODY_BYTES / 1024} KiB, JSON-RPC batches are rejected and delays stop at ${PUBLIC_FIXTURE_MAX_DELAY_MS / 1000} seconds. They are shared endpoints on Cloudflare Workers, so use them for functional tests, not load tests.`,
  },
  {
    question: 'Do the test servers store anything?',
    answer: 'No. The fixture code has no database or key-value storage and makes no outbound requests. Session IDs are checked by their signature rather than looked up, and the whoami and headers tools never echo Authorization, Cookie or other credential values.',
  },
  {
    question: 'Which MCP protocol versions do they support?',
    answer: `Each endpoint supports the stateless ${PUBLIC_FIXTURE_STATELESS_VERSION} revision (server/discover, no session) and the stateful ${PUBLIC_FIXTURE_STATEFUL_VERSIONS.join(', ')} revisions (initialize plus an Mcp-Session-Id), over Streamable HTTP. There is no deprecated HTTP+SSE endpoint; GET and DELETE answer 405.`,
  },
  {
    question: 'Can I use them in CI?',
    answer: 'Yes. Every tool returns the same result for the same input, so they make stable smoke-test targets for an MCP client or SDK: echo for the happy path, errors for error handling and slow for timeouts. They are public internet endpoints, so assert on results rather than latency, and keep a local fixture if your pipeline must run offline.',
  },
];
