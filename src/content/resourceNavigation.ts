export interface ResourceNavigationItem {
  label: string;
  path: string;
  icon: string;
  matchDescendants?: boolean;
}

/**
 * High-level destinations for the sidebar. Detailed documentation and guide
 * links live within these resource hubs instead of competing with app routes.
 */
export const RESOURCE_NAV_ITEMS: readonly ResourceNavigationItem[] = [
  {
    label: 'What is MCP?',
    path: '/docs/what-is-mcp',
    icon: 'bi-info-circle',
  },
  {
    label: 'Guides & Tutorials',
    path: '/learn',
    icon: 'bi-journals',
    matchDescendants: true,
  },
  {
    label: 'Troubleshooting',
    path: '/docs/troubleshooting',
    icon: 'bi-wrench',
  },
] as const;
