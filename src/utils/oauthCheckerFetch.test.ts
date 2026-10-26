import { expect, it, vi } from 'vitest';
import { createOAuthChallengeProbe } from './discoveryFetch';

it('sends an anonymous bounded initialize probe without cookies or authorization', async () => {
  const fetchImpl = vi.fn(async () => new Response('', {
    status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"' },
  }));
  vi.stubGlobal('fetch', fetchImpl);
  try {
    const result = await createOAuthChallengeProbe()('https://example.com/mcp');
    expect(result.wwwAuthenticate).toContain('resource_metadata');
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/mcp', expect.objectContaining({
      method: 'POST', credentials: 'omit', cache: 'no-store', signal: expect.any(AbortSignal),
    }));
    const options = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(options[1].headers).has('Authorization')).toBe(false);
    expect(JSON.parse(String(options[1].body)).method).toBe('initialize');
  } finally { vi.unstubAllGlobals(); }
});
