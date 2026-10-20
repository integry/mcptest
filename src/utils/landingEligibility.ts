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
