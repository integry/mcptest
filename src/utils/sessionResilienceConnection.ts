import type { SessionResilienceOptions } from './sessionResilience';

/** Bind probes to the selected connection route; no fallback or credential persistence. */
export function sessionResilienceConnection(options: {
  endpoint: string;
  proxyUrl?: string;
  firebaseToken?: string;
  oauthToken?: string | null;
  headers?: HeadersInit;
}): Pick<SessionResilienceOptions, 'endpoint' | 'route' | 'fetch'> {
  const targetHeaders = new Headers(options.headers);
  targetHeaders.delete('Mcp-Session-Id');
  targetHeaders.delete('MCP-Protocol-Version');
  if (options.oauthToken && !targetHeaders.has('Authorization') && !targetHeaders.has('x-api-key') && !targetHeaders.has('api-key')) {
    targetHeaders.set('Authorization', `Bearer ${options.oauthToken}`);
  }
  return {
    endpoint: options.endpoint,
    route: options.proxyUrl ? 'proxy' : 'direct',
    fetch: async (_input, init) => {
      const headers = new Headers(targetHeaders);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      let url = options.endpoint;
      if (options.proxyUrl) {
        const proxy = new URL(options.proxyUrl);
        proxy.searchParams.set('target', options.endpoint);
        url = proxy.toString();
        const credential = headers.get('Authorization');
        headers.delete('Authorization');
        if (credential) headers.set('X-MCP-Authorization', credential);
        if (options.firebaseToken) headers.set('Authorization', `Bearer ${options.firebaseToken}`);
      }
      return fetch(url, { ...init, headers, redirect: 'error' });
    },
  };
}
