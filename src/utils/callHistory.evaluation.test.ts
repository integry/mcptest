import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('./transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

import { evaluateServer } from './evaluation';
import { createCallHistoryEntry, recordCallHistoryEntry } from './callHistory';
import { createPublicReport } from './reportArtifact';

const serverUrl = 'https://history.example/mcp';

const createClient = () => ({
  request: vi.fn(async ({ method }: { method: string }) => ({
    'tools/list': { tools: [] },
    'resources/list': { resources: [] },
    'resources/templates/list': { resourceTemplates: [] },
    'prompts/list': { prompts: [] },
  } as Record<string, unknown>)[method]),
  close: vi.fn().mockResolvedValue(undefined),
});

const capabilityEvidence = (report: Awaited<ReturnType<typeof evaluateServer>>) => (
  report.sections.capabilities.details.filter((detail) => (
    (detail.metadata as { playgroundCalls?: number } | undefined)?.playgroundCalls !== undefined
  ))
);

describe('playground call history in evaluation runs', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockResolvedValue({
      client: createClient(),
      url: serverUrl,
      transportType: 'streamable-http',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('adds call and failure counts, never call contents, to the capabilities evidence', async () => {
    recordCallHistoryEntry(serverUrl, createCallHistoryEntry({
      toolName: 'secret_tool_name', arguments: { city: 'Tallinn' }, result: null, durationMs: 3,
    }));
    recordCallHistoryEntry(serverUrl, createCallHistoryEntry({
      toolName: 'weather', arguments: { city: 'Riga' },
      result: { type: 'tool_result', data: [{ type: 'text', text: 'Sunny' }], timestamp: '' },
      durationMs: 4,
    }));

    const report = await evaluateServer(serverUrl, '', vi.fn(), null);
    const [detail] = capabilityEvidence(report);

    expect(detail.metadata).toEqual({ playgroundCalls: 2, playgroundCallFailures: 1 });
    expect(detail.text).toContain('2 playground tool calls recorded, 1 failure');
    const artifact = JSON.stringify(createPublicReport(report));
    expect(artifact).toContain('"playgroundCalls":2');
    expect(artifact).not.toContain('Tallinn');
    expect(artifact).not.toContain('secret_tool_name');
  });

  it('adds nothing without recorded calls or in headless runs', async () => {
    expect(capabilityEvidence(await evaluateServer(serverUrl, '', vi.fn(), null))).toEqual([]);

    recordCallHistoryEntry(serverUrl, createCallHistoryEntry({
      toolName: 'weather', arguments: {}, result: null, durationMs: 1,
    }));
    const headless = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, { runtime: 'headless' });
    expect(capabilityEvidence(headless)).toEqual([]);
  });
});
