import type { ConnectionTab, Space } from '../types';

/**
 * Starting dashboards and tabs for a visitor with nothing saved. App uses
 * these only during synchronous initialization; auth resolution must preserve
 * the workspace already shown.
 *
 * A new visitor starts with no dashboards: the sidebar shows a single
 * "Dashboards" entry and the dashboards page explains them. The first one is
 * created when the visitor creates it or adds a result to a dashboard
 * (createFirstDashboard).
 */
export const createDefaultSpaces = (): Space[] => [];

/** The dashboard created on demand when a result is added before any dashboard exists. */
export const FIRST_DASHBOARD_ID = 'default';
export const FIRST_DASHBOARD_NAME = 'My first dashboard';

export const createFirstDashboard = (): Space => ({ id: FIRST_DASHBOARD_ID, name: FIRST_DASHBOARD_NAME, cards: [] });

/**
 * Earlier versions created "My first dashboard" for every visitor and saved
 * it. Stored on its own, untouched (same id and name, no cards, no layout
 * setting), it is that automatic default rather than something the visitor
 * made, so it is dropped. Anything else, including the default once renamed,
 * given cards, given a column layout, or kept beside other dashboards, is the
 * visitor's own and stays. The automatic default never carried `columns`;
 * only the layout picker sets it, so any saved value is a visitor choice.
 */
export const withoutUntouchedDefaultDashboard = (spaces: Space[]): Space[] => {
  if (spaces.length !== 1) return spaces;
  const [only] = spaces;
  const untouched = only.id === FIRST_DASHBOARD_ID
    && only.name === FIRST_DASHBOARD_NAME
    && (!Array.isArray(only.cards) || only.cards.length === 0)
    && only.columns == null;
  return untouched ? [] : spaces;
};

export const createDefaultTabs = (): ConnectionTab[] => [
  { id: 'default-tab', title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' },
];
