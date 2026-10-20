import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import { createReportSnapshot } from '../utils/reportHistory';
import { analyzeToolSurface } from '../utils/toolSurfaceAnalysis';
import {
  PUBLISHED_REPORT_REMOVAL_TOKENS_KEY,
  createPublishableReportJson,
} from '../utils/publishedReports';
import {
  publishedReportId,
  summarizePublishedArtifact,
  type PublishedReportEntry,
} from '../utils/publishedReportIdentity';
import PublishedReportHistory, { describePublishedSummary } from './PublishedReportHistory';

const ENDPOINT = 'https://history-ui.example/mcp';
// The live run's endpoint carries a query credential; everything published,
// requested or linked must use the redacted identity instead.
const SECRET_ENDPOINT = 'https://history-ui.example/mcp?token=secret';
const PUBLISHED_IDENTITY = 'https://history-ui.example/mcp?token=%5BREDACTED%5D';
const API = 'https://worker.test';

const report = (transport: 'streamable-http' | 'legacy-sse'): EvaluationReport => ({
  serverUrl: ENDPOINT,
  outcome: 'scored',
  finalScore: transport === 'streamable-http' ? 55 : 46,
  toolSurfaceAnalysis: analyzeToolSurface([{
    name: 'search', description: 'Search records.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }]),
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{ text: 'Negotiated', metadata: {
        protocolEra: 'modern', protocolVersion: '2026-07-28', endpoint: ENDPOINT, route: 'direct',
      } }],
    },
    capabilities: {
      name: 'Capabilities', description: 'Capabilities', score: 10, maxScore: 10,
      details: [{ text: 'Tools', metadata: { method: 'tools/list', itemCount: 1 } }],
    },
    transport: {
      name: 'Transport', description: 'Transport',
      score: transport === 'streamable-http' ? 15 : 6, maxScore: 15,
      details: [{ text: 'Connected', metadata: { transportType: transport } }],
    },
    performance: {
      name: 'Performance', description: 'Performance', score: 15, maxScore: 15,
      details: [{ text: 'Fast', metadata: { durationMs: 200 } }],
    },
  },
});

const older = createReportSnapshot(report('streamable-http'), undefined, '2026-10-18T20:00:00.000Z').report;
const newer = createReportSnapshot(report('legacy-sse'), undefined, '2026-10-19T20:00:00.000Z').report;
const oldest = createReportSnapshot(report('streamable-http'), undefined, '2026-10-17T20:00:00.000Z').report;
const ENDPOINT_KEY = 'a'.repeat(20);
const olderId = publishedReportId(ENDPOINT_KEY, '1'.repeat(20));
const newerId = publishedReportId(ENDPOINT_KEY, '2'.repeat(20));
const oldestId = publishedReportId(ENDPOINT_KEY, '3'.repeat(20));

const entry = (id: string, artifact: typeof older): PublishedReportEntry => ({
  id,
  endpoint: ENDPOINT,
  createdAt: artifact.generatedAt,
  lastPublishedAt: artifact.generatedAt,
  contentHash: id.split('-')[1].repeat(3),
  summary: summarizePublishedArtifact(artifact as unknown as Record<string, unknown>),
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

// Behaves like a browser with the index response still fresh in its HTTP cache:
// a default-cache GET of an index URL replays the first body served for that
// URL, and only a request that bypasses the cache sees the current entries.
const installFetch = (entries: PublishedReportEntry[], artifacts: Record<string, unknown>): FetchMock => {
  const cachedIndexes = new Map<string, string>();
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.startsWith(`${API}/r/endpoint/`)) {
      const requested = decodeURIComponent(url.slice(`${API}/r/endpoint/`.length));
      const cached = cachedIndexes.get(url);
      if (cached !== undefined && init?.cache !== 'no-store') return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json' } });
      const body = JSON.stringify({ endpoint: requested, retention: 20, snapshots: entries });
      if (cached === undefined) cachedIndexes.set(url, body);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'GET' && url.startsWith(`${API}/r/`)) {
      const id = decodeURIComponent(url.slice(`${API}/r/`.length));
      return artifacts[id] ? jsonResponse(artifacts[id]) : jsonResponse({ error: 'not_found' }, 404);
    }
    if (method === 'POST' && url === `${API}/r`) {
      const published = { ...entry(newerId, newer), endpoint: PUBLISHED_IDENTITY };
      entries.splice(0, entries.length, published);
      return jsonResponse({
        id: newerId,
        url: `${API}/r/${newerId}`,
        reportUrl: `https://mcptest.io/report/${encodeURIComponent(PUBLISHED_IDENTITY)}`,
        badgeUrl: `https://mcptest.io/badge/report/${encodeURIComponent(PUBLISHED_IDENTITY)}.svg`,
        endpoint: PUBLISHED_IDENTITY,
        deduplicated: false,
        entry: published,
        snapshotCount: 1,
        retention: 20,
        removalToken: 'removal-token-shown-once',
      }, 201);
    }
    if (method === 'DELETE' && url.startsWith(`${API}/r/`)) {
      entries.splice(0, entries.length);
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

let root: Root | undefined;
let container: HTMLDivElement;

const render = async (element: React.ReactElement) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  // Let the index and artifact fetches settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const clickButton = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => (
    candidate.textContent?.includes(label)
  ));
  expect(button, `button "${label}"`).toBeDefined();
  await act(async () => {
    button?.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_CLOUDFLARE_WORKER_URL', `${API}/`);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PublishedReportHistory', () => {
  it('summarizes published runs', () => {
    expect(describePublishedSummary({ status: 'scored', releaseStatus: 'ready', scorePercentage: 87.4, generatedAt: '' }))
      .toBe('Ready to ship · 87% score');
    expect(describePublishedSummary({ status: 'authorization-required', generatedAt: '' }))
      .toBe('Authorization required, not scored');
    expect(describePublishedSummary({ status: 'failed', generatedAt: '' })).toBe('Failed, not scored');
  });

  it('renders nothing when the worker URL is not configured', async () => {
    vi.stubEnv('VITE_CLOUDFLARE_WORKER_URL', '');
    const fetchMock = installFetch([], {});
    await render(<PublishedReportHistory endpoint={ENDPOINT} />);
    expect(container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the latest published run, every snapshot and the drift between the two newest', async () => {
    installFetch([entry(newerId, newer), entry(olderId, older)], { [newerId]: newer, [olderId]: older });
    const onPublishedStateChange = vi.fn();
    await render(<PublishedReportHistory endpoint={ENDPOINT} onPublishedStateChange={onPublishedStateChange} />);

    expect(container.textContent).toContain('Published history');
    expect(container.textContent).toContain('Latest published run');
    expect(container.querySelector('.published-latest h4')?.textContent).toBe(describePublishedSummary(entry(newerId, newer).summary));
    expect(container.querySelectorAll('.published-item')).toHaveLength(2);
    const permalinks = Array.from(container.querySelectorAll<HTMLAnchorElement>('.published-item a')).map((a) => a.href);
    expect(permalinks).toEqual([`${API}/r/${newerId}`, `${API}/r/${olderId}`]);
    expect(container.textContent).toContain('Transport changed');
    expect(container.textContent).toContain('Breaking · transport');
    expect(container.textContent).toContain('Evaluation score changed');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Earlier snapshot"]')?.value).toBe(olderId);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Later snapshot"]')?.value).toBe(newerId);
    expect(onPublishedStateChange).toHaveBeenLastCalledWith(ENDPOINT);
    // No publish button without a live run; the canonical report link is still offered.
    expect(container.textContent).not.toContain('Publish report');
    expect(container.textContent).toContain('Copy report link');
    expect(container.textContent).not.toContain('Remove');
  });

  it('compares any two selected snapshots', async () => {
    installFetch([entry(newerId, newer), entry(olderId, older)], { [newerId]: newer, [olderId]: older });
    await render(<PublishedReportHistory endpoint={ENDPOINT} />);
    const earlier = container.querySelector<HTMLSelectElement>('select[aria-label="Earlier snapshot"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(earlier, newerId);
      earlier.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('No semantic drift between these snapshots.');
  });

  it('publishes the redacted artifact, shows the removal token once and enables removal', async () => {
    const fetchMock = installFetch([], {});
    const onPublishedStateChange = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const liveReport = { ...report('legacy-sse'), serverUrl: SECRET_ENDPOINT };
    await render(
      <PublishedReportHistory
        endpoint={SECRET_ENDPOINT}
        report={liveReport}
        onPublishedStateChange={onPublishedStateChange}
      />
    );
    expect(container.textContent).toContain('No published runs for this endpoint yet.');
    expect(onPublishedStateChange).toHaveBeenLastCalledWith(null);
    const indexUrl = `${API}/r/endpoint/${encodeURIComponent(PUBLISHED_IDENTITY)}`;
    expect(fetchMock.mock.calls[0][0]).toBe(indexUrl);

    await clickButton('Publish report');

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe(`${API}/r`);
    const body = JSON.parse(post?.[1]?.body as string) as { generatedAt: string; target: { testedEndpoint: string } };
    const expected = JSON.parse(createPublishableReportJson(liveReport, undefined, body.generatedAt));
    expect(body).toEqual(expected);
    expect(body.target.testedEndpoint).toBe(PUBLISHED_IDENTITY);

    // The reload after publishing reads the index the Worker filed the snapshot
    // under and bypasses the empty index the browser cached before the publish.
    const reload = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(reload[0]).toBe(indexUrl);
    expect(reload[1]?.cache).toBe('no-store');
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('secret'))).toBe(true);

    expect(container.textContent).toContain('Report published.');
    expect(container.querySelector<HTMLInputElement>('#published-removal-token')?.value).toBe('removal-token-shown-once');
    expect(JSON.parse(localStorage.getItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY)!)).toEqual({
      [newerId]: 'removal-token-shown-once',
    });
    expect(onPublishedStateChange).toHaveBeenLastCalledWith(PUBLISHED_IDENTITY);
    expect(container.textContent).toContain('Latest published run');
    expect(container.textContent).toContain('Remove');

    await clickButton('Copy token');
    expect(writeText).toHaveBeenCalledWith('removal-token-shown-once');
    await clickButton('Copy report link');
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(encodeURIComponent(PUBLISHED_IDENTITY)));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('secret'));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await clickButton('Remove');
    const remove = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(remove?.[0]).toBe(`${API}/r/${newerId}`);
    expect((remove?.[1]?.headers as Record<string, string>)['X-Removal-Token']).toBe('removal-token-shown-once');
    expect(localStorage.getItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY)).toBeNull();
    const reloadAfterDelete = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(reloadAfterDelete[0]).toBe(indexUrl);
    expect(reloadAfterDelete[1]?.cache).toBe('no-store');
    expect(container.textContent).toContain('No published runs for this endpoint yet.');
    expect(onPublishedStateChange).toHaveBeenLastCalledWith(null);
  });

  it('renders a cached pair again after another comparison failed to load', async () => {
    installFetch(
      [entry(newerId, newer), entry(olderId, older), entry(oldestId, oldest)],
      { [newerId]: newer, [olderId]: older }
    );
    await render(<PublishedReportHistory endpoint={ENDPOINT} />);
    expect(container.textContent).toContain('Transport changed');

    const earlier = container.querySelector<HTMLSelectElement>('select[aria-label="Earlier snapshot"]')!;
    const select = async (id: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
        setter.call(earlier, id);
        earlier.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await select(oldestId);
    expect(container.querySelector('.published-compare [role="alert"]')?.textContent).toContain('could not be compared');
    expect(container.textContent).not.toContain('Transport changed');

    await select(olderId);
    expect(container.querySelector('.published-compare [role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Transport changed');
  });

  it('surfaces publish failures without losing the page', async () => {
    const fetchMock = installFetch([], {});
    fetchMock.mockImplementationOnce(async () => jsonResponse({ endpoint: ENDPOINT, retention: 20, snapshots: [] }));
    fetchMock.mockImplementationOnce(async () => jsonResponse({
      error: 'rate_limited',
      message: 'Publishing is limited to 10 reports per hour per endpoint host.',
    }, 429));
    await render(<PublishedReportHistory endpoint={ENDPOINT} report={report('legacy-sse')} />);
    await clickButton('Publish report');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('limited to 10 reports per hour');
    expect(container.textContent).toContain('Publish report');
  });
});
