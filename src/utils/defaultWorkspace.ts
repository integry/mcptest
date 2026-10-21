import type { ConnectionTab, Space } from '../types';

/**
 * Starting dashboards and tabs for a visitor with nothing saved. App starts
 * from these on its first render and useDataSync applies the same values once
 * auth resolves, so the sidebar and playground do not change after mount.
 */
export const createDefaultSpaces = (): Space[] => [
  { id: 'default', name: 'My first dashboard', cards: [] },
];

export const createDefaultTabs = (): ConnectionTab[] => [
  { id: 'default-tab', title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' },
];
