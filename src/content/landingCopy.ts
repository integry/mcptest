/**
 * Copy for the root page's landing hero. LandingHero renders it in the app,
 * and scripts/generate-seo-pages.js renders the same strings into the static
 * fallback inside dist/index.html so crawlers see them without JavaScript.
 * Edit the text here; both outputs follow.
 */

export const LANDING_HEADLINE = 'Inspect, debug and evaluate remote MCP servers in your browser';

export const LANDING_LEDE =
  'Paste an endpoint URL to test a remote MCP server. mcptest.io negotiates the protocol, '
  + 'handles authorization, and lists its tools, resources and prompts next to the raw '
  + 'JSON-RPC traffic.';

export const LANDING_PATHS_LABEL = 'Where to start';

export const LANDING_AUDIENCE_PATHS = [
  {
    title: 'New to MCP',
    description: 'What the Model Context Protocol is, and how remote servers differ from local ones.',
    to: '/docs/what-is-mcp',
  },
  {
    title: 'Connecting a server to Claude, ChatGPT or Cursor',
    description: 'Check that an endpoint responds and authorizes before you add it to a client.',
    to: '/learn/connect-remote-mcp-server',
  },
  {
    title: 'Building a server',
    description: 'Run the checks a client will run, and find protocol, auth and CORS problems before release.',
    to: '/docs/testing-guide',
  },
] as const;

export const LANDING_COVERAGE_TITLE = 'What a report covers';

export const LANDING_REPORT_COVERAGE = [
  'Protocol negotiation across MCP 2026 stateless, 2025 stateful and legacy HTTP+SSE',
  'OAuth 2.1 with PKCE, bearer tokens and API keys',
  'CORS evidence from a real browser',
  'Tool, resource and prompt contracts',
  'Shareable reports',
] as const;

/** The catalog link reads `Browse <count> public remote MCP servers in the catalog`. */
export const LANDING_CATALOG_LINK_PREFIX = 'Browse';
export const LANDING_CATALOG_LINK_SUFFIX = 'public remote MCP servers in the catalog';
