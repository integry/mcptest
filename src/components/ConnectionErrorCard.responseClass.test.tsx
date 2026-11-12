import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionErrorDetails } from '../utils/connectionDiagnostics';
import { classifyHttpResponse, type ResponseClassificationInput } from '../utils/responseClassification';
import { collectTransportDiagnostics } from '../utils/transportDiagnostics';
import type { ObservedTransportRequest } from '../utils/transportDetection';
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

const ENDPOINT = 'https://mcp.example.com/mcp';

/** One proxied target response, classified exactly like the transport fetch does. */
const diagnosticsFor = (input: ResponseClassificationInput) => {
  const responseClass = classifyHttpResponse(input);
  const request: ObservedTransportRequest = {
    method: 'POST',
    mcpMethod: 'initialize',
    url: `https://proxy.mcptest.io/?target=${encodeURIComponent(ENDPOINT)}`,
    candidateUrl: `https://proxy.mcptest.io/?target=${encodeURIComponent(ENDPOINT)}`,
    targetUrl: ENDPOINT,
    transportType: 'streamable-http',
    status: input.status,
    responseSource: 'target',
    outcome: 'failed',
    ...(responseClass ? { responseClass } : {}),
  };
  return collectTransportDiagnostics([{ route: 'proxy', requests: [request] }]);
};

const renderError = (overrides: Partial<ConnectionErrorDetails>): HTMLElement => {
  const container = document.createElement('div');
  root = createRoot(container);
  act(() => {
    root?.render(<ConnectionErrorCard
      errorDetails={{
        error: 'All connections failed: Error POSTing to endpoint',
        serverUrl: ENDPOINT,
        timestamp: new Date('2026-11-11T00:00:00.000Z'),
        attempts: [{
          route: 'proxy',
          candidateUrl: ENDPOINT,
          transportType: 'streamable-http',
          method: 'POST',
          status: 403,
          responseSource: 'target',
          browserUnreadable: false,
          failureKind: 'authentication',
          message: 'Error POSTing to endpoint',
        }],
        transportEvidence: 'streamable-http',
        ...overrides,
      }}
    />);
  });
  return container;
};

describe('ConnectionErrorCard response classes', () => {
  it('names bot protection on the exact path, with the evidence, the fix and a Learn link', () => {
    const container = renderError({
      transportDiagnostics: diagnosticsFor({
        status: 403,
        headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' },
      }),
    });

    expect(container.querySelector('.badge')?.textContent).toBe('Bot protection');
    expect(container.querySelector('h6')?.textContent).toBe('Bot protection is blocking MCP clients on /mcp');
    expect(container.textContent).toContain('cf-mitigated: challenge');
    expect(container.textContent).toContain('Exempt the MCP endpoint');
    expect(container.textContent).not.toContain('MCP endpoint returned HTTP 403');
    const learn = [...container.querySelectorAll('a')].find((link) => link.textContent === 'Deploying a remote MCP server');
    expect(learn?.getAttribute('href')).toBe('/learn/deploy-remote-mcp-server');
    // The reference link for the stable id is shown with the diagnostic.
    expect(container.innerHTML).toContain('/learn/mcp-transport-diagnostics-reference#transport-bot-protection-challenge');
  });

  it('words a heuristic match as a possibility', () => {
    const container = renderError({
      transportDiagnostics: diagnosticsFor({ status: 403, contentType: 'text/html', body: '<html><body>Blocked</body></html>' }),
    });

    expect(container.querySelector('.badge')?.textContent).toBe('Bot protection?');
    expect(container.querySelector('h6')?.textContent).toBe('Bot protection may be blocking MCP clients on /mcp');
  });

  it('shows a 402 as payment required, not as a broken server', () => {
    const container = renderError({
      attempts: [],
      transportDiagnostics: diagnosticsFor({ status: 402, headers: { 'payment-required': 'eyJ4NDAyVmVyc2lvbiI6Mn0=' } }),
    });

    expect(container.querySelector('.alert')?.className).toContain('alert-info');
    expect(container.querySelector('h6')?.textContent).toBe('Payment required on /mcp');
    expect(container.textContent).toContain('This is not reported as a broken server.');
  });

  it('keeps the generic HTTP card for a 403 that matches no class', () => {
    const container = renderError({
      transportDiagnostics: diagnosticsFor({ status: 403, contentType: 'application/json', body: '{"error":"Invalid Origin"}' }),
    });

    expect(container.querySelector('h6')?.textContent).toBe('MCP endpoint returned HTTP 403');
  });
});
