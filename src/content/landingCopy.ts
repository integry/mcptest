/**
 * Copy for the root page's landing hero. LandingHero renders it in the app,
 * and scripts/generate-seo-pages.js renders the same strings into the static
 * fallback inside dist/index.html so crawlers see them without JavaScript.
 * Edit the text here; both outputs follow.
 */

export const LANDING_HEADLINE = 'Test remote MCP servers online';

export const LANDING_LEDE =
  'Inspect, debug and evaluate a remote MCP server in your browser. Paste its endpoint URL: '
  + 'mcptest.io negotiates the protocol, handles authorization, and lists its tools, resources '
  + 'and prompts next to the raw JSON-RPC traffic.';

/**
 * Shown under the connect form. Signing in only syncs saved workspaces and
 * lifts the CORS proxy's anonymous rate limit (useDataSync, ConnectionPanel),
 * so connecting and testing never require an account.
 */
export const LANDING_TRUST_LABEL = 'About mcptest.io';
export const LANDING_TRUST_POINTS = [
  'Free',
  'Runs in your browser',
  'Nothing to install',
  'No sign-up needed to connect and test',
] as const;

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

/**
 * Answers and step descriptions may contain `[label](href)` links. They are
 * rendered as links on the page and as their label in FAQPage JSON-LD.
 */
export type LandingTextPart = { text: string; href?: string };

const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseLandingText(value: string): LandingTextPart[] {
  const parts: LandingTextPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: value.slice(cursor, index) });
    parts.push({ text: match[1], href: match[2] });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts;
}

/** The text with link markup reduced to its labels. */
export function landingPlainText(value: string): string {
  return parseLandingText(value).map(part => part.text).join('');
}

export const LANDING_STEPS_TITLE = 'How to test an MCP server';

export const LANDING_STEPS = [
  {
    title: 'Paste the endpoint URL',
    description: 'Enter the server\'s Streamable HTTP or SSE URL above, for example https://example.com/mcp, '
      + 'or pick a public server from the [catalog](/catalog).',
  },
  {
    title: 'Pick the authentication',
    description: 'Public servers need nothing. For an OAuth server, mcptest.io runs the authorization flow '
      + 'with PKCE when you connect; for a bearer token, API key or custom header, open Advanced options.',
  },
  {
    title: 'Connect',
    description: 'mcptest.io negotiates the protocol version and transport, then lists the server\'s tools, '
      + 'resources and prompts with the raw JSON-RPC traffic alongside.',
  },
  {
    title: 'Call a tool',
    description: 'Fill in a tool\'s arguments from its input schema, run it, and check the result, '
      + 'structured content and errors.',
  },
  {
    title: 'Share the report',
    description: 'Open the [report](/report) for protocol, authorization, CORS and contract checks, '
      + 'then share its link or embed its badge.',
  },
] as const;

export const LANDING_FAQ_TITLE = 'Frequently asked questions';

/** Every question here is also emitted as FAQPage JSON-LD on the home page. */
export const LANDING_FAQ = [
  {
    question: 'Is mcptest.io free?',
    answer: 'Yes. Testing servers, reports and the catalog are free, and the '
      + '[source code](https://github.com/integry/mcptest) is MIT licensed.',
  },
  {
    question: 'Do I need to install anything or sign up?',
    answer: 'No. mcptest.io runs in your browser, and you can connect to and test a server without an account. '
      + 'Signing in with Google is optional: it syncs your saved workspace across devices and raises the '
      + 'rate limit on anonymous use of the CORS proxy.',
  },
  {
    question: 'Can I test a local or stdio MCP server?',
    answer: 'Not directly. mcptest.io connects to remote servers over HTTP, so a stdio server has to be '
      + 'served over Streamable HTTP and reachable from your browser first; see '
      + '[converting a local stdio server to remote](/learn/convert-local-stdio-mcp-server-to-remote). '
      + 'For stdio-only servers, use the official MCP Inspector.',
  },
  {
    question: 'Which transports and protocol versions are supported?',
    answer: 'Streamable HTTP, including the stateless MCP 2026-07-28 revision and stateful 2025 sessions '
      + '(2025-11-25, 2025-06-18 and 2025-03-26), plus the deprecated HTTP+SSE transport from 2024-11-05. '
      + 'mcptest.io negotiates the newest version the server supports; see '
      + '[MCP protocol versions explained](/learn/mcp-protocol-versions-explained).',
  },
  {
    question: 'How do I test a server that needs OAuth or an API key?',
    answer: 'Connect as usual: when the server answers 401, mcptest.io discovers its authorization server '
      + 'and runs the OAuth 2.1 flow with PKCE. For a bearer token or API key, add it under Advanced options. '
      + 'The [testing guide](/docs/testing-guide) covers what to check.',
  },
  {
    question: 'How is this different from the official MCP Inspector?',
    answer: 'The MCP Inspector runs locally with npx and is the best choice for stdio servers. mcptest.io '
      + 'needs no install, records the CORS behaviour a real browser sees, and produces shareable reports. '
      + 'See [mcptest.io vs MCP Inspector](/learn/mcptest-vs-mcp-inspector).',
  },
  {
    question: 'Can I run the same checks in CI?',
    answer: 'Yes. The integry/mcptest GitHub Action runs the same client-compatibility and breaking-change '
      + 'checks against a deployed preview URL and can fail the job or comment on the pull request. '
      + 'See [MCP checks in GitHub Actions](/ci).',
  },
] as const;

/**
 * FAQPage JSON-LD for exactly the visible LANDING_FAQ. The prerendered home
 * page and the app (useMetaTags) emit the same object.
 */
export function getLandingFaqStructuredData(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: LANDING_FAQ.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: landingPlainText(item.answer) },
    })),
  };
}
