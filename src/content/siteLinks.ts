/** Visible content navigation shared by React and the generated HTML shell. */
export const FOOTER_COLUMNS = [
  { title: 'Guides', links: [
    ['What is MCP?', '/docs/what-is-mcp'], ['Remote vs Local', '/docs/remote-vs-local'], ['MCP Glossary', '/learn/mcp-glossary'],
  ] },
  { title: 'Testing & Specs', links: [
    ['Testing Guide', '/docs/testing-guide'], ['OAuth 2.1', '/learn/mcp-oauth-2-1-reference'], ['Breaking Changes', '/learn/which-mcp-tool-changes-break-clients'],
  ] },
  { title: 'Compare', links: [
    ['mcptest.io vs Glama', '/learn/mcptest-vs-glama-inspector'], ['MCP Inspector Alternatives', '/learn/mcp-inspector-alternatives'], ['Testing Tools Roundup', '/learn/best-remote-mcp-testing-tools'],
  ] },
];
export const HOME_GUIDE_COLUMNS = [
  { title: 'Understand MCP', links: [
    ['What is MCP?', 'what-is-mcp', 'Understand how AI clients connect to tools and data.'],
    ['Remote vs Local', 'remote-vs-local', 'Choose the right transport and hosting model.'],
    ['OAuth for MCP', 'oauth-for-mcp-explained', 'Learn how authorization works for remote servers.'],
  ] },
  { title: 'Test & Debug', links: [
    ['Testing Guide', 'testing-guide', 'Inspect a connection and run your first tool call.'],
    ['Troubleshooting', 'troubleshooting', 'Find the next step when a connection fails.'],
    ['Browser CORS headers', 'mcp-cors-headers-for-browser-clients', 'Make your server accessible to browser clients.'],
  ] },
  { title: 'Build Servers', links: [
    ['Design a production MCP server', 'designing-production-mcp-server', 'Plan reliable tools, authentication and deployment.'],
    ['Deploy a remote MCP server', 'deploy-remote-mcp-server', 'Take your server from local development to hosting.'],
    ['Test before deploying', 'test-mcp-server-before-deploying', 'Check your server before shipping changes.'],
  ] },
];
