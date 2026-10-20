import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectionErrorDetails } from '../utils/connectionDiagnostics';
import type { ObservedTransportRequest } from '../utils/transportDetection';
import { collectTransportDiagnostics } from '../utils/transportDiagnostics';
import ConnectionErrorCard from './ConnectionErrorCard';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
});

const ENDPOINT = 'https://mcp.example.com/mcp';

const request = (overrides: Partial<ObservedTransportRequest> = {}): ObservedTransportRequest => ({
  method: 'POST',
  mcpMethod: 'initialize',
  url: ENDPOINT,
  candidateUrl: ENDPOINT,
  targetUrl: ENDPOINT,
  transportType: 'streamable-http',
  startedAt: '2026-10-20T00:00:00.000Z',
  requestAccept: 'application/json, text/event-stream',
  requestContentType: 'application/json',
  responseSource: 'target',
  outcome: 'failed',
  crossOrigin: true,
  ...overrides,
});

const render = (
  overrides: Partial<ConnectionErrorDetails>,
  props: Partial<React.ComponentProps<typeof ConnectionErrorCard>> = {}
): HTMLElement => {
  const container = document.createElement('div');
  root = createRoot(container);
  act(() => {
    root?.render(<ConnectionErrorCard
      errorDetails={{
        error: 'All connections failed',
        serverUrl: ENDPOINT,
        timestamp: new Date(),
        transportEvidence: 'streamable-http',
        ...overrides,
      }}
      {...props}
    />);
  });
  return container;
};

describe('ConnectionErrorCard transport diagnostics', () => {
  it('explains a target 406 with evidence, remediation and code hints', () => {
    const container = render({
      attempts: [{
        route: 'direct',
        candidateUrl: ENDPOINT,
        transportType: 'streamable-http',
        method: 'POST',
        status: 406,
        responseSource: 'target',
        browserUnreadable: false,
        failureKind: 'http',
        message: 'HTTP 406',
      }],
      transportDiagnostics: collectTransportDiagnostics([{
        route: 'direct',
        requests: [request({ status: 406 })],
      }]),
    });
    const text = container.textContent || '';

    expect(container.querySelector('h6.alert-heading')?.textContent)
      .toBe('Server rejected the Accept header (HTTP 406)');
    expect(text).toContain('transport.accept-header-406');
    expect(text).toContain('must send an Accept header that lists both application/json and text/event-stream');
    expect(text).toContain('Sent: accept: application/json, text/event-stream');
    expect(text).toContain('How to fix:');
    expect(Array.from(container.querySelectorAll('.transport-diagnostic__hint'))).toHaveLength(3);
    expect(text).toContain('Apply the transport fix described above');
    expect(text).not.toContain('exact MCP endpoint path matches');
  });

  it('shows a 405 GET stream as a warning without replacing the primary diagnosis', () => {
    const container = render({
      attempts: [],
      transportDiagnostics: collectTransportDiagnostics([{
        route: 'direct',
        requests: [request({ method: 'GET', mcpMethod: undefined, status: 405 })],
      }]),
    });

    expect(container.querySelector('.transport-diagnostic--warning')).not.toBeNull();
    expect(container.querySelector('h6.alert-heading')?.textContent).toBe('MCP server connection failed');
  });

  it('shows the Retry-After wait and holds the retry button until it elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    const onRetry = vi.fn();
    const container = render({
      timestamp: new Date('2026-10-20T00:00:00.000Z'),
      attempts: [],
      transportDiagnostics: collectTransportDiagnostics([{
        route: 'direct',
        requests: [request({
          status: 429,
          retryAfter: '3',
          rateLimitRetry: { action: 'not-retried', waitMs: 3000, reason: 'mcptest retries a rate-limited request at most once.' },
        })],
      }]),
    }, { onRetry });

    const button = () => Array.from(container.querySelectorAll('button'))
      .find((element) => /Retry/.test(element.textContent || '')) as HTMLButtonElement;
    expect(container.querySelector('.badge')?.textContent).toBe('Rate limited');
    expect(container.textContent).toContain('The server asked clients to wait 3 seconds');
    expect(button().textContent).toBe('Retry in 3 seconds');
    expect(button().disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(button().textContent).toBe('Retry connection');
    expect(button().disabled).toBe(false);
    expect(container.textContent).toContain('You can retry now.');
  });

  it('counts down from the 429 arrival, not from the later error timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:04.000Z'));
    const container = render({
      timestamp: new Date('2026-10-20T00:00:04.000Z'),
      attempts: [],
      transportDiagnostics: collectTransportDiagnostics([{
        route: 'direct',
        requests: [request({
          status: 429,
          retryAfter: '10',
          durationMs: 500,
          rateLimitRetry: { action: 'not-retried', waitMs: 10_000, reason: 'too long' },
        })],
      }]),
    }, { onRetry: vi.fn() });

    const button = () => Array.from(container.querySelectorAll('button'))
      .find((element) => /Retry/.test(element.textContent || '')) as HTMLButtonElement;
    expect(button().textContent).toBe('Retry in 7 seconds');

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(button().textContent).toBe('Retry in 1 second');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(button().disabled).toBe(false);
  });

  it('imposes no cooldown when the automatic retry already satisfied the rate limit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:03.000Z'));
    const container = render({
      timestamp: new Date('2026-10-20T00:00:03.000Z'),
      attempts: [],
      transportDiagnostics: collectTransportDiagnostics([{
        route: 'direct',
        requests: [
          request({ status: 429, retryAfter: '2', rateLimitRetry: { action: 'retried', waitMs: 2000 } }),
          request({ status: 200, startedAt: '2026-10-20T00:00:02.000Z', outcome: 'succeeded', automaticRetry: { reason: 'target-rate-limit', waitMs: 2000 } }),
          request({ mcpMethod: 'tools/list', status: 500, startedAt: '2026-10-20T00:00:02.500Z' }),
        ],
      }]),
    }, { onRetry: vi.fn() });

    const button = Array.from(container.querySelectorAll('button'))
      .find((element) => /Retry/.test(element.textContent || '')) as HTMLButtonElement;
    expect(button.textContent).toBe('Retry connection');
    expect(button.disabled).toBe(false);
  });

  it('presents a hidden session header as unconfirmed after an unrelated failure', () => {
    const container = render({
      attempts: [],
      transportDiagnostics: collectTransportDiagnostics([{
        route: 'direct',
        requests: [
          request({ status: 200, outcome: 'succeeded', responseContentType: 'application/json', readableResponseHeaders: [] }),
          request({ mcpMethod: 'tools/list', status: 404 }),
        ],
      }]),
    });

    expect(container.querySelector('.transport-diagnostic--suspected')).not.toBeNull();
    expect(container.textContent).toContain('Possible');
    expect(container.textContent).toContain('does not use sessions');
    expect(container.querySelector('h6.alert-heading')?.textContent).toBe('MCP server connection failed');
  });

  it('says the Expose-Headers check was not performed through the proxy', () => {
    const container = render({
      attempts: [],
      transportDiagnostics: collectTransportDiagnostics([{
        route: 'proxy',
        requests: [request({ status: 500, url: `https://proxy.mcptest.io/?target=${encodeURIComponent(ENDPOINT)}` })],
      }]),
    });

    expect(container.querySelector('.transport-diagnostic--not-checked')).not.toBeNull();
    expect(container.textContent).toContain('Not checked');
    expect(container.textContent).toContain('Access-Control-Expose-Headers on the server could not be checked');
  });

  it('renders nothing extra when there are no transport diagnostics', () => {
    const container = render({ attempts: [] });
    expect(container.textContent).not.toContain('Transport diagnostics');
  });
});
