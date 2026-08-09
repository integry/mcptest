import { beforeEach, describe, expect, it, vi } from 'vitest';

const { attemptParallelConnections } = vi.hoisted(() => ({
  attemptParallelConnections: vi.fn(),
}));
vi.mock('./transportDetection', () => ({ attemptParallelConnections }));

import { checkServerLiveness, isAuthenticationFailure } from './catalogLiveness';

describe('catalog browser liveness', () => {
  beforeEach(() => attemptParallelConnections.mockReset());

  it('reports a negotiated stateless server', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    attemptParallelConnections.mockResolvedValue({
      client: { close },
      transportType: 'streamable-http',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      url: 'https://example.com/mcp',
    });

    await expect(checkServerLiveness('https://example.com/mcp')).resolves.toMatchObject({
      status: 'online',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('recognizes MCP authentication challenge errors', () => {
    expect(isAuthenticationFailure(new Error('HTTP 401 Unauthorized'))).toBe(true);
    expect(isAuthenticationFailure('403 Forbidden')).toBe(true);
    expect(isAuthenticationFailure(new Error('CORS request failed'))).toBe(false);
  });
});
