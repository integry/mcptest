import { describe, expect, it } from 'vitest';
import {
  FIRST_DASHBOARD_ID,
  FIRST_DASHBOARD_NAME,
  createDefaultSpaces,
  createFirstDashboard,
  withoutUntouchedDefaultDashboard,
} from './defaultWorkspace';

const card = { id: 'c1', title: 'echo', serverUrl: 'https://example.com/mcp', type: 'tool' as const, name: 'echo', params: {} };

describe('default dashboards', () => {
  it('starts a new visitor with no dashboards', () => {
    expect(createDefaultSpaces()).toEqual([]);
    expect(createFirstDashboard()).toEqual({ id: FIRST_DASHBOARD_ID, name: FIRST_DASHBOARD_NAME, cards: [] });
  });

  it('drops the automatic default an earlier version saved, when it is untouched and alone', () => {
    expect(withoutUntouchedDefaultDashboard([createFirstDashboard()])).toEqual([]);
  });

  it.each([
    ['renamed', [{ ...createFirstDashboard(), name: 'Production' }]],
    ['with cards', [{ ...createFirstDashboard(), cards: [card] }]],
    ['with a customized column layout', [{ ...createFirstDashboard(), columns: 3 }]],
    ['with the default column count chosen explicitly', [{ ...createFirstDashboard(), columns: 2 }]],
    ['beside other dashboards', [createFirstDashboard(), { id: '2', name: 'Staging', cards: [] }]],
    ['created by the visitor with the same name', [{ id: '1700000000000', name: FIRST_DASHBOARD_NAME, cards: [] }]],
  ])('keeps an existing user\'s dashboards: %s', (_label, spaces) => {
    expect(withoutUntouchedDefaultDashboard(spaces as never)).toBe(spaces);
  });
});
