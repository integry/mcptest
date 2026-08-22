import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  ConnectionAttemptFact,
  ConnectionErrorDetails,
  DiagnosticTransportEvidence,
} from '../utils/connectionDiagnostics';
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
});

const unreadableAttempt = (
  candidateUrl = 'https://mcp.upwork.com/mcp',
  transportType: ConnectionAttemptFact['transportType'] = 'streamable-http'
): ConnectionAttemptFact => ({
  route: 'direct',
  candidateUrl,
  transportType,
  method: 'POST',
  browserUnreadable: true,
  failureKind: 'browser-unreadable',
  message: 'Failed to fetch',
});

const renderError = (
  overrides: Partial<ConnectionErrorDetails> = {},
  props: Partial<React.ComponentProps<typeof ConnectionErrorCard>> = {}
): HTMLElement => {
  const container = document.createElement('div');
  root = createRoot(container);
  act(() => {
    root?.render(<ConnectionErrorCard
      errorDetails={{
        error: 'All connections failed: Failed to fetch',
        serverUrl: 'https://mcp.upwork.com/mcp',
        timestamp: new Date('2026-08-21T00:00:00.000Z'),
        attempts: [unreadableAttempt()],
        transportEvidence: 'streamable-http',
        expectedAuthentication: 'oauth',
        serverReachable: true,
        ...overrides,
      }}
      {...props}
    />);
  });
  return container;
};

describe('evidence-based connection diagnostics', () => {
  it('renders the Upwork browser/CORS diagnosis and exact OAuth-aware HTTP probe', () => {
    const container = renderError();
    const text = container.textContent || '';

    expect(text).toContain('Browser access blocked / OAuth server reachable');
    expect(text).not.toContain('server is down');
    expect(text).not.toContain('server logs');
    expect(text).toContain('HTTP 401');
    expect(text).toContain('WWW-Authenticate');
    expect(text).toContain("--url 'https://mcp.upwork.com/mcp'");
    expect(text).not.toContain('https://mcp.upwork.com/mcp/');
    expect(text).not.toContain('/sse');
    expect(text).not.toContain('2024-11-05');
    expect(container.querySelector('table caption')?.textContent).toContain('Connection candidates');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(text).not.toContain('Copy bearer curl');
  });

  it('shows a placeholder bearer variant only when endpoint evidence supports it', () => {
    const container = renderError({ supportsBearerToken: true });
    expect(container.textContent).toContain('Bearer-token variant (placeholder only)');
    expect(container.textContent).toContain('Authorization: Bearer <ACCESS_TOKEN>');
    expect(container.textContent).toContain('Copy bearer curl');
  });

  it('shows actionable proxy guidance when direct responses are unreadable and proxy is disabled', () => {
    const onRetryWithProxy = vi.fn();
    const container = renderError({}, {
      useProxy: false,
      showProxyOption: true,
      onRetryWithProxy,
    });

    expect(container.textContent).toContain('Automatically use proxy for CORS errors');
    const button = Array.from(container.querySelectorAll('button')).find(({ textContent }) => (
      textContent === 'Enable proxy and retry'
    ));
    act(() => button?.click());
    expect(onRetryWithProxy).toHaveBeenCalledOnce();
  });

  it('keeps a readable 404 distinct from browser/CORS failure', () => {
    const container = renderError({
      expectedAuthentication: 'none',
      attempts: [{
        route: 'direct',
        candidateUrl: 'https://example.com/missing',
        transportType: 'streamable-http',
        method: 'POST',
        status: 404,
        browserUnreadable: false,
        failureKind: 'http',
        message: 'HTTP 404',
      }],
    });

    expect(container.textContent).toContain('MCP endpoint returned HTTP 404');
    expect(container.textContent).not.toContain('Browser access blocked');
  });

  it.each([404, 500])(
    'prefers a readable proxy-observed HTTP %s over opaque direct-browser attempts',
    (status) => {
      const container = renderError({
        expectedAuthentication: 'none',
        serverReachable: undefined,
        attempts: [
          unreadableAttempt('https://example.com/mcp'),
          {
            route: 'proxy',
            candidateUrl: 'https://example.com/mcp',
            transportType: 'streamable-http',
            method: 'POST',
            status,
            responseSource: 'target',
            browserUnreadable: false,
            failureKind: 'http',
            message: `HTTP ${status}`,
          },
        ],
      });

      expect(container.textContent).toContain(`MCP endpoint returned HTTP ${status}`);
      expect(container.textContent).toContain('The authenticated proxy observed a readable response');
      expect(container.textContent).not.toContain('Browser access blocked');
      expect(container.textContent).not.toContain('The browser received a readable response');
    }
  );

  it('does not present a proxy-owned infrastructure response as the target response', () => {
    const container = renderError({
      expectedAuthentication: 'none',
      serverReachable: undefined,
      attempts: [
        unreadableAttempt('https://example.com/mcp'),
        {
          route: 'proxy',
          candidateUrl: 'https://example.com/mcp',
          transportType: 'streamable-http',
          method: 'POST',
          status: 500,
          responseSource: 'proxy',
          browserUnreadable: false,
          failureKind: 'http',
          message: 'Proxy infrastructure failed',
        },
      ],
    });

    expect(container.textContent).toContain('Browser access blocked');
    expect(container.textContent).toContain('HTTP 500 from mcptest proxy');
    expect(container.textContent).not.toContain('MCP endpoint returned HTTP 500');
  });

  it('keeps target OAuth ahead of a proxy-login challenge', () => {
    const container = renderError({
      attempts: [
        unreadableAttempt(),
        {
          route: 'proxy',
          candidateUrl: 'https://mcp.upwork.com/mcp',
          transportType: 'streamable-http',
          method: 'POST',
          status: 401,
          authenticationSource: 'proxy',
          browserUnreadable: false,
          failureKind: 'authentication',
          message: 'Authenticated proxy returned HTTP 401',
        },
        {
          route: 'proxy',
          candidateUrl: 'https://mcp.upwork.com/mcp',
          transportType: 'streamable-http',
          method: 'POST',
          status: 401,
          authenticationSource: 'target',
          browserUnreadable: false,
          failureKind: 'authentication',
          message: 'MCP target returned HTTP 401',
        },
      ],
    });

    expect(container.textContent).toContain('OAuth authorization required');
    expect(container.textContent).not.toContain('mcptest proxy authentication required');
  });

  it.each([
    ['timeout', 'MCP connection timed out'],
    ['abort', 'MCP connection aborted'],
    ['refused', 'MCP connection refused'],
    ['network', 'MCP network connection failed'],
  ] as const)('preserves the %s diagnosis', (failureKind, heading) => {
    const container = renderError({
      expectedAuthentication: 'none',
      attempts: [{
        route: 'direct',
        candidateUrl: 'https://example.com/mcp',
        transportType: 'streamable-http',
        browserUnreadable: false,
        failureKind,
        message: failureKind,
      }],
    });

    expect(container.textContent).toContain(heading);
  });
});

describe('transport-aware exact probes', () => {
  it.each([
    ['streamable-http', true, false],
    ['legacy-sse', false, true],
    ['both', true, true],
    ['unknown', true, true],
  ] as const)('renders %s transport evidence', (transportEvidence, hasHttp, hasSse) => {
    const container = renderError({
      transportEvidence: transportEvidence as DiagnosticTransportEvidence,
      expectedAuthentication: 'none',
      attempts: [],
      serverUrl: 'https://example.com/custom/path?tenant=one',
    });
    const text = container.textContent || '';

    expect(text.includes('Streamable HTTP — exact endpoint')).toBe(hasHttp);
    expect(text.toLowerCase().includes('legacy sse')).toBe(hasSse);
    if (transportEvidence === 'unknown') expect(text).toContain('Exploratory legacy SSE');
    expect(text).not.toContain('/sse');
    expect(text).not.toContain('/mcp/');
  });
});
