import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Space } from '../types';

const currentUser = { email: 'visitor@example.com', getIdToken: vi.fn(async () => 'token') };

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser, loading: false }),
}));

import { useDataSync } from './useDataSync';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubEnv('VITE_CLOUDFLARE_WORKER_URL', 'https://sync.example.com');
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Signs in with the given spaces stored on the account and returns what the hook applied. */
const syncAccountSpaces = async (remoteSpaces: Space[]) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ spaces: remoteSpaces, tabs: [] }), { status: 200 })));
  const setSpaces = vi.fn();
  const Probe: React.FC = () => {
    useDataSync({ spaces: [], tabs: [], setSpaces, setTabs: vi.fn() });
    return null;
  };
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(Probe)));
  await vi.waitFor(() => expect(setSpaces).toHaveBeenCalled());
  return setSpaces.mock.calls[0][0] as Space[];
};

describe('useDataSync account dashboards', () => {
  it('drops the untouched automatic default an earlier version saved to the account', async () => {
    expect(await syncAccountSpaces([{ id: 'default', name: 'My first dashboard', cards: [] }])).toEqual([]);
  });

  it('keeps the default dashboard once the visitor customized its column layout', async () => {
    const customized = { id: 'default', name: 'My first dashboard', cards: [], columns: 3 };
    expect(await syncAccountSpaces([customized])).toEqual([customized]);
    expect(JSON.parse(localStorage.getItem('mcpSpaces') ?? 'null')).toEqual([customized]);
  });
});
