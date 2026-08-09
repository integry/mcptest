import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { useResourceAccess } from './useResourceAccess';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const renderResourceAccessHook = (client: Client, addLogEntry: ReturnType<typeof vi.fn>) => {
  let resourceAccess: ReturnType<typeof useResourceAccess> | undefined;
  const container = document.createElement('div');
  const root: Root = createRoot(container);

  const Probe = () => {
    resourceAccess = useResourceAccess(client, addLogEntry, 'https://mcp.example/mcp');
    return null;
  };

  act(() => root.render(React.createElement(Probe)));

  return {
    get resourceAccess() {
      if (!resourceAccess) throw new Error('Resource access hook was not rendered');
      return resourceAccess;
    },
    unmount() {
      act(() => root.unmount());
    },
  };
};

describe('resource access', () => {
  it('reads the expanded URI while persisting the reusable URI template', async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: 'mcp://documents/policies%2F2026', text: 'policy' }],
    });
    const addLogEntry = vi.fn();
    const view = renderResourceAccessHook({ readResource } as unknown as Client, addLogEntry);

    let result: Awaited<ReturnType<typeof view.resourceAccess.handleAccessResource>>;
    await act(async () => {
      result = await view.resourceAccess.handleAccessResource(
        { uriTemplate: 'mcp://documents/{documentId}', name: 'Document' },
        { documentId: 'policies/2026' }
      );
    });

    expect(readResource).toHaveBeenCalledWith({
      uri: 'mcp://documents/policies%2F2026',
    });
    expect(result?.callContext).toEqual({
      serverUrl: 'https://mcp.example/mcp',
      type: 'resource',
      name: 'mcp://documents/{documentId}',
      params: { documentId: 'policies/2026' },
    });
    expect(addLogEntry).toHaveBeenCalledWith(result);
    view.unmount();
  });
});
