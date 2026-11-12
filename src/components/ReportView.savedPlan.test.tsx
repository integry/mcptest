import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import ReportView from './ReportView';
import { createCallHistoryEntry } from '../utils/callHistory';
import { createTestPlanFromHistory } from '../utils/historyTestPlan';
import { saveTestPlan, type SavedTestPlanV1 } from '../utils/savedTestPlans';

const authMocks = vi.hoisted(() => ({ getIdToken: vi.fn() }));
const oauthMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  prepare: vi.fn(),
  hostedTokenProxy: vi.fn(),
  load: vi.fn(),
}));
const evaluationMocks = vi.hoisted(() => ({ evaluate: vi.fn() }));
const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: '', state: null as null | { fromOAuthReturn: boolean; authorizedServerUrl: string } },
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => routerMocks.navigate,
  useLocation: () => routerMocks.location,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { getIdToken: authMocks.getIdToken }, loading: false }),
}));

vi.mock('../utils/oauthFlow', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/oauthFlow')>(),
  beginOAuthFlow: oauthMocks.begin,
  loadOAuthAuthorization: oauthMocks.load,
  getHostedOAuthTokenProxyUrl: oauthMocks.hostedTokenProxy,
  prepareManualOAuthClient: oauthMocks.prepare,
}));

vi.mock('../utils/evaluation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/evaluation')>(),
  evaluateServer: evaluationMocks.evaluate,
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const endpoint = 'https://plans.example/mcp';

const scoredReport = (): EvaluationReport => ({ serverUrl: endpoint, outcome: 'scored', finalScore: 0, sections: {} });

const challengedReport = (): EvaluationReport => ({
  serverUrl: endpoint,
  authenticationUrl: endpoint,
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: {
      name: 'Authorization required',
      description: 'Credential prerequisite',
      score: 0,
      maxScore: 0,
      details: [{
        text: 'Authorization required',
        metadata: { authenticationSource: 'target', responseHeaders: { 'WWW-Authenticate': 'Bearer realm="plans"' } },
      }],
    },
  },
});

const savePlan = (): SavedTestPlanV1 => {
  const { plan } = createTestPlanFromHistory([createCallHistoryEntry({
    toolName: 'weather',
    arguments: { city: 'Riga' },
    result: { type: 'tool_result', data: [], timestamp: '', toolCall: {
      result: { content: [{ type: 'text', text: 'Forecast for Riga' }] },
      contract: { toolName: 'weather', status: 'no-schema', violations: [], hasStructuredContent: false, isError: false },
    } },
    durationMs: 5,
  })], [{ name: 'weather', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }], endpoint);
  return saveTestPlan(endpoint, plan, { name: 'Smoke' });
};

let root: Root | undefined;
let container: HTMLDivElement;

const render = async () => {
  container = document.createElement('div');
  await act(async () => {
    root = createRoot(container);
    root.render(<ReportView />);
  });
};

const button = (label: string) => Array.from(container.querySelectorAll('button'))
  .find((candidate) => candidate.textContent?.includes(label));

const click = async (label: string) => {
  const target = button(label);
  expect(target, label).toBeDefined();
  await act(async () => target!.click());
};

const savedPlanOptionOf = (call: unknown[]) => (call[6] as { savedPlan?: { id: string } } | undefined)?.savedPlan;

describe('ReportView saved-plan run across target authorization', () => {
  let saved: SavedTestPlanV1;

  beforeEach(() => {
    routerMocks.location = { pathname: `/report/${encodeURIComponent(endpoint)}`, state: null };
    routerMocks.navigate.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    authMocks.getIdToken.mockReset().mockResolvedValue('firebase-session-token');
    oauthMocks.load.mockReset();
    oauthMocks.begin.mockReset().mockResolvedValue('REDIRECT');
    oauthMocks.prepare.mockReset().mockResolvedValue(undefined);
    oauthMocks.hostedTokenProxy.mockReset().mockReturnValue(undefined);
    evaluationMocks.evaluate.mockReset()
      .mockResolvedValueOnce(scoredReport())
      .mockResolvedValueOnce(challengedReport())
      .mockResolvedValue(scoredReport());
    saved = savePlan();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
  });

  it('runs the pending plan with the static credential entered after the challenge', async () => {
    await render();
    await click('Run saved plan');
    expect(savedPlanOptionOf(evaluationMocks.evaluate.mock.calls[1])).toMatchObject({ id: saved.id });
    const input = container.querySelector<HTMLInputElement>('#report-static-credential')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'plan-token');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(evaluationMocks.evaluate).toHaveBeenCalledTimes(3);
    const retry = evaluationMocks.evaluate.mock.calls[2];
    expect(retry[4]).toEqual({ Authorization: 'Bearer plan-token' });
    expect(savedPlanOptionOf(retry)).toMatchObject({ id: saved.id, endpoint, plan: saved.plan });

    // The plan ran, so an ordinary report afterwards does not run it again.
    await click('Run Report');
    expect(evaluationMocks.evaluate).toHaveBeenCalledTimes(4);
    expect(savedPlanOptionOf(evaluationMocks.evaluate.mock.calls[3])).toBeUndefined();
  });

  it('runs the pending plan after OAuth completes in the page', async () => {
    oauthMocks.begin.mockResolvedValue('AUTHORIZED');
    await render();
    await click('Run saved plan');
    await click('Authorize and run report');
    expect(evaluationMocks.evaluate).toHaveBeenCalledTimes(3);
    expect(savedPlanOptionOf(evaluationMocks.evaluate.mock.calls[2])).toMatchObject({ id: saved.id });
  });

  it('carries the pending plan by reference through an OAuth redirect and runs it on return', async () => {
    await render();
    await click('Run saved plan');
    await click('Authorize and run report');
    const returnView = JSON.parse(sessionStorage.getItem('oauth_return_view')!);
    expect(returnView.savedPlanRequest).toEqual({ id: saved.id, endpoint, confirmedUnsafeToolNames: [] });
    expect(JSON.stringify(returnView)).not.toContain('Riga');
    act(() => root?.unmount());

    evaluationMocks.evaluate.mockReset().mockResolvedValue(scoredReport());
    oauthMocks.load.mockReturnValue({ accessToken: 'authorized-token' });
    routerMocks.location = {
      pathname: `/report/${encodeURIComponent(endpoint)}`,
      state: { fromOAuthReturn: true, authorizedServerUrl: endpoint },
    };
    await render();
    expect(evaluationMocks.evaluate).toHaveBeenCalledTimes(1);
    const [call] = evaluationMocks.evaluate.mock.calls;
    expect(call[3]).toBe('authorized-token');
    expect(savedPlanOptionOf(call)).toMatchObject({ id: saved.id, endpoint, plan: saved.plan });
  });

  it('drops the pending plan when the user runs an ordinary report instead', async () => {
    evaluationMocks.evaluate.mockReset()
      .mockResolvedValueOnce(scoredReport())
      .mockResolvedValueOnce(challengedReport())
      .mockResolvedValueOnce(challengedReport())
      .mockResolvedValue(scoredReport());
    await render();
    await click('Run saved plan');
    await click('Run Report');
    await click('Authorize and run report');
    expect(JSON.parse(sessionStorage.getItem('oauth_return_view')!).savedPlanRequest).toBeUndefined();
    oauthMocks.begin.mockResolvedValue('AUTHORIZED');
    await click('Authorize and run report');
    expect(evaluationMocks.evaluate).toHaveBeenCalledTimes(4);
    expect(savedPlanOptionOf(evaluationMocks.evaluate.mock.calls[3])).toBeUndefined();
  });
});
