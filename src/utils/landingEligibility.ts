import type { ConnectionTab } from '../types';

const tabHasServer = (tab: ConnectionTab) => Boolean(
  tab.serverUrl
  || tab.autoConnect
  || tab.resultShareData
  || tab.connectionStatus !== 'Disconnected'
);

/**
 * The landing belongs to the empty playground only. A tab may show it when no
 * other tab already has a server; the tab's own URL is excluded so the landing
 * stays up while a first-time visitor types into it.
 */
export const isLandingEligible = (tabs: ConnectionTab[], tabId: string) =>
  !tabs.some(tab => tab.id !== tabId && tabHasServer(tab));

/** A tab that is connecting or connected, or will connect on its own. */
const tabHasConnection = (tab: ConnectionTab) => Boolean(
  tab.autoConnect
  || tab.resultShareData
  || tab.connectionStatus !== 'Disconnected'
);

/** Whether recent endpoints are stored, read the way public/theme-init.js reads them before paint. */
export const hasStoredRecentServers = (): boolean => {
  try {
    const stored = JSON.parse(localStorage.getItem('mcpRecentServers') || 'null');
    return Array.isArray(stored) && stored.some(item => (
      typeof item === 'string' ? Boolean(item) : Boolean(item && typeof item.url === 'string')
    ));
  } catch {
    return false;
  }
};

/**
 * The playground's tab strip is deferred during the first run: a single empty
 * tab has nothing to switch between, and an unexplained "New Connection" tab
 * and "+ New" control above the landing only distract. It appears once there
 * are several tabs or any tab has a connection, and stays for the session.
 * A returning workspace (saved servers or recent endpoints, the same test as
 * public/theme-init.js) shows it from the first frame, as the static shell does.
 */
export const needsTabStrip = (tabs: ConnectionTab[]): boolean => tabs.length > 1 || tabs.some(tabHasConnection);

export const isReturningWorkspace = (tabs: ConnectionTab[]): boolean => (
  hasStoredRecentServers() || tabs.some(tabHasServer)
);
