/**
 * Copy of the discovery checker's first screen, shared by the React view
 * (src/components/DiscoveryCheckerView.tsx) and the prerendered shell
 * (scripts/generate-seo-pages.js), so the static first frame and the mounted
 * view say the same thing. No runtime imports: the generator loads this file
 * with Node's TypeScript support.
 */
export const DISCOVERY_GUIDE_PATH = '/learn/make-mcp-server-discoverable';

export const DISCOVERY_COPY = {
  heading: 'MCP discovery checker',
  /** Open Graph card summary: two lines at the card's size. */
  cardSummary: 'Every remote MCP server a domain advertises: Server Cards, OAuth metadata and registry entries, validated.',
  lede: 'Enter a domain to see every way it advertises a remote MCP server: Server Cards, OAuth metadata, the official MCP Registry and the mcptest.io catalog. Each document is validated, and every endpoint found opens in the inspector with one click.',
  inputLabel: 'Domain',
  placeholder: 'example.com',
  submit: 'Check domain',
  hint: 'Requests run from your browser. When a document has no CORS headers, it is read through the mcptest proxy, which only fetches discovery documents (.well-known paths, /server-card and the registry API), and the result says so.',
  noProxyHint: ' The proxy is not configured in this build, so such documents show as unreachable.',
  guidePrompt: 'Publishing a server? Read ',
  guideLink: 'how to make your MCP server discoverable',
} as const;
