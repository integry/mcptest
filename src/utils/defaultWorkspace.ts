import type { ConnectionTab, Space } from '../types';

/**
 * Starting dashboards and tabs for a visitor with nothing saved. App uses
 * these only during synchronous initialization; auth resolution must preserve
 * the workspace already shown.
 */
export const createDefaultSpaces = (): Space[] => [
  { id: 'default', name: 'My first dashboard', cards: [] },
];

export const createDefaultTabs = (): ConnectionTab[] => [
  { id: 'default-tab', title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' },
];
