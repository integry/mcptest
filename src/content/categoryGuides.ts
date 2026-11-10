/**
 * The Learn guides each catalog category page recommends, by article slug.
 * Kept import-free: the React catalog resolves slugs through learnRegistry and
 * scripts/generate-seo-pages.js through its loaded articles. contentModel
 * tests fail when a catalog category is missing here or a slug is unknown.
 */
export const CATEGORY_GUIDES: Readonly<Record<string, readonly string[]>> = {
  'AI Infrastructure': [
    'designing-production-mcp-server',
    'mcp-tool-output-schemas-and-structured-content',
    'deploy-remote-mcp-server',
  ],
  Analytics: ['connect-remote-mcp-server', 'oauth-for-mcp-explained', 'mcp-server-trust-checklist'],
  Automation: ['what-can-you-do-with-mcp', 'connect-mcp-server-to-chatgpt', 'oauth-for-mcp-explained'],
  CRM: ['oauth-for-mcp-explained', 'remote-mcp-server-401-unauthorized', 'add-remote-mcp-server-to-claude'],
  Cloud: ['deploy-remote-mcp-server', 'convert-local-stdio-mcp-server-to-remote', 'mcp-oauth-2-1-reference'],
  Communication: ['oauth-for-mcp-explained', 'add-remote-mcp-server-to-claude', 'is-mcp-safe'],
  Databases: [
    'convert-local-stdio-mcp-server-to-remote',
    'oauth-for-mcp-explained',
    'mcp-server-trust-checklist',
  ],
  Design: ['connect-mcp-server-to-cursor', 'connect-mcp-server-to-vs-code', 'oauth-for-mcp-explained'],
  'Developer Tools': [
    'connect-mcp-server-to-cursor',
    'connect-mcp-server-to-vs-code',
    'test-mcp-server-before-deploying',
  ],
  Documentation: [
    'connect-remote-mcp-server',
    'mcp-server-connected-but-no-tools',
    'mcp-cors-headers-for-browser-clients',
  ],
  Finance: ['is-mcp-safe', 'mcp-server-trust-checklist', 'oauth-for-mcp-explained'],
  Marketplace: ['connect-remote-mcp-server', 'mcp-clients-compared'],
  Observability: ['mcp-transport-diagnostics-reference', 'troubleshooting', 'mcp-json-rpc-error-codes'],
  Payments: ['mcp-oauth-2-1-reference', 'is-mcp-safe', 'remote-mcp-server-401-unauthorized'],
  Productivity: ['add-remote-mcp-server-to-claude', 'connect-mcp-server-to-chatgpt', 'oauth-for-mcp-explained'],
  'Project Management': [
    'oauth-for-mcp-explained',
    'connect-mcp-server-to-cursor',
    'remote-mcp-server-401-unauthorized',
  ],
  Reference: [
    'connect-remote-mcp-server',
    'mcp-cors-headers-for-browser-clients',
    'mcp-server-connected-but-no-tools',
  ],
  Search: [
    'mcp-tool-output-schemas-and-structured-content',
    'connect-remote-mcp-server',
    'mcp-cors-headers-for-browser-clients',
  ],
  Security: ['mcp-server-trust-checklist', 'is-mcp-safe', 'mcp-oauth-2-1-reference'],
};

/** Used for a category added to the catalog before it gets its own row. */
export const DEFAULT_CATEGORY_GUIDES: readonly string[] = ['connect-remote-mcp-server', 'testing-guide'];

export const getCategoryGuideSlugs = (category: string): readonly string[] =>
  CATEGORY_GUIDES[category] ?? DEFAULT_CATEGORY_GUIDES;
