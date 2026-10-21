import { useCallback, useEffect, useState } from 'react';

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

/**
 * Icon-only desktop sidebar, remembered across visits. Only the desktop
 * instance owns the body class; the mobile drawer passes `enabled: false`.
 */
export const useSidebarCollapsed = (enabled: boolean): [boolean, () => void, () => void] => {
  const [collapsed, setCollapsed] = useState(() => enabled && readStoredSidebarCollapsed());

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    document.body.classList.toggle(SIDEBAR_COLLAPSED_CLASS, collapsed);
    return () => document.body.classList.remove(SIDEBAR_COLLAPSED_CLASS);
  }, [collapsed, enabled]);

  const persist = (next: boolean) => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch {
      // Private mode or quota: the sidebar still toggles for this session.
    }
  };

  const toggle = useCallback(() => {
    setCollapsed(current => {
      persist(!current);
      return !current;
    });
  }, []);

  const expand = useCallback(() => {
    setCollapsed(current => {
      if (current) persist(false);
      return false;
    });
  }, []);

  return [collapsed, toggle, expand];
};
