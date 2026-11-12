/**
 * Layout state kept on <body> and in storage, without React: shared by the
 * hooks that own it in the app (useMobileDrawer, useSidebarCollapsed) and the
 * static page's handlers (src/staticPage), which run before React loads.
 */

/** On <body> while the mobile navigation drawer is open. */
export const MENU_OPEN_CLASS = 'menu-open';

export const SIDEBAR_COLLAPSED_KEY = 'mcpSidebarCollapsed';
/** Set on <body> so the layout can narrow the desktop sidebar column. */
export const SIDEBAR_COLLAPSED_CLASS = 'sidenav-collapsed';

export const readStoredSidebarCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};
