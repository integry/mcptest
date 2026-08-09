import { describe, expect, it } from 'vitest';
import { getTargetRequestHeaders } from './index';

describe('proxy target credential forwarding', () => {
  it('replaces proxy authorization with the isolated target credential', () => {
    const headers = getTargetRequestHeaders({
      Authorization: 'Bearer firebase-jwt',
      'X-MCP-Authorization': 'Bearer target-token',
      'x-api-key': 'target-api-key',
      'CF-Connecting-IP': '192.0.2.1',
    });

    expect(headers.get('authorization')).toBe('Bearer target-token');
    expect(headers.get('x-mcp-authorization')).toBeNull();
    expect(headers.get('x-api-key')).toBe('target-api-key');
    expect(headers.get('cf-connecting-ip')).toBeNull();
  });

  it('never forwards Firebase authorization when no target credential exists', () => {
    const headers = getTargetRequestHeaders({ Authorization: 'Bearer firebase-jwt' });

    expect(headers.get('authorization')).toBeNull();
  });
});
